/**
 * Idle / absolute session policy (Oct 24). Shared by IdleSessionGuard (client)
 * and POST /api/auth/session (server). Pure — no server-only imports.
 */

export const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
export const IDLE_WARNING_MS = 14 * 60 * 1000;
export const ABSOLUTE_SESSION_MS = 12 * 60 * 60 * 1000;
/** Minimum gap between silent heartbeats */
export const HEARTBEAT_INTERVAL_MS = 60 * 1000;

/** httpOnly cookie holding the last recorded activity (epoch ms) */
export const ACTIVITY_COOKIE = 'dc-last-activity';

export function isAbsoluteExpired(loginAt: number | null | undefined, now = Date.now()) {
  return typeof loginAt === 'number' && now - loginAt >= ABSOLUTE_SESSION_MS;
}

export function isIdleExpired(lastActivityAt: number | null | undefined, now = Date.now()) {
  return typeof lastActivityAt === 'number' && now - lastActivityAt >= IDLE_TIMEOUT_MS;
}
