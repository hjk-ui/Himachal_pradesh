import type { ClinicRole } from '@/types/roles';
import { CLINIC_ADMIN_ROLE_OPTIONS, type ClinicAdminRole } from '@/lib/platform/clinic-roles';

/** Clinic staff roles only (not SUPER_ADMIN). */
export type StaffRole = ClinicRole;

export type StaffStatus = 'INVITED' | 'ACTIVE' | 'DEACTIVATED';

export interface StaffUser {
  id: string;
  name: string | null;
  email: string;
  role: StaffRole;
  roles: StaffRole[];
  status?: StaffStatus;
  image?: string | null;
  organizationId?: string | null;
  inviteExpiresAt?: string | null;
  primaryLocationId?: string | null;
  /** DrFirst (Rcopia) username for prescribers */
  rcopiaUsername?: string | null;
  /** Medical Director designation (prescriber roles only) */
  isMedicalDirector?: boolean;
  medicalDirectorScope?: string | null;
  primaryLocationName?: string | null;
  /** Two-factor sign-in (authenticator app) set up */
  mfaEnabled?: boolean;
  createdAt: string;
}

export interface CreateStaffInput {
  name: string;
  email: string;
  password: string;
  role: StaffRole;
  roles?: StaffRole[];
}

export interface InviteStaffInput {
  name: string;
  email: string;
  /** Primary role (also included in roles) */
  role: StaffRole;
  /** All assigned roles — user can switch among these */
  roles?: StaffRole[];
  locationId?: string | null;
}

export interface UpdateStaffInput {
  name?: string;
  role?: StaffRole;
  roles?: StaffRole[];
  status?: 'ACTIVE' | 'DEACTIVATED';
  locationId?: string | null;
  rcopiaUsername?: string | null;
  isMedicalDirector?: boolean;
  medicalDirectorScope?: string | null;
}

export const STAFF_ROLES: { value: ClinicAdminRole; label: string }[] = [...CLINIC_ADMIN_ROLE_OPTIONS];

export const DEFAULT_STAFF_ROLE: ClinicAdminRole = 'THERAPIST';
