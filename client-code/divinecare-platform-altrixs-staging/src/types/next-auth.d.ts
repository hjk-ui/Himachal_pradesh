import type { DefaultSession } from 'next-auth';
import type { StaffRole } from '@/types/roles';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      /** Active role for nav + dashboard (switchable) */
      role: StaffRole;
      /** Original database role; used to authorize admin preview mode. */
      baseRole?: StaffRole;
      rolePreview?: boolean;
      /** All roles assigned to this user */
      roles: StaffRole[];
      organizationId: string | null;
      /**
       * Medical Director claim (User.isMedicalDirector at sign-in / refresh, or an admin preview).
       * Drives the proxy gate and the sidebar only; every server check re-reads the DB row.
       */
      medicalDirector?: boolean;
      /** Admin role preview of "Medical Director (<role>)": this session only, admins only */
      medicalDirectorPreview?: boolean;
      medicalDirectorScope?: string | null;
    } & DefaultSession['user'];
    /** Sign-in time (ms): the session ends 12 h after it (src/lib/auth/sessionPolicy.ts) */
    authTime?: number;
  }

  interface User {
    role: StaffRole;
    roles?: StaffRole[];
    organizationId?: string | null;
    medicalDirector?: boolean;
    medicalDirectorScope?: string | null;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id?: string;
    role?: StaffRole;
    baseRole?: StaffRole;
    roles?: StaffRole[];
    organizationId?: string | null;
    email?: string | null;
    name?: string | null;
    medicalDirector?: boolean;
    medicalDirectorPreview?: boolean;
    medicalDirectorScope?: string | null;
    /** Sign-in time (ms) — 12 h absolute limit */
    authTime?: number;
    /** Last reported activity (ms) — 15 min idle limit */
    lastActivity?: number;
  }
}
