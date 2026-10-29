import { canAccessPath } from '@/lib/auth/roleAccess';

/** Practice settings path (role rule in roleAccess: leadership only). */
export const PRACTICE_SETTINGS_PATH = '/dashboard/practice-setup';

/** Only practice leadership changes practice settings (identifiers, billing, policy, compliance). */
export const PRACTICE_SETTINGS_EDITORS: readonly string[] = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR'];

export function canViewPracticeSettings(role: string | null | undefined): boolean {
  return Boolean(role) && canAccessPath(role, PRACTICE_SETTINGS_PATH);
}

export function canEditPracticeSettings(role: string | null | undefined): boolean {
  return PRACTICE_SETTINGS_EDITORS.includes(String(role || '').toUpperCase());
}

/**
 * GET /api/onboarding: the full practice setup (licenses, NPI, CAQH, payer policy) goes only to
 * practice leadership, or to the founder of a solo practice (the org's only active staff user).
 * Everyone else learns only whether setup is completed.
 */
export function canReadPracticeSetupDetails(role: string | null | undefined, isSoleActiveStaff: boolean): boolean {
  return canEditPracticeSettings(role) || isSoleActiveStaff;
}
