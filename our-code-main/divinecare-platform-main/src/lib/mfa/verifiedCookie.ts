import { createHmac, timingSafeEqual } from 'node:crypto';
import { getAuthSecret } from '@/lib/security/secrets';

/**
 * "This sign-in passed MFA" marker — a signed, httpOnly cookie bound to the user id.
 * Value: <userId>.<expiresAtMs>.<hmac>
 */
export const MFA_VERIFIED_COOKIE = 'dc-mfa-verified';
export const MFA_VERIFIED_TTL_MS = 12 * 60 * 60 * 1000;

function sign(userId: string, expiresAt: number) {
  return createHmac('sha256', getAuthSecret()).update(`mfa:${userId}:${expiresAt}`).digest('base64url');
}

export function issueVerifiedValue(userId: string, now = Date.now()): string {
  const exp = now + MFA_VERIFIED_TTL_MS;
  return `${userId}.${exp}.${sign(userId, exp)}`;
}

export function isVerifiedValue(value: string | undefined | null, userId: string, now = Date.now()): boolean {
  if (!value) return false;
  const [uid, expRaw, sig] = value.split('.');
  const exp = Number(expRaw);
  if (uid !== userId || !Number.isFinite(exp) || exp <= now || !sig) return false;
  const expected = Buffer.from(sign(userId, exp));
  const actual = Buffer.from(sig);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export const verifiedCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  secure: process.env.NODE_ENV === 'production',
  maxAge: MFA_VERIFIED_TTL_MS / 1000,
};
