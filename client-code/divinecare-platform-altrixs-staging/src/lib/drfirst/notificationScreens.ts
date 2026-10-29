/**
 * Which Rcopia startup screen each DrFirst notification count opens (NCDM2 / NCDM3). The practice
 * runs Rcopia in Single Patient Mode, so a count must take the prescriber straight to the section
 * that lists those items: pending prescriptions and prescriptions to sign live in Rcopia's Report
 * screen, renewal (refill) requests and pharmacy change requests in its Message screen. Both open in
 * Limited Multi Patient Mode (limp_mode=y, /api/drfirst/sso). Screen names to confirm with DrFirst.
 *
 * Keys are the /api/drfirst/notifications count keys.
 */
export const NOTIFICATION_SCREENS = {
  pending_prescription: 'report',
  need_signing: 'report',
  refill: 'message',
  rx_change: 'message',
} as const satisfies Record<string, 'report' | 'message'>;

export type NotificationCountKey = keyof typeof NOTIFICATION_SCREENS;
export type NotificationScreen = (typeof NOTIFICATION_SCREENS)[NotificationCountKey];
