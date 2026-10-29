import { normalizeStaffRole } from '@/lib/auth/rolePersonas';

/**
 * Locations / Practice overview gate. The acting role passes when it is allowed; an admin previewing
 * another role passes on their base role, but only the base role verified against the DB row
 * (verifiedAdminBaseRole), never the JWT's baseRole claim, so a demoted user loses access at once.
 */
export function locationsRoleAllowed(
  allowed: ReadonlySet<string>,
  role: string | null | undefined,
  verifiedBaseRole: string | null | undefined
): boolean {
  if (role && allowed.has(normalizeStaffRole(role))) return true;
  return Boolean(verifiedBaseRole && allowed.has(normalizeStaffRole(verifiedBaseRole)));
}
