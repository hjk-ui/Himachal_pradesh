/**
 * Least-privilege rules for telehealth administration. Pure (no database): safe in tests and the browser.
 *
 * - Org-wide settings (recording mode, waiting room, enabled platforms): leadership + Office Manager.
 * - Session admin actions (resend join link, transfer room, session audit trail): leadership + Office
 *   Manager for any session they can see, otherwise only the session's own clinician.
 */

const TELEHEALTH_ADMIN_ROLES = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'OFFICE_MANAGER'];

function norm(role: string | null | undefined): string {
  return String(role ?? '').toUpperCase();
}

/** Leadership (ADMIN, DIRECTOR, PRACTICE_DIRECTOR) or OFFICE_MANAGER. */
export function isTelehealthAdmin(role: string | null | undefined): boolean {
  return TELEHEALTH_ADMIN_ROLES.includes(norm(role));
}

/** PUT /api/telehealth/settings: org-wide recordingMode, waitingRoom, platforms. */
export function canManageTelehealthSettings(role: string | null | undefined): boolean {
  return isTelehealthAdmin(role);
}

/** Resend link / transfer room on one session: telehealth admins, or the session's own clinician. */
export function canAdministerTelehealthSession(
  role: string | null | undefined,
  userId: string | null | undefined,
  sessionClinicianId: string | null | undefined,
): boolean {
  if (isTelehealthAdmin(role)) return true;
  return Boolean(userId) && Boolean(sessionClinicianId) && userId === sessionClinicianId;
}
