import { prisma } from '@/lib/db/prisma';
import {
  FieldEncryptionError,
  decryptField,
  encryptField,
} from '@/lib/security/fieldEncryption';
import { generateTotpSecret, otpauthUri, verifyTotp } from './totp';
import { consumeRecoveryCode, generateRecoveryCodes } from './recoveryCodes';
import { revokeAllTrustedDevices } from './trustedDevice';
import { MFA_ERRORS, MFA_LOCK_MS, MFA_MAX_FAILED_ATTEMPTS } from './messages';

export type MfaFailure = { ok: false; status: number; error: string };

const mfaSelect = {
  id: true,
  email: true,
  mfaEnabled: true,
  mfaSecretEnc: true,
  mfaRecoveryHashes: true,
  mfaFailedAttempts: true,
  mfaLockedUntil: true,
} as const;

export function loadMfaUser(userId: string) {
  return prisma.user.findUnique({ where: { id: userId }, select: mfaSelect });
}

type MfaUser = NonNullable<Awaited<ReturnType<typeof loadMfaUser>>>;

function isLocked(user: MfaUser) {
  return Boolean(user.mfaLockedUntil && user.mfaLockedUntil > new Date());
}

function lockedFailure(): MfaFailure {
  return { ok: false, status: 429, error: MFA_ERRORS.locked };
}

function configFailure(err: unknown): MfaFailure | null {
  if (err instanceof FieldEncryptionError && err.code === 'NOT_CONFIGURED') {
    return { ok: false, status: 503, error: MFA_ERRORS.notConfigured };
  }
  return null;
}

function failOrThrow(err: unknown): MfaFailure {
  const failure = configFailure(err);
  if (failure) return failure;
  throw err;
}

async function recordFailure(user: MfaUser) {
  const attempts = user.mfaFailedAttempts + 1;
  const lock = attempts >= MFA_MAX_FAILED_ATTEMPTS;
  await prisma.user.update({
    where: { id: user.id },
    data: {
      mfaFailedAttempts: lock ? 0 : attempts,
      mfaLockedUntil: lock ? new Date(Date.now() + MFA_LOCK_MS) : null,
    },
  });
}

async function clearFailures(user: MfaUser) {
  if (user.mfaFailedAttempts === 0 && !user.mfaLockedUntil) return;
  await prisma.user.update({
    where: { id: user.id },
    data: { mfaFailedAttempts: 0, mfaLockedUntil: null },
  });
}

/** Step 1 of enrollment: generate + store (encrypted) a pending secret. MFA stays off until confirmed. */
export async function startEnrollment(userId: string) {
  const user = await loadMfaUser(userId);
  if (!user) return { ok: false, status: 401, error: MFA_ERRORS.unauthorized } as MfaFailure;
  if (user.mfaEnabled) return { ok: false, status: 409, error: MFA_ERRORS.alreadyEnrolled } as MfaFailure;
  try {
    const secret = generateTotpSecret();
    await prisma.user.update({
      where: { id: userId },
      data: { mfaSecretEnc: encryptField(secret) },
    });
    return {
      ok: true as const,
      secret,
      otpauthUri: otpauthUri({ secret, accountEmail: user.email }),
    };
  } catch (err) {
    return failOrThrow(err);
  }
}

/** Step 2: first valid code turns MFA on and returns recovery codes exactly once. */
export async function confirmEnrollment(userId: string, code: string) {
  const user = await loadMfaUser(userId);
  if (!user) return { ok: false, status: 401, error: MFA_ERRORS.unauthorized } as MfaFailure;
  if (user.mfaEnabled) return { ok: false, status: 409, error: MFA_ERRORS.alreadyEnrolled } as MfaFailure;
  if (!user.mfaSecretEnc) return { ok: false, status: 400, error: MFA_ERRORS.notEnrolled } as MfaFailure;
  if (isLocked(user)) return lockedFailure();
  try {
    if (!verifyTotp(decryptField(user.mfaSecretEnc), code)) {
      await recordFailure(user);
      return { ok: false, status: 400, error: MFA_ERRORS.invalidCode } as MfaFailure;
    }
  } catch (err) {
    return failOrThrow(err);
  }
  const { codes, hashes } = generateRecoveryCodes();
  await prisma.user.update({
    where: { id: userId },
    data: { mfaEnabled: true, mfaRecoveryHashes: hashes, mfaFailedAttempts: 0, mfaLockedUntil: null },
  });
  return { ok: true as const, recoveryCodes: codes };
}

/** Sign-in challenge with an authenticator code. */
export async function verifyAuthenticatorCode(userId: string, code: string) {
  const user = await loadMfaUser(userId);
  if (!user) return { ok: false, status: 401, error: MFA_ERRORS.unauthorized } as MfaFailure;
  if (!user.mfaEnabled || !user.mfaSecretEnc) {
    return { ok: false, status: 400, error: MFA_ERRORS.notEnrolled } as MfaFailure;
  }
  if (isLocked(user)) return lockedFailure();
  try {
    if (!verifyTotp(decryptField(user.mfaSecretEnc), code)) {
      await recordFailure(user);
      return { ok: false, status: 400, error: MFA_ERRORS.invalidCode } as MfaFailure;
    }
  } catch (err) {
    return failOrThrow(err);
  }
  await clearFailures(user);
  return { ok: true as const };
}

/** Sign-in challenge with a single-use recovery code. */
export async function verifyRecoveryCode(userId: string, code: string) {
  const user = await loadMfaUser(userId);
  if (!user) return { ok: false, status: 401, error: MFA_ERRORS.unauthorized } as MfaFailure;
  if (!user.mfaEnabled) return { ok: false, status: 400, error: MFA_ERRORS.notEnrolled } as MfaFailure;
  if (isLocked(user)) return lockedFailure();
  const remaining = consumeRecoveryCode(user.mfaRecoveryHashes, code);
  if (!remaining) {
    await recordFailure(user);
    return { ok: false, status: 400, error: MFA_ERRORS.invalidRecovery } as MfaFailure;
  }
  await prisma.user.update({
    where: { id: userId },
    data: { mfaRecoveryHashes: remaining, mfaFailedAttempts: 0, mfaLockedUntil: null },
  });
  return { ok: true as const, recoveryCodesLeft: remaining.length };
}

/** Admin "Reset 2FA": clears secret, recovery codes, lockout, and trusted devices. */
export async function resetMfa(userId: string) {
  await prisma.user.update({
    where: { id: userId },
    data: {
      mfaEnabled: false,
      mfaSecretEnc: null,
      mfaRecoveryHashes: [],
      mfaFailedAttempts: 0,
      mfaLockedUntil: null,
    },
  });
  await revokeAllTrustedDevices(userId);
}
