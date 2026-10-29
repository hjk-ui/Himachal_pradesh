import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { getAuthSecret } from '@/lib/security/secrets';

/**
 * Measure link tokens — the raw token only ever exists in the link sent to the patient.
 * The database stores sha256(token) hex and nothing else.
 */

/** 32 random bytes → 43 base64url chars. */
export function generateMeasureToken(): string {
  return randomBytes(32).toString('base64url');
}

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export function isWellFormedMeasureToken(token: unknown): token is string {
  return typeof token === 'string' && TOKEN_SHAPE.test(token);
}

export function hashMeasureToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Patient verification session (after DOB gate): httpOnly cookie, 2 hours. */
export const MEASURE_SESSION_TTL_SECONDS = 2 * 60 * 60;
export const MEASURE_COOKIE_PATH = '/api/measures/public';

export function measureCookieName(requestId: string): string {
  return `measure_${requestId}`;
}

function sign(payload: string): string {
  return createHmac('sha256', getAuthSecret()).update(`measure-session:${payload}`).digest('base64url');
}

export function createMeasureSession(requestId: string, now = Date.now()): string {
  const exp = now + MEASURE_SESSION_TTL_SECONDS * 1000;
  const payload = `${requestId}.${exp}`;
  return `${payload}.${sign(payload)}`;
}

export function verifyMeasureSession(
  requestId: string,
  cookieValue: string | null | undefined,
  now = Date.now()
): boolean {
  if (!cookieValue) return false;
  const parts = cookieValue.split('.');
  if (parts.length !== 3) return false;
  const [id, expRaw, sig] = parts;
  if (id !== requestId) return false;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp <= now) return false;
  const expected = Buffer.from(sign(`${id}.${expRaw}`));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
