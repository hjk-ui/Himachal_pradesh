/**
 * Signed, short-lived sign-in tickets and the "Remember this device" cookie (pure; HMAC-SHA256
 * with AUTH_SECRET). Neither carries a secret: a ticket is accepted only while its nonce matches
 * User.mfaTicketNonceHash (single use, rotated at every step) and a device cookie only while its
 * MfaTrustedDevice row exists, belongs to the same user, and is not revoked or expired.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Ticket stages:
 *  - challenge: password / email code OK, TOTP or recovery code still needed
 *  - enroll:    password / email code OK, no authenticator yet: set one up first
 *  - verified:  both factors done (or a remembered device) — NextAuth may sign in
 *  - single:    password / email code OK and 2FA not required for this account (MFA_ENFORCE=false or practice off)
 */
export type TicketStage = 'challenge' | 'enroll' | 'verified' | 'single';
export type TicketMethod = 'password' | 'otp';
/** How the second factor was satisfied (audit + JWT claim). */
export type SecondFactor = 'totp' | 'recovery' | 'device' | 'enrolled' | 'none';

export type TicketPayload = {
  u: string; // user id
  s: TicketStage;
  n: string; // nonce (its sha256 is stored on the user row)
  m: TicketMethod;
  f?: SecondFactor;
  e: number; // expiry, ms
};

export const TICKET_TTL_MS = 10 * 60 * 1000;
export const DEVICE_COOKIE = 'altrixs_mfa_device';
export const DEVICE_TTL_DAYS = 30;
export const DEVICE_TTL_MS = DEVICE_TTL_DAYS * 24 * 60 * 60 * 1000;

export function authSecret(): string {
  const s = process.env.AUTH_SECRET?.trim();
  if (s) return s;
  if (process.env.NODE_ENV === 'production') throw new Error('AUTH_SECRET is not configured');
  return 'dev-auth-secret';
}

function mac(purpose: string, data: string, secret: string): string {
  return createHmac('sha256', `${purpose}:${secret}`).update(data).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function sha256Hex(v: string): string {
  return createHash('sha256').update(v).digest('hex');
}

export function newNonce(): string {
  return randomBytes(18).toString('base64url');
}

export function signTicket(p: TicketPayload, secret: string = authSecret()): string {
  const body = Buffer.from(JSON.stringify(p)).toString('base64url');
  return `${body}.${mac('mfa-ticket', body, secret)}`;
}

/** Payload when the signature is valid and the ticket has not expired; else null. */
export function readTicket(ticket: string, nowMs: number = Date.now(), secret: string = authSecret()): TicketPayload | null {
  if (typeof ticket !== 'string' || ticket.length > 2000) return null;
  const [body, sig] = ticket.split('.');
  if (!body || !sig || !safeEqual(sig, mac('mfa-ticket', body, secret))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TicketPayload;
    if (!p || typeof p.u !== 'string' || typeof p.n !== 'string' || typeof p.e !== 'number') return null;
    if (!['challenge', 'enroll', 'verified', 'single'].includes(p.s)) return null;
    if (p.e <= nowMs) return null;
    return p;
  } catch {
    return null;
  }
}

/** Cookie value "<userId>.<deviceId>.<expiryMs>.<sig>". */
export function signDeviceCookie(userId: string, deviceId: string, expMs: number, secret: string = authSecret()): string {
  const body = `${userId}.${deviceId}.${expMs}`;
  return `${body}.${mac('mfa-device', body, secret)}`;
}

export function readDeviceCookie(
  value: string | null | undefined,
  nowMs: number = Date.now(),
  secret: string = authSecret()
): { userId: string; deviceId: string; expMs: number } | null {
  if (!value || value.length > 500) return null;
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  const [userId, deviceId, expStr, sig] = parts;
  const expMs = Number(expStr);
  if (!userId || !deviceId || !Number.isFinite(expMs) || expMs <= nowMs) return null;
  if (!safeEqual(sig, mac('mfa-device', `${userId}.${deviceId}.${expStr}`, secret))) return null;
  return { userId, deviceId, expMs };
}

/** Value of one cookie from a Cookie request header. */
export function cookieFromHeader(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}
