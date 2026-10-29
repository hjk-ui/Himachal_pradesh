import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { hashSync } from 'bcryptjs';

/**
 * DrFirst security questionnaire hardening (Oct 24): staff two-factor sign-in (TOTP), recovery
 * codes, lockout, idle / absolute session limits, password policy, CSP, outdated-browser check.
 */
process.env.PHI_FIELD_ENCRYPTION_KEY = 'a'.repeat(64);
process.env.AUTH_SECRET = 'test-auth-secret-for-mfa';

import { base32Decode, base32Encode, otpauthUri, totpCode, totpCodeForStep, totpStep, verifyTotp } from '../src/lib/auth/totp';
import { findRecoveryCode, generateRecoveryCodes, hashRecoveryCode, looksLikeRecoveryCode } from '../src/lib/auth/recoveryCodes';
import { LOCK_MS, MAX_FAILED_ATTEMPTS, isLocked, lockMessage, minutesLeft, registerFailure } from '../src/lib/auth/lockout';
import { ABSOLUTE_SESSION_MS, IDLE_TIMEOUT_MS, SESSION_MAX_AGE_SECONDS, msUntilIdleWarning, sessionExpiry } from '../src/lib/auth/sessionPolicy';
import { PASSWORD_COMMON, PASSWORD_PERSONAL, checkStaffPassword, isCommonPassword } from '../src/lib/auth/passwordPolicy';
import { PASSWORD_MIN_LENGTH, passwordLengthError } from '../src/lib/auth/passwordRules';
import { readDeviceCookie, readTicket, signDeviceCookie, signTicket, cookieFromHeader } from '../src/lib/auth/mfaTokens';
import { CSP_HEADER, CSP_REPORT_ONLY_HEADER, buildCsp, cspHeaderName, generateNonce } from '../src/lib/security/csp';
import { checkBrowser } from '../src/lib/browser/browserSupport';

const ROOT = path.join(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// RFC 6238 appendix B: ASCII "12345678901234567890" (SHA-1)
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

// ─── TOTP ─────────────────────────────────────────────────────────────────────

test('TOTP matches the RFC 6238 SHA-1 vectors (last 6 digits) and base32 round-trips', () => {
  assert.equal(RFC_SECRET, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.equal(base32Decode(RFC_SECRET).toString(), '12345678901234567890');
  assert.equal(totpCode(RFC_SECRET, 59_000), '287082');
  assert.equal(totpCode(RFC_SECRET, 1_111_111_109_000), '081804');
  assert.equal(totpCode(RFC_SECRET, 1_234_567_890_000), '005924');
  assert.equal(totpCode(RFC_SECRET, 2_000_000_000_000), '279037');
});

test('TOTP accepts ±1 time step, refuses ±2, wrong format, and a reused code in its window', () => {
  const now = 1_700_000_000_000;
  const step = totpStep(now);
  for (const d of [-1, 0, 1]) {
    const r = verifyTotp(RFC_SECRET, totpCodeForStep(RFC_SECRET, step + d), { nowMs: now });
    assert.deepEqual(r, { ok: true, step: step + d }, `offset ${d}`);
  }
  for (const d of [-2, 2]) {
    assert.deepEqual(verifyTotp(RFC_SECRET, totpCodeForStep(RFC_SECRET, step + d), { nowMs: now }), { ok: false, reason: 'invalid' });
  }
  assert.deepEqual(verifyTotp(RFC_SECRET, '12345', { nowMs: now }), { ok: false, reason: 'format' });
  assert.deepEqual(verifyTotp(RFC_SECRET, 'abcdef', { nowMs: now }), { ok: false, reason: 'format' });
  // Replay: the code just accepted (and any older step) is refused
  const code = totpCodeForStep(RFC_SECRET, step);
  assert.deepEqual(verifyTotp(RFC_SECRET, code, { nowMs: now, lastUsedStep: step }), { ok: false, reason: 'replay' });
  assert.deepEqual(verifyTotp(RFC_SECRET, totpCodeForStep(RFC_SECRET, step - 1), { nowMs: now, lastUsedStep: step }), { ok: false, reason: 'replay' });
  assert.equal(verifyTotp(RFC_SECRET, totpCodeForStep(RFC_SECRET, step + 1), { nowMs: now, lastUsedStep: step }).ok, true);
});

test('otpauth URI carries issuer, account and the standard parameters', () => {
  const uri = otpauthUri('JBSWY3DPEHPK3PXP', 'pat@clinic.test');
  assert.match(uri, /^otpauth:\/\/totp\/Altrixs%3Apat%40clinic\.test\?/);
  const q = new URL(uri.replace('otpauth://', 'https://x/')).searchParams;
  assert.equal(q.get('secret'), 'JBSWY3DPEHPK3PXP');
  assert.equal(q.get('issuer'), 'Altrixs');
  assert.equal(q.get('digits'), '6');
  assert.equal(q.get('period'), '30');
  assert.equal(q.get('algorithm'), 'SHA1');
});

// ─── Recovery codes ───────────────────────────────────────────────────────────

test('recovery codes: 10 unique, salted hashes at rest, each matches once, input normalized', () => {
  const codes = generateRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  for (const c of codes) assert.match(c, /^[a-z2-9]{5}-[a-z2-9]{5}$/);
  const stored = codes.map(hashRecoveryCode);
  assert.ok(stored.every((h, i) => !h.includes(codes[i].replace('-', ''))), 'never stored in clear');
  assert.notEqual(hashRecoveryCode(codes[0]), hashRecoveryCode(codes[0]), 'salted');
  const idx = findRecoveryCode(codes[3].toUpperCase().replace('-', ' '), stored);
  assert.equal(idx, 3);
  const after = stored.filter((_, i) => i !== idx);
  assert.equal(findRecoveryCode(codes[3], after), -1, 'single use once removed');
  assert.equal(findRecoveryCode('zzzzz-zzzzz', stored), -1);
  assert.equal(looksLikeRecoveryCode(codes[0]), true);
  assert.equal(looksLikeRecoveryCode('123456'), false);
});

// ─── Lockout counters ─────────────────────────────────────────────────────────

test('lockout: 5 failures lock for 15 minutes, an expired lock starts over, message shows minutes', () => {
  const now = new Date('2026-10-24T12:00:00Z');
  let state = { count: 0, lockedUntil: null as Date | null };
  for (let i = 1; i < MAX_FAILED_ATTEMPTS; i++) {
    const r = registerFailure(state, now);
    assert.equal(r.lockedNow, false);
    assert.equal(r.count, i);
    state = r;
  }
  const locked = registerFailure(state, now);
  assert.equal(locked.lockedNow, true);
  assert.equal(locked.lockedUntil!.getTime() - now.getTime(), LOCK_MS);
  assert.equal(isLocked(locked.lockedUntil, now), true);
  assert.equal(minutesLeft(locked.lockedUntil!, now), 15);
  assert.equal(lockMessage(15), 'Too many attempts. Try again in 15 minutes.');
  assert.equal(lockMessage(1), 'Too many attempts. Try again in 1 minute.');
  const later = new Date(now.getTime() + LOCK_MS + 1000);
  assert.equal(isLocked(locked.lockedUntil, later), false);
  const fresh = registerFailure({ count: 4, lockedUntil: locked.lockedUntil }, later);
  assert.equal(fresh.count, 1, 'count restarts after the lock expired');
});

// ─── Session limits ───────────────────────────────────────────────────────────

test('session: 15-minute idle and 12-hour absolute expiry; tokens without times refused', () => {
  const t0 = 1_800_000_000_000;
  assert.equal(SESSION_MAX_AGE_SECONDS, 12 * 60 * 60);
  assert.equal(sessionExpiry({ authTime: t0, lastActivity: t0 }, t0 + IDLE_TIMEOUT_MS - 1), null);
  assert.equal(sessionExpiry({ authTime: t0, lastActivity: t0 }, t0 + IDLE_TIMEOUT_MS), 'idle');
  assert.equal(sessionExpiry({ authTime: t0, lastActivity: t0 + ABSOLUTE_SESSION_MS - 60_000 }, t0 + ABSOLUTE_SESSION_MS), 'absolute');
  assert.equal(sessionExpiry({}, t0), 'absolute');
  assert.equal(msUntilIdleWarning(t0, t0), IDLE_TIMEOUT_MS - 60_000);
});

function loadWithStubs<T>(rel: string, stubs: Record<string, unknown>, cacheKey: RegExp): T {
  const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
  const original = loader._load;
  loader._load = function (id, ...args) {
    if (id === 'server-only') return {};
    if (id in stubs) return stubs[id];
    return original.call(this, id, ...args);
  };
  const req = createRequire(import.meta.url);
  for (const k of Object.keys(req.cache)) if (cacheKey.test(k)) delete req.cache[k];
  try {
    return req(rel) as T;
  } finally {
    loader._load = original;
  }
}

test('JWT callback: sign-in stamps times, idle / absolute tokens return null, heartbeat moves lastActivity', async () => {
  const cfg = loadWithStubs<typeof import('../src/lib/auth/config')>(
    '../src/lib/auth/config',
    {
      '@/lib/db/prisma': { prisma: {} },
      '@/lib/auth/staffSignIn': { completeSignIn: async () => null },
    },
    /lib[\\/]auth[\\/]config/,
  );
  assert.equal(cfg.authConfig.session.maxAge, 12 * 60 * 60);
  const jwt = cfg.authConfig.callbacks.jwt as unknown as (a: object) => Promise<Record<string, unknown> | null>;
  const signedIn = await jwt({ token: {}, user: { id: 'u1', role: 'THERAPIST', roles: ['THERAPIST'], organizationId: 'o1', email: 'a@b.test', name: 'A' } });
  assert.equal(typeof signedIn!.authTime, 'number');
  assert.equal(signedIn!.lastActivity, signedIn!.authTime);
  const now = Date.now();
  assert.equal(await jwt({ token: { id: 'u1', role: 'THERAPIST', authTime: now - 60_000, lastActivity: now - IDLE_TIMEOUT_MS - 1 } }), null, 'idle');
  assert.equal(await jwt({ token: { id: 'u1', role: 'THERAPIST', authTime: now - ABSOLUTE_SESSION_MS - 1, lastActivity: now } }), null, 'absolute');
  assert.equal(await jwt({ token: { id: 'u1', role: 'THERAPIST' } }), null, 'pre-deploy token');
  const beat = await jwt({ token: { id: 'u1', role: 'THERAPIST', authTime: now - 60_000, lastActivity: now - 5 * 60_000 }, trigger: 'update', session: { activity: true } });
  assert.ok((beat!.lastActivity as number) >= now, 'activity heartbeat refreshes lastActivity');
  const noBeat = await jwt({ token: { id: 'u1', role: 'THERAPIST', authTime: now - 60_000, lastActivity: now - 5 * 60_000 } });
  assert.equal(noBeat!.lastActivity, now - 5 * 60_000, 'a plain session read (polling) is not activity');
  // Credentials accept only the single-use ticket (no password / email-code bypass of 2FA)
  const src = read('src/lib/auth/config.ts');
  assert.match(src, /mode: z\.literal\('ticket'\)/);
  assert.doesNotMatch(src, /verifyEmailOtp|compare\(/);
  assert.doesNotMatch(src, /8 hours/);
});

// ─── Password policy ──────────────────────────────────────────────────────────

test('password policy: 12-128 characters, common list (and common + digits), name / email refused', () => {
  assert.equal(PASSWORD_MIN_LENGTH, 12);
  assert.match(passwordLengthError('short-pass1')!, /at least 12/);
  assert.match(checkStaffPassword('x'.repeat(129))!, /128/);
  assert.equal(isCommonPassword('password'), true);
  assert.equal(checkStaffPassword('password1234'), PASSWORD_COMMON);
  assert.equal(checkStaffPassword('Sunshine2024!!'), PASSWORD_COMMON);
  assert.equal(checkStaffPassword('qwertyuiop123'), PASSWORD_COMMON);
  assert.equal(checkStaffPassword('aaaaaaaaaaaaaaaa') !== null, true, 'repetitive');
  assert.equal(checkStaffPassword('Jordan-Mitchell-2026', { email: 'jordan.mitchell@clinic.test', name: 'Jordan Mitchell' }), PASSWORD_PERSONAL);
  assert.equal(checkStaffPassword('my jmitchell login!', { email: 'jmitchell@clinic.test' }), PASSWORD_PERSONAL);
  assert.equal(checkStaffPassword('violet-harbor-lantern-42', { email: 'jordan.mitchell@clinic.test', name: 'Jordan Mitchell' }), null);
  // Bundled list, no network
  const list = read('src/lib/auth/data/commonPasswords.ts');
  assert.ok(list.split('\\n').length >= 9_999, 'top 10,000 list bundled');
  assert.doesNotMatch(read('src/lib/auth/passwordPolicy.ts'), /fetch\(|https?:\/\//);
});

test('every staff password setter applies the policy; patient auth unchanged', () => {
  for (const f of [
    'src/app/api/auth/password/reset/route.ts',
    'src/app/api/auth/setup/route.ts',
    'src/app/api/auth/register/route.ts',
    'src/app/api/staff/route.ts',
    'src/app/api/profile/route.ts',
    'src/lib/staff/invite.ts',
    'src/lib/platform/manage.ts',
  ]) {
    assert.match(read(f), /checkStaffPassword\(/, f);
    assert.doesNotMatch(read(f), /min\(8\)|length < 8/, `${f} keeps no 8-character rule`);
  }
  assert.doesNotMatch(read('src/app/api/patient/invite/accept/route.ts'), /checkStaffPassword/);
  for (const f of ['src/features/auth/components/LoginForm.tsx', 'src/app/invite/accept/page.tsx', 'src/app/get-started/page.tsx', 'src/app/dashboard/settings/page.tsx']) {
    assert.doesNotMatch(read(f), /8 characters|minLength=\{8\}/, f);
  }
});

// ─── Tickets and remembered devices ───────────────────────────────────────────

test('sign-in tickets and device cookies are signed, expire, and reject tampering', () => {
  const now = Date.now();
  const t = signTicket({ u: 'user1', s: 'challenge', n: 'nonce1', m: 'password', e: now + 60_000 });
  assert.equal(readTicket(t, now)?.u, 'user1');
  assert.equal(readTicket(t, now + 61_000), null, 'expired');
  const [body, sig] = t.split('.');
  const forged = Buffer.from(JSON.stringify({ u: 'user1', s: 'verified', n: 'nonce1', m: 'password', e: now + 60_000 })).toString('base64url');
  assert.equal(readTicket(`${forged}.${sig}`, now), null, 'stage cannot be changed');
  assert.equal(readTicket(`${body}.x${sig.slice(1)}`, now), null);
  const c = signDeviceCookie('user1', 'dev1', now + 1000);
  assert.deepEqual(readDeviceCookie(c, now), { userId: 'user1', deviceId: 'dev1', expMs: now + 1000 });
  assert.equal(readDeviceCookie(c.replace('user1', 'user2'), now), null, 'bound to the user');
  assert.equal(readDeviceCookie(c, now + 2000), null, 'expired');
  assert.equal(cookieFromHeader(`a=1; altrixs_mfa_device=${encodeURIComponent(c)}; b=2`, 'altrixs_mfa_device'), c);
});

// ─── Sign-in flow against an in-memory database ───────────────────────────────

type Row = Record<string, any>;

function fakeDb(users: Row[], opts: { mfaRequired?: boolean | null } = {}) {
  const devices: Row[] = [];
  const match = (row: Row, where: Row): boolean =>
    Object.entries(where).every(([k, v]) => {
      if (k === 'OR') return (v as Row[]).some((w) => match(row, w));
      if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
        if ('equals' in v) return JSON.stringify(row[k]) === JSON.stringify(v.equals);
        if ('lt' in v) return row[k] != null && row[k] < v.lt;
        if ('gt' in v) return row[k] != null && row[k] > v.gt;
        return false;
      }
      return row[k] === v;
    });
  const db = {
    user: {
      findUnique: async ({ where }: { where: Row }) => users.find((u) => match(u, where)) ?? null,
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const u = users.find((x) => match(x, where))!;
        Object.assign(u, data);
        return u;
      },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const hit = users.filter((x) => match(x, where));
        hit.forEach((u) => Object.assign(u, data));
        return { count: hit.length };
      },
    },
    practiceSettings: {
      findUnique: async () => (opts.mfaRequired === undefined || opts.mfaRequired === null ? null : { mfaRequired: opts.mfaRequired }),
    },
    mfaTrustedDevice: {
      create: async ({ data }: { data: Row }) => {
        const row = { id: `dev${devices.length + 1}`, revokedAt: null, ...data };
        devices.push(row);
        return row;
      },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const hit = devices.filter((d) => match(d, where));
        hit.forEach((d) => Object.assign(d, data));
        return { count: hit.length };
      },
    },
  };
  return { db, devices };
}

function staffUser(extra: Row = {}): Row {
  return {
    id: 'u1', email: 'pat@clinic.test', name: 'Pat Doe', image: null, role: 'THERAPIST', roles: ['THERAPIST'], status: 'ACTIVE',
    organizationId: 'org1', passwordHash: hashSync('violet-harbor-lantern-42', 4), isMedicalDirector: false, medicalDirectorScope: null,
    failedLoginCount: 0, loginLockedUntil: null, mfaSecretEnc: null, mfaPendingSecretEnc: null, mfaEnabledAt: null, mfaLastUsedStep: null,
    mfaRecoveryCodes: [], mfaFailedCount: 0, mfaLockedUntil: null, mfaTicketNonceHash: null, organization: { active: true },
    ...extra,
  };
}

function loadSignIn(db: unknown, audits: Row[]) {
  return loadWithStubs<typeof import('../src/lib/auth/staffSignIn')>(
    '../src/lib/auth/staffSignIn',
    {
      '@/lib/db/prisma': { prisma: db },
      '@/lib/audit/writeAuditLog': { writeAuditLog: async (e: Row) => { audits.push(e); } },
      '@/lib/auth/otp': { verifyEmailOtp: async () => ({ ok: false }) },
    },
    /lib[\\/]auth[\\/]staffSignIn/,
  );
}

let ipSeq = 0;
const reqFrom = (cookie?: string) =>
  new Request('https://staging.test/api/auth/staff/start', {
    method: 'POST',
    headers: { 'x-forwarded-for': `10.0.${Math.floor(++ipSeq / 200)}.${ipSeq % 200}`, ...(cookie ? { cookie } : {}) },
  });

test('password lockout persists on the user row: 5 wrong -> 15-minute lock, generic errors, LOGIN_LOCKED audited', async () => {
  const users = [staffUser()];
  const audits: Row[] = [];
  const s = loadSignIn(fakeDb(users).db, audits);
  for (let i = 1; i <= 4; i++) {
    const r = await s.startPasswordSignIn({ email: 'pat@clinic.test', password: 'wrong-password-x', req: reqFrom() });
    assert.deepEqual(r, { ok: false, status: 401, error: s.BAD_CREDENTIALS });
  }
  const fifth = await s.startPasswordSignIn({ email: 'pat@clinic.test', password: 'wrong-password-x', req: reqFrom() });
  assert.equal(fifth.ok, false);
  assert.equal(!fifth.ok && fifth.error, 'Too many attempts. Try again in 15 minutes.');
  assert.ok(users[0].loginLockedUntil instanceof Date);
  assert.ok(audits.some((a) => a.action === 'LOGIN_LOCKED' && a.resourceId === 'u1'));
  // Even the right password is refused while locked
  const right = await s.startPasswordSignIn({ email: 'pat@clinic.test', password: 'violet-harbor-lantern-42', req: reqFrom() });
  assert.equal(!right.ok && right.status, 429);
  // Unknown email: same generic message, no identifier in the audit row
  const unknown = await s.startPasswordSignIn({ email: 'nobody@clinic.test', password: 'x', req: reqFrom() });
  assert.deepEqual(unknown, { ok: false, status: 401, error: s.BAD_CREDENTIALS });
  assert.ok(audits.every((a) => !JSON.stringify(a).includes('nobody@clinic.test') && !JSON.stringify(a).includes('wrong-password')));
});

test('per-IP limit: 20 failed attempts per 15 minutes from one address; successful sign-ins never count', async () => {
  const users = [staffUser()];
  const s = loadSignIn(fakeDb(users).db, []);
  const fixed = () => new Request('https://x/api', { headers: { 'x-forwarded-for': '203.0.113.77' } });
  // A clinic behind one public IP: the whole staff signing in at 8 am is not throttled
  for (let i = 0; i < 25; i++) {
    const ok = await s.startPasswordSignIn({ email: 'pat@clinic.test', password: 'violet-harbor-lantern-42', req: fixed() });
    assert.equal(ok.ok, true, `sign-in ${i + 1}`);
  }
  let last: Awaited<ReturnType<typeof s.startPasswordSignIn>> | null = null;
  for (let i = 0; i < 21; i++) last = await s.startPasswordSignIn({ email: `n${i}@clinic.test`, password: 'x', req: fixed() });
  assert.equal(last && !last.ok && last.status, 429);
});

test('2FA enrollment -> challenge: TOTP once (replay refused), recovery code once, 5 wrong -> lock, single-use final ticket', async () => {
  const users = [staffUser()];
  const audits: Row[] = [];
  const { db, devices } = fakeDb(users);
  const s = loadSignIn(db, audits);

  // First sign-in after deploy: enrollment
  const start = await s.startPasswordSignIn({ email: 'pat@clinic.test', password: 'violet-harbor-lantern-42', req: reqFrom() });
  assert.ok(start.ok && start.next === 'enroll');
  const ticket = (start as { ticket: string }).ticket;
  // A password-only ticket cannot sign in
  assert.equal(await s.completeSignIn(ticket), null);
  const enroll = await s.beginEnrollment({ ticket, req: reqFrom() });
  assert.ok(enroll.ok);
  assert.match((enroll as { qr: string }).qr, /^data:image\/svg\+xml;base64,/);
  assert.ok(users[0].mfaPendingSecretEnc?.startsWith('v1:'), 'pending secret stored encrypted');
  const secret = (enroll as { manualKey: string }).manualKey.replace(/\s/g, '');
  assert.ok(!JSON.stringify(users[0]).includes(secret), 'secret never stored in clear');
  const bad = await s.confirmEnrollment({ ticket, code: '000000', req: reqFrom() });
  assert.equal(bad.ok, false);
  const confirmed = await s.confirmEnrollment({ ticket, code: totpCode(secret), rememberDevice: true, req: reqFrom() });
  assert.ok(confirmed.ok && confirmed.recoveryCodes?.length === 10);
  assert.ok(users[0].mfaEnabledAt instanceof Date && users[0].mfaSecretEnc && !users[0].mfaPendingSecretEnc);
  assert.equal(users[0].mfaRecoveryCodes.length, 10);
  assert.ok(audits.some((a) => a.action === 'MFA_ENROLLED'));
  assert.ok(confirmed.ok && confirmed.deviceCookie, 'remember-device cookie issued');
  const recovery = (confirmed as { recoveryCodes: string[] }).recoveryCodes;
  const finalTicket = (confirmed as { ticket: string }).ticket;
  assert.equal((await s.completeSignIn(finalTicket))?.user.id, 'u1');
  assert.equal(await s.completeSignIn(finalTicket), null, 'final ticket is single use');

  // Remembered device skips the code; without the cookie, the challenge comes back
  const cookie = `altrixs_mfa_device=${encodeURIComponent((confirmed as { deviceCookie: { value: string } }).deviceCookie.value)}`;
  const remembered = await s.startPasswordSignIn({ email: 'pat@clinic.test', password: 'violet-harbor-lantern-42', req: reqFrom(cookie) });
  assert.ok(remembered.ok && remembered.next === 'done');
  devices[0].revokedAt = new Date();
  const revoked = await s.startPasswordSignIn({ email: 'pat@clinic.test', password: 'violet-harbor-lantern-42', req: reqFrom(cookie) });
  assert.ok(revoked.ok && revoked.next === 'mfa', 'revoked device asks for the code');

  // TOTP: the enrollment code's step was recorded, so a fresh login must use a newer step
  const ch = (revoked as { ticket: string }).ticket;
  users[0].mfaLastUsedStep = totpStep() - 2; // pretend the enrollment code was a minute ago
  const okCode = totpCode(secret);
  const passed = await s.verifySecondFactor({ ticket: ch, code: okCode, req: reqFrom() });
  assert.ok(passed.ok && passed.next === 'done');
  assert.ok(audits.some((a) => a.action === 'MFA_CHALLENGE_SUCCESS'));
  // Same code again in a new sign-in: refused as a replay
  const again = await s.startPasswordSignIn({ email: 'pat@clinic.test', password: 'violet-harbor-lantern-42', req: reqFrom() });
  const replay = await s.verifySecondFactor({ ticket: (again as { ticket: string }).ticket, code: okCode, req: reqFrom() });
  assert.equal(replay.ok, false);
  assert.ok(audits.some((a) => a.action === 'MFA_CHALLENGE_FAILED' && a.metadata?.reason === 'code_reused'));

  // Recovery code works once
  const t2 = (again as { ticket: string }).ticket;
  const viaRecovery = await s.verifySecondFactor({ ticket: t2, code: recovery[0].toUpperCase(), req: reqFrom() });
  assert.ok(viaRecovery.ok && viaRecovery.remainingRecoveryCodes === 9);
  assert.ok(audits.some((a) => a.action === 'MFA_RECOVERY_USED'));
  const again2 = await s.startPasswordSignIn({ email: 'pat@clinic.test', password: 'violet-harbor-lantern-42', req: reqFrom() });
  const reused = await s.verifySecondFactor({ ticket: (again2 as { ticket: string }).ticket, code: recovery[0], req: reqFrom() });
  assert.equal(reused.ok, false, 'recovery code is single use');

  // Wrong codes: the 5th locks 2FA for 15 minutes (MFA_LOCKED)
  users[0].mfaFailedCount = 0;
  const t3 = (again2 as { ticket: string }).ticket;
  let res: Awaited<ReturnType<typeof s.verifySecondFactor>> | null = null;
  for (let i = 0; i < 5; i++) res = await s.verifySecondFactor({ ticket: t3, code: '000000', req: reqFrom() });
  assert.equal(res && !res.ok && res.error, 'Too many attempts. Try again in 15 minutes.');
  assert.ok(audits.some((a) => a.action === 'MFA_LOCKED'));
  const whileLocked = await s.verifySecondFactor({ ticket: t3, code: totpCode(secret), req: reqFrom() });
  assert.equal(!whileLocked.ok && whileLocked.status, 429);
});

test('admin 2FA reset clears the authenticator and remembered devices (audited, same org, never self)', async () => {
  const users = [staffUser({ mfaSecretEnc: 'v1:x', mfaEnabledAt: new Date(), mfaRecoveryCodes: ['a:b'] }), staffUser({ id: 'admin', email: 'admin@clinic.test', role: 'ADMIN' })];
  const audits: Row[] = [];
  const { db, devices } = fakeDb(users);
  devices.push({ id: 'd1', userId: 'u1', revokedAt: null, expiresAt: new Date(Date.now() + 1e9) });
  const s = loadSignIn(db, audits);
  assert.equal((await s.resetStaffMfa({ targetUserId: 'admin', actor: { userId: 'admin', role: 'ADMIN', organizationId: 'org1' } })).ok, false, 'not self');
  assert.equal((await s.resetStaffMfa({ targetUserId: 'u1', actor: { userId: 'admin', role: 'ADMIN', organizationId: 'org2' } })).ok, false, 'other org');
  assert.deepEqual(await s.resetStaffMfa({ targetUserId: 'u1', actor: { userId: 'admin', role: 'ADMIN', organizationId: 'org1' } }), { ok: true });
  assert.equal(users[0].mfaSecretEnc, null);
  assert.equal(users[0].mfaEnabledAt, null);
  assert.deepEqual(users[0].mfaRecoveryCodes, []);
  assert.ok(devices[0].revokedAt instanceof Date);
  const entry = audits.find((a) => a.action === 'MFA_RESET');
  assert.equal(entry?.resourceId, 'u1');
  assert.equal(entry?.actorUserId, 'admin');
  // Next sign-in: enrollment again
  const next = await s.startPasswordSignIn({ email: 'pat@clinic.test', password: 'violet-harbor-lantern-42', req: reqFrom() });
  assert.ok(next.ok && next.next === 'enroll');
});

test('MFA required by default; practice setting off or MFA_ENFORCE=false lets password-only sign in', async () => {
  const s0 = loadSignIn(fakeDb([staffUser()]).db, []);
  assert.equal(await s0.mfaRequiredFor({ role: 'THERAPIST', organizationId: 'org1' }), true, 'no settings row -> required');
  assert.equal(s0.mfaEnforcedByEnv({}), true);
  assert.equal(s0.mfaEnforcedByEnv({ MFA_ENFORCE: 'false' }), false);
  const off = fakeDb([staffUser()], { mfaRequired: false });
  const s1 = loadSignIn(off.db, []);
  assert.equal(await s1.mfaRequiredFor({ role: 'ADMIN', organizationId: 'org1' }), false);
  assert.equal(await s1.mfaRequiredFor({ role: 'SUPER_ADMIN', organizationId: null }), true, 'platform admins always');
  const r = await s1.startPasswordSignIn({ email: 'pat@clinic.test', password: 'violet-harbor-lantern-42', req: reqFrom() });
  assert.ok(r.ok && r.next === 'done');
  assert.equal((await s1.completeSignIn((r as { ticket: string }).ticket))?.factor, 'none');
  process.env.MFA_ENFORCE = 'false';
  try {
    const s2 = loadSignIn(fakeDb([staffUser()], { mfaRequired: true }).db, []);
    assert.equal(await s2.mfaRequiredFor({ role: 'THERAPIST', organizationId: 'org1' }), false);
  } finally {
    delete process.env.MFA_ENFORCE;
  }
});

test('email one-time code: void after 5 wrong guesses; 5 requests per 15 minutes per account', async () => {
  const codes: Row[] = [];
  const db = {
    user: { findUnique: async () => ({ id: 'u1' }) },
    emailOtp: {
      count: async () => codes.length,
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const hit = codes.filter((c) => (where.id ? c.id === where.id : true) && (where.consumedAt === null ? c.consumedAt === null : true));
        hit.forEach((c) => Object.assign(c, data));
        return { count: hit.length };
      },
      create: async ({ data }: { data: Row }) => {
        const row = { id: `otp${codes.length + 1}`, attempts: 0, consumedAt: null, createdAt: new Date(), ...data };
        codes.push(row);
        return row;
      },
      findFirst: async () => [...codes].reverse().find((c) => c.consumedAt === null && c.attempts < 5) ?? null,
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const c = codes.find((x) => x.id === where.id)!;
        if (data.attempts?.increment) c.attempts += data.attempts.increment;
        if (data.consumedAt) c.consumedAt = data.consumedAt;
        return c;
      },
    },
  };
  const sent: string[] = [];
  const otp = loadWithStubs<typeof import('../src/lib/auth/otp')>(
    '../src/lib/auth/otp',
    { '@/lib/db/prisma': { prisma: db }, '@/lib/mail/sendEmail': { sendEmail: async (m: { text: string }) => { sent.push(m.text); } } },
    /lib[\\/]auth[\\/]otp/,
  );
  assert.equal((await otp.issueEmailOtp('pat@clinic.test', 'LOGIN')).sent, true);
  const code = sent[0].match(/(\d{6})/)![1];
  const wrong = code === '000000' ? '111111' : '000000';
  for (let i = 0; i < 4; i++) assert.equal((await otp.verifyEmailOtp('pat@clinic.test', wrong, 'LOGIN')).ok, false);
  assert.deepEqual(await otp.verifyEmailOtp('pat@clinic.test', wrong, 'LOGIN'), { ok: false, error: 'too_many_guesses' });
  assert.equal((await otp.verifyEmailOtp('pat@clinic.test', code, 'LOGIN')).ok, false, 'the right code no longer works');
  for (let i = 0; i < 4; i++) await otp.issueEmailOtp('pat@clinic.test', 'LOGIN');
  assert.deepEqual(await otp.issueEmailOtp('pat@clinic.test', 'LOGIN'), { sent: false, reason: 'rate_limited' });
});

// ─── Content-Security-Policy ──────────────────────────────────────────────────

test('CSP: nonce scripts, required AWS / Stripe sources, frame-ancestors none except /schedule, report-only switch', () => {
  const nonce = generateNonce();
  assert.match(nonce, /^[A-Za-z0-9+/]{22}==$/);
  const env = { AWS_REGION: 'us-east-1', SCRIBE_UPLOAD_BUCKET: 'altrixs-scribe-uploads', VALANT_IMPORT_S3_BUCKET: 'altrixs-valant-import' };
  const csp = buildCsp({ nonce, pathname: '/dashboard', env });
  const dir = (name: string) => csp.split('; ').find((d) => d.startsWith(`${name} `)) || '';
  assert.match(dir('default-src'), /'self'/);
  assert.match(dir('script-src'), new RegExp(`'nonce-${nonce.replace(/[+/]/g, '\\$&')}'`));
  assert.match(dir('script-src'), /'strict-dynamic'/);
  assert.doesNotMatch(dir('script-src'), /'unsafe-inline'|'unsafe-eval'/);
  for (const src of [
    'wss://transcribestreaming.us-east-1.amazonaws.com:8443',
    'https://*.chime.aws',
    'wss://*.chime.aws',
    'https://altrixs-scribe-uploads.s3.us-east-1.amazonaws.com',
    'https://altrixs-valant-import.s3.amazonaws.com',
    'https://api.stripe.com',
  ]) {
    assert.ok(dir('connect-src').includes(src), src);
  }
  assert.equal(dir('img-src').includes('data:') && dir('img-src').includes('blob:'), true);
  assert.match(dir('media-src'), /blob:/);
  assert.match(dir('frame-src'), /https:\/\/js\.stripe\.com/);
  assert.equal(dir('frame-ancestors'), "frame-ancestors 'none'");
  assert.equal(dir('object-src'), "object-src 'none'");
  assert.match(buildCsp({ nonce, pathname: '/schedule', env }), /frame-ancestors \*/);
  assert.match(buildCsp({ nonce, pathname: '/dashboard', env, dev: true }), /'unsafe-eval'/);
  assert.equal(cspHeaderName({}), CSP_HEADER);
  assert.equal(cspHeaderName({ CSP_REPORT_ONLY: 'true' }), CSP_REPORT_ONLY_HEADER);
  // Wired in the proxy for every route; next.config.js no longer sends a second policy
  const proxy = read('src/proxy.ts');
  assert.match(proxy, /buildCsp\(/);
  assert.match(proxy, /'\/api\/:path\*'/);
  assert.doesNotMatch(read('next.config.js'), /key: 'Content-Security-Policy'/);
  assert.match(read('src/app/layout.tsx'), /await headers\(\)/);
});

// ─── Outdated browser ─────────────────────────────────────────────────────────

test('browser check follows the Next.js 16 baseline (Chrome/Edge/Firefox 111, Safari 16.4) and never flags unknowns', () => {
  const chrome = (v: number) => `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v}.0.0.0 Safari/537.36`;
  assert.equal(checkBrowser(chrome(110)).outdated, true);
  assert.equal(checkBrowser(chrome(111)).outdated, false);
  assert.equal(checkBrowser(`${chrome(109)} Edg/109.0.1518.78`).outdated, true);
  assert.equal(checkBrowser(`${chrome(130)} Edg/130.0.0.0`).browser, 'Edge');
  assert.equal(checkBrowser('Mozilla/5.0 (X11; Linux x86_64; rv:110.0) Gecko/20100101 Firefox/110.0').outdated, true);
  assert.equal(checkBrowser('Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0').outdated, false);
  const safari = (v: string) => `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${v} Safari/605.1.15`;
  assert.equal(checkBrowser(safari('16.3')).outdated, true);
  assert.equal(checkBrowser(safari('16.4')).outdated, false);
  assert.equal(checkBrowser(safari('17.0')).outdated, false);
  const ios = (v: string) => `Mozilla/5.0 (iPhone; CPU iPhone OS ${v} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1`;
  assert.equal(checkBrowser(ios('16_3')).outdated, true, 'iOS browsers use the Safari engine');
  assert.equal(checkBrowser(ios('17_1')).outdated, false);
  assert.equal(checkBrowser('Mozilla/5.0 (Windows NT 10.0; Trident/7.0; rv:11.0) like Gecko').outdated, true);
  assert.equal(checkBrowser('SomeBot/1.0').outdated, false);
  assert.equal(checkBrowser('').outdated, false);
  assert.match(read('src/components/providers/AppProviders.tsx'), /OutdatedBrowserBanner/);
});

// ─── Policy page, admin reset, idle guard wiring ──────────────────────────────

test('security policy states the built controls; admin reset and idle guard are wired', () => {
  const policy = read('src/lib/practice/securityPolicy.ts');
  for (const s of ['12 to 128 characters', '10,000', 'Required for all staff', '15-minute lock', '15 minutes', '12 hours']) {
    assert.ok(policy.includes(s), s);
  }
  assert.doesNotMatch(policy, /Not built|Not available in this build/);
  assert.match(read('src/app/api/staff/[id]/mfa-reset/route.ts'), /requireFullAdmin\(\)/);
  assert.match(read('src/app/dashboard/admin/page.tsx'), /Reset 2FA/);
  assert.match(read('src/app/dashboard/layout.tsx'), /<StaffIdleGuard \/>/);
  const guard = read('src/components/security/StaffIdleGuard.tsx');
  assert.match(guard, /Still there\?/);
  assert.match(guard, /hasLiveMedia\(\)/, 'a live call / recording counts as activity');
  assert.match(guard, /silentActivityBeat\(\)/);
  assert.doesNotMatch(guard, /update\(\{ activity: true \}\)/, 'the heartbeat must not flip the app to loading (screen blink)');
});
