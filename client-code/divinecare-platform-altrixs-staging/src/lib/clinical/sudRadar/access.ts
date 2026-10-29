import { canAccessPath, type AccessCapabilities } from '@/lib/auth/roleAccess';

/**
 * SUD signals carry substance-use conditions and quoted chart evidence (42 CFR Part 2), so only
 * clinical roles that can open the scanner or the EHR may read, run or act on them.
 */
export function canUseSudRadar(role: string | undefined | null, caps?: AccessCapabilities | null): boolean {
  return canAccessPath(role, '/dashboard/ehr/scanner', caps) || canAccessPath(role, '/dashboard/ehr', caps);
}

export const SUD_RADAR_PATH = '/dashboard/ehr/scanner';
