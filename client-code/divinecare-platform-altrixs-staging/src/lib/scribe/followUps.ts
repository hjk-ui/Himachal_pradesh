/** Where each kind of accepted follow-up is done (existing pages); used for the My To-Do link. */
import type { FOLLOW_UP_KINDS } from './draft';

/** Where each kind of follow-up is done (existing pages). */
export const FOLLOW_UP_HREF: Record<(typeof FOLLOW_UP_KINDS)[number], (clientId: string) => string> = {
  next_visit: (c) => `/dashboard/appointments?clientId=${encodeURIComponent(c)}`,
  lab: (c) => `/dashboard/labs?clientId=${encodeURIComponent(c)}`,
  referral: (c) => `/dashboard/clients/${encodeURIComponent(c)}`,
  letter: (c) => `/dashboard/clients/${encodeURIComponent(c)}`,
  coordination: (c) => `/dashboard/clients/${encodeURIComponent(c)}`,
  measure: () => '/dashboard/ehr/assessments',
  other: (c) => `/dashboard/clients/${encodeURIComponent(c)}`,
};

