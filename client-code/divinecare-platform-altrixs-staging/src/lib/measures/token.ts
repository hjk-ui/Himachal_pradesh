/**
 * Measure links (/m/<token>): token, date-of-birth check and lock rules. Server-only helpers but
 * no database (tests use them directly).
 *
 *  - The raw token (32 random bytes, base64url) exists only in the message; the table keeps its
 *    sha256 (MeasureRequest.tokenHash), like staff invites.
 *  - Before anything is shown the patient enters their date of birth. 3 wrong tries lock the link
 *    (status locked, audit MEASURE_LINK_LOCKED); staff send a new one.
 *  - Links expire 7 days after they are created.
 *  - After the DOB check a session secret goes in an httpOnly cookie (sha256 in sessionHash) for
 *    2 hours, so saving answers never asks again and never carries the DOB.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const LINK_TTL_DAYS = 7;
export const MAX_DOB_ATTEMPTS = 3;
export const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
export const SESSION_COOKIE = 'altrixs_measure_session';

export function newMeasureToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashMeasureToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** Token shape check before any lookup (base64url, 20–100 chars) */
export function isTokenShape(raw: unknown): raw is string {
  return typeof raw === 'string' && /^[A-Za-z0-9_-]{20,100}$/.test(raw);
}

export function linkExpiry(from: Date): Date {
  return new Date(from.getTime() + LINK_TTL_DAYS * 86_400_000);
}

/**
 * YYYY-MM-DD from what a patient types: 2001-03-04, 03/04/2001, 3/4/2001, 03-04-2001, 03042001.
 * Null when it is not a real calendar date.
 */
export function normalizeDob(input: unknown): string | null {
  const s = String(input ?? '').trim();
  let y: number, m: number, d: number;
  let match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) {
    [m, d, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = s.match(/^(\d{2})(\d{2})(\d{4})$/))) {
    [m, d, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  if (y < 1900 || y > 2100) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Chart DOB (stored at UTC midnight, or a date-only value) as YYYY-MM-DD */
export function chartDob(dob: Date | string | null | undefined): string | null {
  if (!dob) return null;
  const d = typeof dob === 'string' ? new Date(dob) : dob;
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/** Constant-time compare of the typed DOB with the chart */
export function dobMatches(typed: unknown, onChart: Date | string | null | undefined): boolean {
  const a = normalizeDob(typed);
  const b = chartDob(onChart);
  if (!a || !b) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export type LinkState = 'verify' | 'ready' | 'completed' | 'expired' | 'locked' | 'cancelled' | 'not_sent';

/** What the public page may do with a request row (no PHI in this decision) */
export function linkState(row: { status: string; expiresAt: Date; lockedAt: Date | null; completedAt: Date | null }, now: Date, verified: boolean): LinkState {
  if (row.completedAt || row.status === 'completed') return 'completed';
  if (row.lockedAt || row.status === 'locked') return 'locked';
  if (row.status === 'cancelled') return 'cancelled';
  if (row.status === 'not_sent' || row.status === 'pending') return 'not_sent';
  if (row.status === 'expired' || row.expiresAt.getTime() <= now.getTime()) return 'expired';
  return verified ? 'ready' : 'verify';
}

/** After a wrong DOB: the new attempt count and whether the link is now locked */
export function afterFailedDob(attempts: number): { attempts: number; locked: boolean; remaining: number } {
  const next = attempts + 1;
  return { attempts: next, locked: next >= MAX_DOB_ATTEMPTS, remaining: Math.max(0, MAX_DOB_ATTEMPTS - next) };
}

export function sessionValid(row: { sessionHash: string | null; sessionExpiresAt: Date | null }, cookie: string | null | undefined, now: Date): boolean {
  if (!cookie || !row.sessionHash || !row.sessionExpiresAt || row.sessionExpiresAt.getTime() <= now.getTime()) return false;
  const h = hashMeasureToken(cookie);
  return h.length === row.sessionHash.length && timingSafeEqual(Buffer.from(h), Buffer.from(row.sessionHash));
}
