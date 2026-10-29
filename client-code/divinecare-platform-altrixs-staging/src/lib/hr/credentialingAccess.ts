import { canAccessPath } from '@/lib/auth/roleAccess';

/**
 * Credentialing APIs (intake grid, document toggles): the roles that can open
 * /dashboard/hr/credentialing. /dashboard/hr (HR personnel) is a subset of these roles.
 */
export function canManageCredentialing(role: string | undefined | null): boolean {
  return canAccessPath(role, '/dashboard/hr/credentialing') || canAccessPath(role, '/dashboard/hr');
}
