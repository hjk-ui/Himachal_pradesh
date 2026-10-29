import type { NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { compare } from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { verifyEmailOtp } from '@/lib/auth/otp';
import { canSwitchToRole, normalizeUserRoles } from '@/lib/auth/userRoles';
import type { StaffRole } from '@/types/roles';
import { CLINIC_ROLES } from '@/types/roles';
import { createHash } from 'crypto';
import { rateLimit } from '@/lib/security/rateLimit';

const STAFF_SESSION_MAX_AGE = 30 * 24 * 60 * 60;
const STAFF_SESSION_UPDATE_AGE = 24 * 60 * 60;

const passwordSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  mode: z.literal('password').optional(),
});

const otpSchema = z.object({
  email: z.string().email(),
  otp: z.string().regex(/^\d{6}$/),
  mode: z.literal('otp'),
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
}) {
  const roles = normalizeUserRoles(user.role, user.roles);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    image: user.image,
    role: user.role,
    roles,
    organizationId: user.organizationId,
  };
}

/**
 * Staff portal auth: email+password OR email+OTP code.
 * Google OAuth intentionally not used for this portal.
 */
export const authConfig = {
  basePath: '/api/auth',
  providers: [
    Credentials({
      id: 'credentials',
      name: 'Staff Login',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
        otp: { label: 'OTP', type: 'text' },
        mode: { label: 'Mode', type: 'text' },
      },
      async authorize(raw, request) {
        const emailKey = typeof raw?.email === 'string'
          ? createHash('sha256').update(raw.email.trim().toLowerCase()).digest('hex').slice(0, 24)
          : 'invalid';
        const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
        const ip = forwarded || request.headers.get('x-real-ip') || 'unknown';
        if (!rateLimit(`staff-login:${ip}:${emailKey}`, 20, 60_000).ok) return null;
        const asOtp = otpSchema.safeParse(raw);
        if (asOtp.success) {
          const verified = await verifyEmailOtp(
            asOtp.data.email,
            asOtp.data.otp,
            'LOGIN'
          );
          if (!verified.ok) return null;

          const user = await prisma.user.findUnique({
            where: { email: verified.email },
            include: { organization: { select: { active: true } } },
          });
          if (!user || user.status === 'DEACTIVATED' || user.status === 'INVITED') {
            return null;
          }
          if (user.role !== 'SUPER_ADMIN' && user.organization && !user.organization.active) {
            return null;
          }

          return sessionUserFromDb({
            id: user.id,
            email: user.email,
            name: user.name,
            image: user.image,
            role: user.role as StaffRole,
            roles: user.roles as StaffRole[],
            organizationId: user.organizationId,
          });
        }

        const asPassword = passwordSchema.safeParse({
          ...raw,
          mode: raw?.mode || 'password',
        });
        if (!asPassword.success) return null;

        const email = asPassword.data.email.toLowerCase();
        const user = await prisma.user.findUnique({
          where: { email },
          include: { organization: { select: { active: true } } },
        });
        if (!user?.passwordHash || user.status !== 'ACTIVE') return null;
        if (user.role !== 'SUPER_ADMIN' && user.organization && !user.organization.active) {
          return null;
        }

        const valid = await compare(asPassword.data.password, user.passwordHash);
        if (!valid) return null;

        return sessionUserFromDb({
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          role: user.role as StaffRole,
          roles: user.roles as StaffRole[],
          organizationId: user.organizationId,
        });
      },
    }),
  ],
  session: {
    strategy: 'jwt',
    /** 8 hours — staff portal */
    maxAge: STAFF_SESSION_MAX_AGE,
    updateAge: STAFF_SESSION_UPDATE_AGE,
  },
  cookies: {
    sessionToken: {
      name: process.env.NODE_ENV === 'production'
        ? '__Secure-authjs.session-token'
        : 'authjs.session-token',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
      },
    },
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.baseRole = user.role;
        token.roles = normalizeUserRoles(user.role, user.roles);
        token.organizationId = user.organizationId ?? null;
        token.email = user.email;
        token.name = user.name;
        token.picture = user.image;
        /** Absolute-session clock (12h) — set once at sign-in, never on refresh/update */
        token.loginAt = Date.now();
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
        if (token.email) session.user.email = token.email as string;
        if (token.name !== undefined) session.user.name = token.name as string | null | undefined;
        session.user.image = (token.picture as string | null | undefined) ?? null;
        session.user.loginAt = (token.loginAt as number | undefined) ?? null;
      }
      return session;
    },
  },
  trustHost: true,
} satisfies NextAuthConfig;
