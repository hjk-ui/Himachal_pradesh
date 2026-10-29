/**
 * Staff session limits (pure; client-safe). Enforced server-side in the NextAuth jwt callback
 * (src/lib/auth/config.ts) and mirrored by the client idle timer (StaffIdleGuard).
 *
 *  - Idle: 15 minutes without activity signs the user out. Activity = keyboard / pointer / scroll /
 *    touch, or a live microphone / camera (telehealth call, AI scribe recording) so a session in
 *    progress is never cut off. The client reports activity at most once a minute
 *    (session update { activity: true }), which moves token.lastActivity forward.
 *  - Absolute: 12 hours after sign-in, whatever the activity (JWT maxAge is 12 h as well).
 */
export const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
export const IDLE_WARNING_MS = 60 * 1000;
export const ABSOLUTE_SESSION_MS = 12 * 60 * 60 * 1000;
export const SESSION_MAX_AGE_SECONDS = ABSOLUTE_SESSION_MS / 1000;
/** Client heartbeat interval while the user is active. */
export const ACTIVITY_HEARTBEAT_MS = 60 * 1000;

export type SessionTimes = { authTime?: unknown; lastActivity?: unknown };

/** 'idle' / 'absolute' when the session must end, else null. Tokens minted before this rule (no times) are refused. */
export function sessionExpiry(t: SessionTimes, nowMs: number = Date.now()): 'idle' | 'absolute' | null {
  const authTime = typeof t.authTime === 'number' ? t.authTime : null;
  const last = typeof t.lastActivity === 'number' ? t.lastActivity : null;
  if (authTime === null || last === null) return 'absolute';
  if (nowMs - authTime >= ABSOLUTE_SESSION_MS) return 'absolute';
  if (nowMs - last >= IDLE_TIMEOUT_MS) return 'idle';
  return null;
}

/** Milliseconds until the client should show "Still there?" (0 = now). */
export function msUntilIdleWarning(lastActivityMs: number, nowMs: number = Date.now()): number {
  return Math.max(0, lastActivityMs + IDLE_TIMEOUT_MS - IDLE_WARNING_MS - nowMs);
}
