/** Notification count key → Rcopia startup_screen (Oct 23). */
export const DRFIRST_SCREEN_BY_COUNT = {
  pending_prescription: 'report',
  need_signing: 'report',
  refill: 'message',
  rx_change: 'message',
} as const;

export type DrFirstCountKey = keyof typeof DRFIRST_SCREEN_BY_COUNT;
export type DrFirstStartupScreen = 'report' | 'message';

export function screenForCount(key: string): DrFirstStartupScreen | null {
  return (DRFIRST_SCREEN_BY_COUNT as Record<string, DrFirstStartupScreen>)[key] || null;
}

export const UPDATE_POLL_MIN_MS = 5 * 60_000;
export const RETURN_SYNC_THROTTLE_MS = 20_000;
export const RETURN_HIDDEN_MIN_MS = 3_000;
export const SSO_LAUNCH_LOOKBACK_MS = 2 * 60 * 60_000;
