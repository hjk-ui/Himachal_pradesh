export type { StaffRole } from '@/types/roles';
import type { StaffRole } from '@/types/roles';

/** App-level auth user (web / NextAuth) */
export interface AuthUser {
  id: string;
  email: string | null;
  name: string | null;
  image?: string | null;
  /** Active role — drives nav tabs and dashboard home */
  role?: StaffRole;
  /** Original role used to authorize the admin role-preview mode. */
  baseRole?: StaffRole;
  rolePreview?: boolean;
  /** All assigned roles (for switcher) */
  roles?: StaffRole[];
  organizationId?: string | null;
  /** Compatibility with older UI that read displayName */
  displayName?: string | null;
}
