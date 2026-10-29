/**
 * Sign-in throttling rules (pure, shared by the sign-in routes and tests). Counters live on the
 * User row (failedLoginCount / loginLockedUntil, mfaFailedCount / mfaLockedUntil) so a lock
 * survives restarts and applies across servers; the per-IP limits use src/lib/security/rateLimit.
 */
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;
export const LOCK_MS = LOCK_MINUTES * 60 * 1000;

/** Per-IP password attempts. */
export const IP_LOGIN_LIMIT = 20;
export const IP_WINDOW_MS = 15 * 60 * 1000;
/** Email one-time codes: requests per account and per IP; wrong guesses per code. */
export const OTP_REQUEST_LIMIT = 5;
export const OTP_MAX_GUESSES = 5;

export type LockState = { count: number; lockedUntil: Date | null };

export function isLocked(lockedUntil: Date | null | undefined, now: Date = new Date()): boolean {
  return Boolean(lockedUntil && lockedUntil.getTime() > now.getTime());
}

/** Whole minutes left on a lock (at least 1). */
export function minutesLeft(until: Date | number, now: Date = new Date()): number {
  const ms = (typeof until === 'number' ? until : until.getTime()) - now.getTime();
  return Math.max(1, Math.ceil(ms / 60_000));
}

export function lockMessage(minutes: number): string {
  return `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
}

/**
 * Next counter state after a failed attempt. A lock that has expired starts a fresh count. On the
 * MAX_FAILED_ATTEMPTS-th failure the account locks for LOCK_MS and the counter resets.
 */
export function registerFailure(state: LockState, now: Date = new Date()): LockState & { lockedNow: boolean } {
  const prior = state.lockedUntil && !isLocked(state.lockedUntil, now) ? 0 : state.count;
  const count = prior + 1;
  if (count >= MAX_FAILED_ATTEMPTS) {
    return { count: 0, lockedUntil: new Date(now.getTime() + LOCK_MS), lockedNow: true };
  }
  return { count, lockedUntil: isLocked(state.lockedUntil, now) ? state.lockedUntil : null, lockedNow: false };
}
