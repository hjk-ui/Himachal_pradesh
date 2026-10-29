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
      /** Epoch ms of sign-in; null for tokens issued before the idle guard shipped */
      loginAt?: number | null;
    } & DefaultSession['user'];
  }

  interface User {
    role: StaffRole;
    roles?: StaffRole[];
    organizationId?: string | null;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id?: string;
    role?: StaffRole;
    baseRole?: StaffRole;
    roles?: StaffRole[];
    organizationId?: string | null;
    loginAt?: number;
    email?: string | null;
    name?: string | null;
  }
}
