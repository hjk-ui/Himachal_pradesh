import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import type { Role } from '@prisma/client';
import { normalizeUserRoles } from '@/lib/auth/userRoles';
import type { StaffRole } from '@/types/roles';
import { CLINIC_ROLES } from '@/types/roles';
import { TtlCache } from '@/lib/perf/cache';
import {
  canHoldMedicalDirector,
  forgetVerifiedCapabilities,
  isMedicalDirectorEligibleRole,
  recordVerifiedCapabilities,
  type AccessCapabilities,
} from '@/lib/auth/medicalDirector';

type SessionUserRow = {
  status: string;
  role: Role;
  roles: Role[];
  organizationId: string | null;
  organization: { active: boolean } | null;
  isMedicalDirector: boolean;
} | null;

/**
 * The status / role row behind every layout and API gate, cached 10s per user id (concurrent
 * requests of one page load share one read). A deactivated user or suspended clinic is refused
 * within 10s; invalidateSessionUser() makes it immediate.
 */
const SESSION_USER_TTL_MS = 10_000;
const sessionUserCache = new TtlCache<SessionUserRow>(SESSION_USER_TTL_MS, 5000);

/** Drop the cached row after a status / role / organization / Medical Director change for this user */
export function invalidateSessionUser(userId: string): void {
  sessionUserCache.delete(userId);
  forgetVerifiedCapabilities(userId);
}

/** Cached DB status / role row for a user (shared by requireSession and verifiedAdminBaseRole). */
function loadSessionUserRow(userId: string): Promise<SessionUserRow> {
  return sessionUserCache.getOrCompute(userId, () =>
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        status: true,
        role: true,
        roles: true,
        organizationId: true,
        organization: { select: { active: true } },
        isMedicalDirector: true,
      },
    })
  );
}

/**
 * Medical Director capability for this request, from the DATABASE row (never the JWT alone):
 *  - the real flag: User.isMedicalDirector on an account holding a prescriber role, while the
 *    active role is a prescriber role (a multi-role user switched to Therapist does not get it);
 *  - admin role preview: the JWT preview claim is honoured only when the DB row's primary role is
 *    ADMIN (the same rule that lets an admin preview any clinic role), so it never reaches a non-admin.
 */
export function verifiedMedicalDirectorFor(
  row: { status: string; role: Role; roles: Role[]; isMedicalDirector?: boolean | null },
  activeRole: string,
  previewClaim: boolean
): boolean {
  if (row.status !== 'ACTIVE' || !isMedicalDirectorEligibleRole(activeRole)) return false;
  if (row.isMedicalDirector && canHoldMedicalDirector(row.role, row.roles)) {
    return normalizeUserRoles(row.role, row.roles).some((r) => String(r).toUpperCase() === activeRole.toUpperCase());
  }
  return previewClaim && row.role === 'ADMIN';
}

const ADMIN_BASE_ROLES = ['ADMIN', 'PRACTICE_DIRECTOR'] as const;
export type AdminBaseRole = (typeof ADMIN_BASE_ROLES)[number];

/**
 * The user's REAL admin role from the database (cached row), or null. Use this instead of the
 * JWT's session.user.baseRole: the JWT is minted at login and can be stale after a demotion,
 * so it must never grant admin preview / org-wide access on its own.
 * Primary role wins; otherwise an ADMIN / PRACTICE_DIRECTOR entry in roles[]. Inactive users get null.
 */
export async function verifiedAdminBaseRole(userId: string): Promise<AdminBaseRole | null> {
  if (!userId) return null;
  const row = await loadSessionUserRow(userId);
  if (!row || row.status !== 'ACTIVE') return null;
  if ((ADMIN_BASE_ROLES as readonly string[]).includes(row.role)) return row.role as AdminBaseRole;
  const roles = normalizeUserRoles(row.role, row.roles) as string[];
  if (roles.includes('ADMIN')) return 'ADMIN';
  if (roles.includes('PRACTICE_DIRECTOR')) return 'PRACTICE_DIRECTOR';
  return null;
}

/** Any authenticated ACTIVE staff user (rejects deactivated mid-session JWTs). */
export async function requireSession() {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false as const, status: 401, error: 'Unauthorized' };
  }

  let dbUser: SessionUserRow;
  try {
    const userId = session.user.id;
    dbUser = await loadSessionUserRow(userId);
  } catch (err: unknown) {
    const rec = err && typeof err === 'object' ? (err as Record<string, unknown>) : null;
    const code = rec && 'code' in rec ? String(rec.code ?? '') : '';
    const errorCode = rec && 'errorCode' in rec ? String(rec.errorCode ?? '') : '';
    const name = rec && 'name' in rec ? String(rec.name ?? '') : '';
    const message =
      (err instanceof Error ? err.message : '') ||
      (rec && 'message' in rec ? String(rec.message ?? '') : String(err ?? ''));
    // P1001, or PrismaClientInitializationError (often errorCode undefined) when the SSH tunnel is down.
    if (
      code === 'P1001' ||
      errorCode === 'P1001' ||
      name === 'PrismaClientInitializationError' ||
      message.includes("Can't reach database server")
    ) {
      return {
        ok: false as const,
        status: 503,
        error: 'Database connection is temporarily unavailable. Please try again.',
      };
    }
    throw err;
  }

  if (!dbUser || dbUser.status !== 'ACTIVE') {
    return { ok: false as const, status: 401, error: 'Account is not active' };
  }

  if (
    dbUser.role !== 'SUPER_ADMIN' &&
    dbUser.organization &&
    !dbUser.organization.active
  ) {
    return {
      ok: false as const,
      status: 403,
      error: 'This clinic is suspended',
    };
  }

  const roles = normalizeUserRoles(dbUser.role, dbUser.roles);
  const sessionActive = (session.user.role as StaffRole | undefined) ?? (dbUser.role as StaffRole);
  const activeRole =
    roles.includes(sessionActive) ||
    (dbUser.role === 'ADMIN' &&
      (CLINIC_ROLES as readonly string[]).includes(sessionActive))
      ? sessionActive
      : (dbUser.role as StaffRole);

  const medicalDirector = verifiedMedicalDirectorFor(
    dbUser,
    String(activeRole),
    Boolean(session.user.medicalDirectorPreview)
  );
  // Server-side scope rules (clientAccessWhere, chart access, audit accessBasis) read this.
  recordVerifiedCapabilities(
    session.user.id,
    { organizationId: dbUser.organizationId, medicalDirector },
    SESSION_USER_TTL_MS
  );
  const capabilities: AccessCapabilities = { medicalDirector };

  return {
    ok: true as const,
    session,
    userStatus: dbUser.status,
    /** Active role from JWT (drives RBAC for this request) */
    role: activeRole as Role,
    roles: roles as Role[],
    organizationId: dbUser.organizationId,
    /** Verified from the DB row (Medical Director); pass to canAccessPath for oversight pages */
    capabilities,
  };
}
