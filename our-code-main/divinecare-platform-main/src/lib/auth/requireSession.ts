import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import type { Role } from '@prisma/client';
import { normalizeUserRoles } from '@/lib/auth/userRoles';
import type { StaffRole } from '@/types/roles';
import { CLINIC_ROLES } from '@/types/roles';

/** Any authenticated ACTIVE staff user (rejects deactivated mid-session JWTs). */
export async function requireSession() {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false as const, status: 401, error: 'Unauthorized' };
  }

  let dbUser: {
    status: string;
    role: Role;
    roles: Role[];
    organizationId: string | null;
    organization: { active: boolean } | null;
  } | null;
  try {
    dbUser = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        status: true,
        role: true,
        roles: true,
        organizationId: true,
        organization: { select: { active: true } },
      },
    });
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

  return {
    ok: true as const,
    session,
    userStatus: dbUser.status,
    /** Active role from JWT (drives RBAC for this request) */
    role: activeRole as Role,
    roles: roles as Role[],
    organizationId: dbUser.organizationId,
  };
}
