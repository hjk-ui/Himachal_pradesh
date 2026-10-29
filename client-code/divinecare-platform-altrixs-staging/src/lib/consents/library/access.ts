/** Consent library roles (pure, browser-safe). Page / API access itself is canAccessConsents. */
import { normalizeStaffRole } from '@/lib/auth/rolePersonas';

/** Inbox "Consents to complete": front desk, office manager and leadership (they run intake). */
export const CONSENT_INBOX_ROLES = ['FRONT_DESK', 'OFFICE_MANAGER', 'ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR'] as const;
/** "Consent compliance" report: leadership and the office manager (compliance category). */
export const CONSENT_REPORT_ROLES = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'OFFICE_MANAGER'] as const;

export const canSeeConsentInbox = (role: string | null | undefined) =>
  Boolean(role) && (CONSENT_INBOX_ROLES as readonly string[]).includes(normalizeStaffRole(role));
