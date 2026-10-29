/**
 * Phone-first layout classes for patient-facing pages (portal, intake, booking, telehealth join).
 * Patients mostly use a phone one-handed: actions stack full width below `sm`, every control is
 * at least 44px tall, and text inputs use 16px text so iOS does not zoom on focus.
 */

/** Page container: phone gutter, no horizontal overflow, full dynamic viewport height. */
export const PORTAL_MAIN = 'mx-auto min-h-[100dvh] w-full min-w-0 max-w-2xl px-4 py-6 sm:py-10';

/** Row of buttons: stacked full width on phones, inline from `sm`. */
export const PORTAL_ACTIONS = 'flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center';

/** Button sizing inside PORTAL_ACTIONS (and any lone primary action). */
export const PORTAL_BUTTON = 'min-h-11 w-full sm:w-auto';

/** Text input / select sizing: 44px tall, 16px text on phones (no iOS zoom), 14px from `sm`. */
export const PORTAL_FIELD = 'min-h-11 text-base sm:text-sm';

/** Checkbox / radio big enough to hit with a thumb. */
export const PORTAL_CHECK = 'mt-0.5 h-5 w-5 shrink-0 rounded border-slate-300 text-blue-600 focus:ring-blue-600';
