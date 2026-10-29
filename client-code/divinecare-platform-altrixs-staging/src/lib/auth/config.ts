import type { NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { completeSignIn } from '@/lib/auth/staffSignIn';
import { canSwitchToRole, normalizeUserRoles } from '@/lib/auth/userRoles';
import type { StaffRole } from '@/types/roles';
import { CLINIC_ROLES } from '@/types/roles';
import { canHoldMedicalDirector, isMedicalDirectorEligibleRole } from '@/lib/auth/medicalDirector';
import { SESSION_MAX_AGE_SECONDS, sessionExpiry, type SessionTimes } from '@/lib/auth/sessionPolicy';

/** Re-sign the cookie at most every 5 minutes (the 12 h absolute limit is token.authTime, not the cookie expiry). */
const STAFF_SESSION_UPDATE_AGE = 5 * 60;

/**
 * The only credential NextAuth accepts: a single-use ticket from the step-by-step sign-in
 * (/api/auth/staff/*, src/lib/auth/staffSignIn.ts) after password / email code AND two-factor.
 */
const ticketSchema = z.object({
  ticket: z.string().min(20).max(2000),
  mode: z.literal('ticket'),
});

const SWITCHABLE_ROLES = new Set<string>(['SUPER_ADMIN', ...CLINIC_ROLES]);

function sessionUserFromDb(user: {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  role: StaffRole;
  roles: StaffRole[];
  organizationId: string | null;
  isMedicalDirector?: boolean | null;
  medicalDirectorScope?: string | null;
}) {
  const roles = normalizeUserRoles(user.role, user.roles);
  const medicalDirector = Boolean(user.isMedicalDirector) && canHoldMedicalDirector(user.role, roles);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    image: user.image,
    role: user.role,
    roles,
    organizationId: user.organizationId,
    medicalDirector,
    medicalDirectorScope: medicalDirector ? user.medicalDirectorScope ?? null : null,
  };
}

/**
 * Re-read the Medical Director flag for the JWT (session update with refreshCapabilities). The
 * dashboard shell asks for this when the server-verified flag differs from the token, so a grant
 * reaches the proxy gate without a new sign-in; a revocation is enforced server-side regardless.
 */
async function medicalDirectorClaimFromDb(userId: string): Promise<{ medicalDirector: boolean; scope: string | null }> {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { status: true, role: true, roles: true, isMedicalDirector: true, medicalDirectorScope: true },
  });
  const on = Boolean(row && row.status === 'ACTIVE' && row.isMedicalDirector && canHoldMedicalDirector(row.role, row.roles));
  return { medicalDirector: on, scope: on ? row?.medicalDirectorScope ?? null : null };
}

/**
 * Staff portal auth: email + password (or email one-time code), then two-factor (TOTP app or a
 * recovery code; a remembered device skips it for 30 days). Login audit is written in staffSignIn.
 * Google OAuth intentionally not used for this portal.
 */
export const authConfig = {
  basePath: '/api/auth',
  providers: [
    Credentials({
      id: 'credentials',
      name: 'Staff Login',
      credentials: {
        ticket: { label: 'Ticket', type: 'text' },
        mode: { label: 'Mode', type: 'text' },
      },
      async authorize(raw, request) {
        const parsed = ticketSchema.safeParse(raw);
        if (!parsed.success) return null;
        const done = await completeSignIn(parsed.data.ticket, request);
        if (!done) return null;
        const { user } = done;
        return sessionUserFromDb({
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          role: user.role as StaffRole,
          roles: user.roles as StaffRole[],
          organizationId: user.organizationId,
          isMedicalDirector: user.isMedicalDirector,
          medicalDirectorScope: user.medicalDirectorScope,
        });
      },
    }),
  ],
  session: {
    strategy: 'jwt',
    /** 12 hours absolute (token.authTime) and 15 minutes idle (token.lastActivity) — src/lib/auth/sessionPolicy.ts */
    maxAge: SESSION_MAX_AGE_SECONDS,
    updateAge: STAFF_SESSION_UPDATE_AGE,
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      const now = Date.now();
      if (user) {
        token.authTime = now;
        token.lastActivity = now;
        token.id = user.id;
        token.role = user.role;
        token.baseRole = user.role;
        token.roles = normalizeUserRoles(user.role, user.roles);
        token.organizationId = user.organizationId ?? null;
        token.email = user.email;
        token.name = user.name;
        token.picture = user.image;
        token.medicalDirector = Boolean(user.medicalDirector);
        token.medicalDirectorScope = user.medicalDirectorScope ?? null;
        token.medicalDirectorPreview = false;
      }
      // 15-minute idle / 12-hour absolute limit: returning null clears the session cookie
      if (sessionExpiry(token as SessionTimes, now)) return null;
      // Client heartbeat (StaffIdleGuard): keyboard / pointer activity or a live call / recording
      if (trigger === 'update' && (session as { activity?: boolean } | undefined)?.activity === true) {
        token.lastActivity = now;
      }
      // refresh profile after Settings update / role switch
      if (trigger === 'update' && session) {
        const next = session as {
          name?: string;
          email?: string;
          image?: string | null;
          organizationId?: string | null;
          role?: StaffRole;
          activeRole?: StaffRole;
          roles?: StaffRole[];
          /** Re-read User.isMedicalDirector into the token */
          refreshCapabilities?: boolean;
          /** Admin preview of "Medical Director (<activeRole>)"; honoured for an ADMIN base role only */
          medicalDirectorPreview?: boolean;
          user?: {
            name?: string;
            email?: string;
            image?: string | null;
            organizationId?: string | null;
            role?: StaffRole;
            activeRole?: StaffRole;
            roles?: StaffRole[];
          };
        };
        const name = next.name ?? next.user?.name;
        const email = next.email ?? next.user?.email;
        const image = next.image ?? next.user?.image;
        const organizationId = next.organizationId ?? next.user?.organizationId;
        const rolesUpdate = next.roles ?? next.user?.roles;
        const activeRole =
          next.activeRole ?? next.role ?? next.user?.activeRole ?? next.user?.role;

        if (typeof name === 'string') token.name = name;
        if (typeof email === 'string') token.email = email;
        if (image !== undefined) token.picture = image;
        if (organizationId !== undefined) token.organizationId = organizationId;
        if (rolesUpdate) {
          token.roles = normalizeUserRoles(token.role as StaffRole, rolesUpdate);
        }
        if (activeRole && SWITCHABLE_ROLES.has(activeRole)) {
          const baseRole = (token.baseRole as StaffRole | undefined) ?? (token.role as StaffRole);
          token.baseRole = baseRole;
          const allowed = normalizeUserRoles(
            baseRole,
            (token.roles as StaffRole[]) ?? []
          );
          const previewAllowed = baseRole === 'ADMIN' ? [...CLINIC_ROLES] : allowed;
          if (canSwitchToRole(previewAllowed, activeRole as StaffRole)) {
            token.role = activeRole as StaffRole;
            token.roles = normalizeUserRoles(baseRole, previewAllowed);
            // Every role switch resets the preview; only an admin previewing a prescriber role may set it.
            token.medicalDirectorPreview =
              next.medicalDirectorPreview === true &&
              baseRole === 'ADMIN' &&
              isMedicalDirectorEligibleRole(activeRole);
          }
        }
        if (next.refreshCapabilities === true && token.id) {
          try {
            const claim = await medicalDirectorClaimFromDb(token.id as string);
            token.medicalDirector = claim.medicalDirector;
            token.medicalDirectorScope = claim.scope;
          } catch {
            // Keep the current claim; server-side checks re-read the database regardless.
          }
        }
      }
      const existingRoles = (token.roles as StaffRole[] | undefined) ?? [];
      if (!existingRoles.length && token.role) {
        token.roles = [token.role as StaffRole];
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = (token.id as string) ?? '';
        session.user.role = (token.role as StaffRole) ?? 'CLINICIAN';
        session.user.baseRole = (token.baseRole as StaffRole) ?? session.user.role;
        session.user.rolePreview = session.user.role !== session.user.baseRole;
        session.user.roles = normalizeUserRoles(
          token.role as StaffRole,
          (token.roles as StaffRole[]) ?? []
        );
        session.user.organizationId = (token.organizationId as string | null) ?? null;
        session.user.medicalDirectorPreview = Boolean(token.medicalDirectorPreview);
        session.user.medicalDirector = Boolean(token.medicalDirector) || session.user.medicalDirectorPreview;
        session.user.medicalDirectorScope = (token.medicalDirectorScope as string | null | undefined) ?? null;
        if (token.email) session.user.email = token.email as string;
        if (token.name !== undefined) session.user.name = token.name as string | null | undefined;
        session.user.image = (token.picture as string | null | undefined) ?? null;
      }
      if (typeof token.authTime === 'number') session.authTime = token.authTime;
      return session;
    },
  },
  trustHost: true,
} satisfies NextAuthConfig;
