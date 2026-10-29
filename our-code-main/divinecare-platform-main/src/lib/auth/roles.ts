import type { ClinicRole, StaffRole } from '@/types/roles';
import { CLINIC_ROLES, isCaseloadRole, isClinicalStaff } from '@/types/roles';

export type { ClinicRole, StaffRole };
export { CLINIC_ROLES, isCaseloadRole, isClinicalStaff };

export function isClinicRole(role: StaffRole | string | null | undefined): role is ClinicRole {
  if (!role) return false;
  return (CLINIC_ROLES as readonly string[]).includes(role) || (CLINIC_ROLES as readonly string[]).includes(role.toUpperCase());
}

export function isPlatformAdmin(role: StaffRole | string | null | undefined): boolean {
  return role === 'SUPER_ADMIN';
}
