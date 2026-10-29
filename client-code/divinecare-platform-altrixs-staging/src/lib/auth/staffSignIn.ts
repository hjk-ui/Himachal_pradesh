/**
 * Staff sign-in, step by step (server). The login page calls these through /api/auth/signin/*;
 * NextAuth's Credentials provider only accepts the final signed ticket (src/lib/auth/config.ts).
 *
 *   1. Password, or email one-time code  -> startPasswordSignIn / startOtpSignIn
 *        5 wrong passwords per account -> 15 min lock (DB); 20 attempts / 15 min per IP.
 *   2. Two-factor (when required):
 *        enrolled      -> verifySecondFactor (TOTP ±1 step, no reuse, or a one-time recovery code)
 *        not enrolled  -> beginEnrollment (QR + manual key) -> confirmEnrollment (code) -> 10 recovery codes
 *        remembered device (signed cookie + MfaTrustedDevice row) skips the code for 30 days
 *        5 wrong codes -> 15 min lock.
 *   3. completeSignIn(ticket) inside NextAuth authorize -> JWT session.
 *
 * Every step is audited with ids only: LOGIN, LOGIN_FAILED, LOGIN_LOCKED, MFA_ENROLLED,
 * MFA_CHALLENGE_SUCCESS, MFA_CHALLENGE_FAILED, MFA_RECOVERY_USED, MFA_LOCKED, MFA_RESET.
 * Errors are generic: they never reveal whether an email has an account.
 */
import { compare, hash } from 'bcryptjs';
import qrcode from 'qrcode-generator';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { auditRequestMeta } from '@/lib/audit/requestMeta';
import { verifyEmailOtp } from '@/lib/auth/otp';
import { decryptField, encryptField, fieldEncryptionConfigured } from '@/lib/security/fieldCrypto';
import { clientKey, rateLimit, rateLimitBlocked } from '@/lib/security/rateLimit';
import {
  IP_LOGIN_LIMIT,
  IP_WINDOW_MS,
  LOCK_MINUTES,
  LOCK_MS,
  MAX_FAILED_ATTEMPTS,
  isLocked,
  lockMessage,
  minutesLeft,
  registerFailure,
} from './lockout';
import {
  DEVICE_COOKIE,
  DEVICE_TTL_MS,
  TICKET_TTL_MS,
  cookieFromHeader,
  newNonce,
  readDeviceCookie,
  readTicket,
  sha256Hex,
  signDeviceCookie,
  signTicket,
  type SecondFactor,
  type TicketMethod,
  type TicketPayload,
  type TicketStage,
} from './mfaTokens';
import { formatManualKey, generateTotpSecret, otpauthUri, verifyTotp } from './totp';
import { findRecoveryCode, generateRecoveryCodes, hashRecoveryCode, looksLikeRecoveryCode } from './recoveryCodes';

export const BAD_CREDENTIALS = 'The email or password you entered is incorrect.';
export const BAD_EMAIL_CODE = 'Invalid or expired code.';
export const BAD_MFA_CODE = 'That code is not valid. Check your authenticator app and try again.';
export const SIGN_IN_EXPIRED = 'Your sign-in expired. Start again.';
export const MFA_UNAVAILABLE =
  'Two-factor setup is unavailable: the server encryption key is not configured. Ask your administrator.';

/** env MFA_ENFORCE=false switches the 2FA requirement off for every practice (emergencies only). */
export function mfaEnforcedByEnv(env: Record<string, string | undefined> = process.env): boolean {
  return String(env.MFA_ENFORCE ?? '').trim().toLowerCase() !== 'false';
}

/** Two-factor required for this staff account: env switch, then the practice setting (default ON). Platform admins always. */
export async function mfaRequiredFor(user: { role: string; organizationId: string | null }): Promise<boolean> {
  if (!mfaEnforcedByEnv()) return false;
  if (user.role === 'SUPER_ADMIN' || !user.organizationId) return true;
  try {
    const row = await prisma.practiceSettings.findUnique({
      where: { organizationId: user.organizationId },
      select: { mfaRequired: true },
    });
    return row?.mfaRequired ?? true;
  } catch {
    return true; // fail closed (e.g. the column is missing before the migration)
  }
}

const userSelect = {
  id: true,
  email: true,
  name: true,
  image: true,
  role: true,
  roles: true,
  status: true,
  organizationId: true,
  passwordHash: true,
  isMedicalDirector: true,
  medicalDirectorScope: true,
  failedLoginCount: true,
  loginLockedUntil: true,
  mfaSecretEnc: true,
  mfaPendingSecretEnc: true,
  mfaEnabledAt: true,
  mfaLastUsedStep: true,
  mfaRecoveryCodes: true,
  mfaFailedCount: true,
  mfaLockedUntil: true,
  mfaTicketNonceHash: true,
  organization: { select: { active: true } },
} as const;

type SignInUser = NonNullable<Awaited<ReturnType<typeof loadUserByEmail>>>;

function loadUserByEmail(email: string) {
  return prisma.user.findUnique({ where: { email }, select: userSelect });
}
function loadUserById(id: string) {
  return prisma.user.findUnique({ where: { id }, select: userSelect });
}

export type StepResult =
  | {
      ok: true;
      next: 'mfa' | 'enroll' | 'done';
      ticket: string;
      /** Set by the route as the remember-device cookie */
      deviceCookie?: { value: string; expires: Date };
      recoveryCodes?: string[];
      remainingRecoveryCodes?: number;
      status?: undefined;
      error?: undefined;
      locked?: undefined;
    }
  | { ok: false; status: number; error: string; locked?: boolean };

const fail = (status: number, error: string, locked = false): StepResult => ({ ok: false, status, error, ...(locked ? { locked } : {}) });
const lockedResult = (minutes: number): StepResult => fail(429, lockMessage(minutes), true);

async function audit(
  req: Request | undefined,
  action: string,
  user: { id: string; role: string; organizationId: string | null } | null,
  outcome: 'SUCCESS' | 'FAILURE',
  metadata: Record<string, unknown> = {}
) {
  await writeAuditLog({
    action,
    actorUserId: user?.id ?? null,
    actorRole: user?.role ?? null,
    organizationId: user?.organizationId ?? null,
    resourceType: 'user',
    resourceId: user?.id ?? null,
    outcome,
    ...auditRequestMeta(req),
    metadata,
  });
}

let dummyHash: Promise<string> | null = null;
/** Compare against a throwaway hash so an unknown email costs the same time as a wrong password. */
async function burnCompare(password: string) {
  dummyHash ??= hash('altrixs-no-such-account', 12);
  await compare(password, await dummyHash).catch(() => false);
}

/**
 * Per-IP limit on FAILED attempts (IP_LOGIN_LIMIT per IP_WINDOW_MS). Successful sign-ins are not
 * counted, so a clinic where all staff share one public address is not locked out at the morning rush.
 */
function ipLimited(req: Request | undefined, prefix: string): StepResult | null {
  if (!req) return null;
  const r = rateLimitBlocked(clientKey(req, prefix), IP_LOGIN_LIMIT);
  return r.blocked ? lockedResult(minutesLeft(r.retryAt)) : null;
}

function countIpFailure(req: Request | undefined, prefix: string): void {
  if (req) rateLimit(clientKey(req, prefix), IP_LOGIN_LIMIT, IP_WINDOW_MS);
}

// ─── Tickets ──────────────────────────────────────────────────────────────────

async function issueTicket(userId: string, stage: TicketStage, method: TicketMethod, factor?: SecondFactor): Promise<string> {
  const n = newNonce();
  await prisma.user.update({ where: { id: userId }, data: { mfaTicketNonceHash: sha256Hex(n) } });
  const payload: TicketPayload = { u: userId, s: stage, n, m: method, ...(factor ? { f: factor } : {}), e: Date.now() + TICKET_TTL_MS };
  return signTicket(payload);
}

/** Ticket + its user when the signature, expiry, stage and current nonce all match. */
async function loadTicket(ticket: string, stages: TicketStage[]): Promise<{ p: TicketPayload; user: SignInUser } | null> {
  const p = readTicket(ticket);
  if (!p || !stages.includes(p.s)) return null;
  const user = await loadUserById(p.u);
  if (!user || user.status !== 'ACTIVE' || user.mfaTicketNonceHash !== sha256Hex(p.n)) return null;
  if (user.role !== 'SUPER_ADMIN' && user.organization && !user.organization.active) return null;
  return { p, user };
}

/** Atomically retire the ticket's nonce (a ticket is used once). */
async function consumeNonce(userId: string, nonce: string): Promise<boolean> {
  const r = await prisma.user.updateMany({
    where: { id: userId, mfaTicketNonceHash: sha256Hex(nonce) },
    data: { mfaTicketNonceHash: null },
  });
  return r.count === 1;
}

// ─── Remembered devices ───────────────────────────────────────────────────────

/** "Chrome on Windows" style label (display only). */
export function deviceLabel(ua: string | null | undefined): string {
  const s = ua || '';
  const browser = /Edg\//.test(s) ? 'Edge' : /Firefox\//.test(s) ? 'Firefox' : /Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : 'Browser';
  const os = /iPhone|iPad/.test(s) ? 'iOS' : /Android/.test(s) ? 'Android' : /Windows/.test(s) ? 'Windows' : /Mac OS X/.test(s) ? 'macOS' : /Linux/.test(s) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

async function rememberedDevice(req: Request | undefined, userId: string): Promise<boolean> {
  const parsed = readDeviceCookie(cookieFromHeader(req?.headers.get('cookie'), DEVICE_COOKIE));
  if (!parsed || parsed.userId !== userId) return false;
  const now = new Date();
  const r = await prisma.mfaTrustedDevice.updateMany({
    where: { id: parsed.deviceId, userId, revokedAt: null, expiresAt: { gt: now } },
    data: { lastUsedAt: now },
  });
  return r.count === 1;
}

async function trustDevice(req: Request | undefined, userId: string): Promise<{ value: string; expires: Date }> {
  const expires = new Date(Date.now() + DEVICE_TTL_MS);
  const row = await prisma.mfaTrustedDevice.create({
    data: { userId, expiresAt: expires, label: deviceLabel(req?.headers.get('user-agent')) },
    select: { id: true },
  });
  return { value: signDeviceCookie(userId, row.id, expires.getTime()), expires };
}

/** Revoke every remembered device (2FA reset, password change / reset). */
export async function revokeTrustedDevices(userId: string): Promise<number> {
  const r = await prisma.mfaTrustedDevice.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  return r.count;
}

// ─── Step 1: first factor ─────────────────────────────────────────────────────

async function afterFirstFactor(req: Request | undefined, user: SignInUser, method: TicketMethod): Promise<StepResult> {
  if (!(await mfaRequiredFor(user))) {
    return { ok: true, next: 'done', ticket: await issueTicket(user.id, 'single', method, 'none') };
  }
  if (user.mfaEnabledAt && user.mfaSecretEnc) {
    if (await rememberedDevice(req, user.id)) {
      return { ok: true, next: 'done', ticket: await issueTicket(user.id, 'verified', method, 'device') };
    }
    if (isLocked(user.mfaLockedUntil)) return lockedResult(minutesLeft(user.mfaLockedUntil!));
    return { ok: true, next: 'mfa', ticket: await issueTicket(user.id, 'challenge', method) };
  }
  return { ok: true, next: 'enroll', ticket: await issueTicket(user.id, 'enroll', method) };
}

function inactive(user: SignInUser): string | null {
  if (user.status !== 'ACTIVE') return 'inactive_user';
  if (user.role !== 'SUPER_ADMIN' && user.organization && !user.organization.active) return 'inactive_org';
  return null;
}

export async function startPasswordSignIn(input: { email: string; password: string; req?: Request }): Promise<StepResult> {
  const email = input.email.trim().toLowerCase();
  const limited = ipLimited(input.req, 'staff-login');
  if (limited) return limited;

  const user = await loadUserByEmail(email);
  if (!user) {
    countIpFailure(input.req, 'staff-login');
    await burnCompare(input.password);
    // Unknown email: same lock message after the same number of tries (in memory), so it does not reveal accounts
    const u = rateLimit(`staff-login-unknown:${sha256Hex(email)}`, MAX_FAILED_ATTEMPTS - 1, LOCK_MS);
    await audit(input.req, 'LOGIN_FAILED', null, 'FAILURE', { method: 'password', reason: 'unknown_user' });
    return u.ok ? fail(401, BAD_CREDENTIALS) : lockedResult(minutesLeft(u.retryAt));
  }
  if (isLocked(user.loginLockedUntil)) {
    countIpFailure(input.req, 'staff-login');
    await audit(input.req, 'LOGIN_FAILED', user, 'FAILURE', { method: 'password', reason: 'locked' });
    return lockedResult(minutesLeft(user.loginLockedUntil!));
  }
  const why = !user.passwordHash ? 'no_password' : inactive(user);
  if (why) {
    countIpFailure(input.req, 'staff-login');
    await burnCompare(input.password);
    await audit(input.req, 'LOGIN_FAILED', user, 'FAILURE', { method: 'password', reason: why });
    return fail(401, BAD_CREDENTIALS);
  }
  const valid = await compare(input.password, user.passwordHash!);
  if (!valid) {
    countIpFailure(input.req, 'staff-login');
    const next = registerFailure({ count: user.failedLoginCount, lockedUntil: user.loginLockedUntil });
    await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: next.count, loginLockedUntil: next.lockedUntil } });
    await audit(input.req, 'LOGIN_FAILED', user, 'FAILURE', { method: 'password', reason: 'bad_password' });
    if (next.lockedNow) {
      await audit(input.req, 'LOGIN_LOCKED', user, 'FAILURE', { method: 'password', minutes: LOCK_MINUTES });
      return lockedResult(LOCK_MINUTES);
    }
    return fail(401, BAD_CREDENTIALS);
  }
  if (user.failedLoginCount || user.loginLockedUntil) {
    await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, loginLockedUntil: null } });
  }
  return afterFirstFactor(input.req, user, 'password');
}

export async function startOtpSignIn(input: { email: string; code: string; req?: Request }): Promise<StepResult> {
  const email = input.email.trim().toLowerCase();
  const limited = ipLimited(input.req, 'staff-login');
  if (limited) return limited;
  const user = await loadUserByEmail(email);
  if (user && isLocked(user.loginLockedUntil)) {
    await audit(input.req, 'LOGIN_FAILED', user, 'FAILURE', { method: 'otp', reason: 'locked' });
    return lockedResult(minutesLeft(user.loginLockedUntil!));
  }
  const verified = await verifyEmailOtp(email, input.code, 'LOGIN');
  if (!verified.ok || !user) {
    countIpFailure(input.req, 'staff-login');
    await audit(input.req, 'LOGIN_FAILED', user, 'FAILURE', { method: 'otp', reason: user ? 'bad_code' : 'unknown_user' });
    return fail(401, BAD_EMAIL_CODE);
  }
  const why = inactive(user);
  if (why) {
    await audit(input.req, 'LOGIN_FAILED', user, 'FAILURE', { method: 'otp', reason: why });
    return fail(401, BAD_EMAIL_CODE);
  }
  return afterFirstFactor(input.req, user, 'otp');
}

// ─── Step 2: two-factor ───────────────────────────────────────────────────────

async function registerMfaFailure(req: Request | undefined, user: SignInUser, reason: string): Promise<StepResult> {
  countIpFailure(req, 'staff-mfa');
  const next = registerFailure({ count: user.mfaFailedCount, lockedUntil: user.mfaLockedUntil });
  await prisma.user.update({ where: { id: user.id }, data: { mfaFailedCount: next.count, mfaLockedUntil: next.lockedUntil } });
  await audit(req, 'MFA_CHALLENGE_FAILED', user, 'FAILURE', { reason });
  if (next.lockedNow) {
    await audit(req, 'MFA_LOCKED', user, 'FAILURE', { minutes: LOCK_MINUTES });
    return lockedResult(LOCK_MINUTES);
  }
  return fail(401, BAD_MFA_CODE);
}

/** TOTP code or recovery code at sign-in (stage "challenge"). */
export async function verifySecondFactor(input: { ticket: string; code: string; rememberDevice?: boolean; req?: Request }): Promise<StepResult> {
  const limited = ipLimited(input.req, 'staff-mfa');
  if (limited) return limited;
  const t = await loadTicket(input.ticket, ['challenge']);
  if (!t) return fail(401, SIGN_IN_EXPIRED);
  const { user, p } = t;
  if (isLocked(user.mfaLockedUntil)) return lockedResult(minutesLeft(user.mfaLockedUntil!));
  const secret = decryptField(user.mfaSecretEnc);
  if (!secret) return fail(503, MFA_UNAVAILABLE);

  const code = String(input.code || '').trim();
  let factor: SecondFactor;
  let remaining: number | undefined;
  if (looksLikeRecoveryCode(code)) {
    const idx = findRecoveryCode(code, user.mfaRecoveryCodes);
    if (idx < 0) return registerMfaFailure(input.req, user, 'bad_recovery_code');
    const rest = user.mfaRecoveryCodes.filter((_, i) => i !== idx);
    // Single use: only succeeds when the stored list is still the one we read
    const r = await prisma.user.updateMany({
      where: { id: user.id, mfaRecoveryCodes: { equals: user.mfaRecoveryCodes } },
      data: { mfaRecoveryCodes: rest },
    });
    if (r.count !== 1) return registerMfaFailure(input.req, user, 'recovery_code_race');
    remaining = rest.length;
    factor = 'recovery';
    await audit(input.req, 'MFA_RECOVERY_USED', user, 'SUCCESS', { remaining });
  } else {
    const v = verifyTotp(secret, code, { lastUsedStep: user.mfaLastUsedStep });
    if (!v.ok) return registerMfaFailure(input.req, user, v.reason === 'replay' ? 'code_reused' : 'bad_code');
    // Replay guard across concurrent requests: the step only moves forward
    const r = await prisma.user.updateMany({
      where: { id: user.id, OR: [{ mfaLastUsedStep: null }, { mfaLastUsedStep: { lt: v.step } }] },
      data: { mfaLastUsedStep: v.step },
    });
    if (r.count !== 1) return registerMfaFailure(input.req, user, 'code_reused');
    factor = 'totp';
  }
  await prisma.user.update({ where: { id: user.id }, data: { mfaFailedCount: 0, mfaLockedUntil: null } });
  await audit(input.req, 'MFA_CHALLENGE_SUCCESS', user, 'SUCCESS', { factor });
  const deviceCookie = input.rememberDevice ? await trustDevice(input.req, user.id) : undefined;
  return {
    ok: true,
    next: 'done',
    ticket: await issueTicket(user.id, 'verified', p.m, factor),
    ...(deviceCookie ? { deviceCookie } : {}),
    ...(remaining !== undefined ? { remainingRecoveryCodes: remaining } : {}),
  };
}

/** QR code as an SVG data URL (rendered on the server: the secret never goes to a third party). */
export function qrDataUrl(text: string): string {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  const svg = q.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

/** Enrollment step 1 (stage "enroll"): new secret (stored encrypted as pending) + QR + manual key. */
export async function beginEnrollment(input: { ticket: string; req?: Request }): Promise<
  { ok: true; qr: string; manualKey: string; otpauthUri: string; account: string; status?: undefined; error?: undefined } | { ok: false; status: number; error: string }
> {
  const limited = ipLimited(input.req, 'staff-mfa');
  if (limited && !limited.ok) return { ok: false, status: limited.status, error: limited.error };
  const t = await loadTicket(input.ticket, ['enroll']);
  if (!t) return { ok: false, status: 401, error: SIGN_IN_EXPIRED };
  if (!fieldEncryptionConfigured()) return { ok: false, status: 503, error: MFA_UNAVAILABLE };
  const secret = generateTotpSecret();
  const enc = encryptField(secret);
  if (!enc) return { ok: false, status: 503, error: MFA_UNAVAILABLE };
  await prisma.user.update({ where: { id: t.user.id }, data: { mfaPendingSecretEnc: enc } });
  const uri = otpauthUri(secret, t.user.email);
  return { ok: true, qr: qrDataUrl(uri), manualKey: formatManualKey(secret), otpauthUri: uri, account: t.user.email };
}

/** Enrollment step 2: the first code confirms the authenticator; returns 10 recovery codes (shown once). */
export async function confirmEnrollment(input: { ticket: string; code: string; rememberDevice?: boolean; req?: Request }): Promise<StepResult> {
  const limited = ipLimited(input.req, 'staff-mfa');
  if (limited) return limited;
  const t = await loadTicket(input.ticket, ['enroll']);
  if (!t) return fail(401, SIGN_IN_EXPIRED);
  const { user, p } = t;
  if (isLocked(user.mfaLockedUntil)) return lockedResult(minutesLeft(user.mfaLockedUntil!));
  const secret = decryptField(user.mfaPendingSecretEnc);
  if (!secret) return fail(400, 'Start the setup again to get a new QR code.');
  const v = verifyTotp(secret, input.code);
  if (!v.ok) return registerMfaFailure(input.req, user, 'bad_enrollment_code');

  const codes = generateRecoveryCodes();
  const r = await prisma.user.updateMany({
    where: { id: user.id, mfaPendingSecretEnc: user.mfaPendingSecretEnc },
    data: {
      mfaSecretEnc: user.mfaPendingSecretEnc,
      mfaPendingSecretEnc: null,
      mfaEnabledAt: new Date(),
      mfaLastUsedStep: v.step,
      mfaRecoveryCodes: codes.map(hashRecoveryCode),
      mfaFailedCount: 0,
      mfaLockedUntil: null,
    },
  });
  if (r.count !== 1) return fail(409, 'Start the setup again to get a new QR code.');
  await audit(input.req, 'MFA_ENROLLED', user, 'SUCCESS', { recoveryCodes: codes.length });
  const deviceCookie = input.rememberDevice ? await trustDevice(input.req, user.id) : undefined;
  return {
    ok: true,
    next: 'done',
    ticket: await issueTicket(user.id, 'verified', p.m, 'enrolled'),
    recoveryCodes: codes,
    ...(deviceCookie ? { deviceCookie } : {}),
  };
}

// ─── Step 3: NextAuth authorize ───────────────────────────────────────────────

/** The DB user for a final ticket ("verified", or "single" while 2FA is not required), or null. Single use. */
export async function completeSignIn(ticket: string, req?: Request): Promise<{ user: SignInUser; factor: SecondFactor; method: TicketMethod } | null> {
  const t = await loadTicket(ticket, ['verified', 'single']);
  if (!t) {
    await audit(req, 'LOGIN_FAILED', null, 'FAILURE', { method: 'ticket', reason: 'bad_ticket' });
    return null;
  }
  const { user, p } = t;
  if (p.s === 'single' && (await mfaRequiredFor(user))) {
    await audit(req, 'LOGIN_FAILED', user, 'FAILURE', { method: p.m, reason: 'mfa_required' });
    return null;
  }
  if (!(await consumeNonce(user.id, p.n))) {
    await audit(req, 'LOGIN_FAILED', user, 'FAILURE', { method: p.m, reason: 'ticket_reused' });
    return null;
  }
  const factor: SecondFactor = p.f ?? 'none';
  await audit(req, 'LOGIN', user, 'SUCCESS', { method: p.m, mfa: factor });
  return { user, factor, method: p.m };
}

// ─── Admin reset ──────────────────────────────────────────────────────────────

/**
 * Admin (ADMIN / PRACTICE_DIRECTOR) clears a staff member's authenticator, recovery codes, 2FA lock
 * and remembered devices; they set up 2FA again at their next sign-in. Same organization, never self.
 */
export async function resetStaffMfa(input: {
  targetUserId: string;
  actor: { userId: string; role: string; organizationId: string };
  req?: Request;
}): Promise<{ ok: true; status?: undefined; error?: undefined } | { ok: false; status: number; error: string }> {
  if (input.targetUserId === input.actor.userId) {
    return { ok: false, status: 400, error: 'You cannot reset your own two-factor sign-in. Ask another administrator.' };
  }
  const target = await prisma.user.findUnique({
    where: { id: input.targetUserId },
    select: { id: true, organizationId: true, role: true, mfaEnabledAt: true },
  });
  if (!target || target.organizationId !== input.actor.organizationId || target.role === 'SUPER_ADMIN') {
    return { ok: false, status: 404, error: 'Staff member not found' };
  }
  await prisma.user.update({
    where: { id: target.id },
    data: {
      mfaSecretEnc: null,
      mfaPendingSecretEnc: null,
      mfaEnabledAt: null,
      mfaLastUsedStep: null,
      mfaRecoveryCodes: [],
      mfaFailedCount: 0,
      mfaLockedUntil: null,
      mfaTicketNonceHash: null,
    },
  });
  const devices = await revokeTrustedDevices(target.id);
  await writeAuditLog({
    action: 'MFA_RESET',
    actorUserId: input.actor.userId,
    actorRole: input.actor.role,
    organizationId: input.actor.organizationId,
    resourceType: 'user',
    resourceId: target.id,
    outcome: 'SUCCESS',
    ...auditRequestMeta(input.req),
    metadata: { wasEnrolled: Boolean(target.mfaEnabledAt), devicesRevoked: devices },
  });
  return { ok: true };
}
