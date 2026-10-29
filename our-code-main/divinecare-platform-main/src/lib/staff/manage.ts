import type { Role, UserStatus } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { assignUserToLocation } from '@/lib/org/locations';
import { assertSameOrg } from '@/lib/auth/tenant';
import { normalizeUserRoles, pickPrimaryRole } from '@/lib/auth/userRoles';
import type { StaffRole } from '@/types/roles';

const staffSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  roles: true,
  status: true,
  image: true,
  organizationId: true,
  inviteExpiresAt: true,
  primaryLocationId: true,
  createdAt: true,
  mfaEnabled: true,
  primaryLocation: { select: { id: true, name: true } },
} as const;

export function serializeStaffUser(u: {
  id: string;
  name: string | null;
  email: string;
  role: Role;
  roles?: Role[];
  status: UserStatus;
  image: string | null;
  organizationId?: string | null;
  inviteExpiresAt: Date | null;
  primaryLocationId: string | null;
  createdAt: Date;
  mfaEnabled?: boolean;
  primaryLocation: { id: string; name: string } | null;
}) {
  const roles = normalizeUserRoles(u.role, u.roles ?? []);
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    roles,
    status: u.status,
    image: u.image,
    organizationId: u.organizationId ?? null,
    inviteExpiresAt: u.inviteExpiresAt?.toISOString() ?? null,
    primaryLocationId: u.primaryLocationId,
    primaryLocationName: u.primaryLocation?.name ?? null,
    createdAt: u.createdAt.toISOString(),
    mfaEnabled: Boolean(u.mfaEnabled),
  };
}

export async function listStaffUsers(organizationId: string) {
  const users = await prisma.user.findMany({
    where: {
      organizationId,
      role: { not: 'SUPER_ADMIN' },
    },
    orderBy: { createdAt: 'desc' },
    select: staffSelect,
  });
  return users.map(serializeStaffUser);
}

export type UpdateStaffInput = {
  role?: Role;
  roles?: Role[];
  status?: 'ACTIVE' | 'DEACTIVATED';
  locationId?: string | null;
  /** Admin correction of invite / staff email — unique per org */
  email?: string;
};

export async function updateStaffUser(
  targetUserId: string,
  actorUserId: string,
  organizationId: string,
  input: UpdateStaffInput
) {
  const target = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!target) {
    return { ok: false as const, error: 'User not found', status: 404 };
  }

  const orgCheck = assertSameOrg(target.organizationId, organizationId);
  if (orgCheck.ok === false) {
    return { ok: false as const, error: 'User not found', status: 404 };
  }

  if (target.role === 'SUPER_ADMIN') {
    return { ok: false as const, error: 'Cannot manage platform admins here', status: 403 };
  }

  if (input.role === 'SUPER_ADMIN' || input.roles?.includes('SUPER_ADMIN')) {
    return { ok: false as const, error: 'Cannot assign platform admin role', status: 400 };
  }

  // Status changes
  if (input.status !== undefined && input.status !== target.status) {
    if (input.status === 'DEACTIVATED') {
      if (targetUserId === actorUserId) {
        return { ok: false as const, error: 'You cannot deactivate your own account', status: 400 };
      }
      if (target.role === 'ADMIN' && target.status === 'ACTIVE') {
        const otherAdmins = await prisma.user.count({
          where: {
            organizationId,
            role: 'ADMIN',
            status: 'ACTIVE',
            id: { not: targetUserId },
          },
        });
        if (otherAdmins === 0) {
          return {
            ok: false as const,
            error: 'Cannot deactivate the last active admin',
            status: 400,
          };
        }
      }
      await prisma.user.update({
        where: { id: targetUserId },
        data: { status: 'DEACTIVATED' },
      });
    }

    if (input.status === 'ACTIVE') {
      if (target.status === 'INVITED' || !target.passwordHash) {
        return {
          ok: false as const,
          error: 'This user has not set a password yet. Resend invite instead.',
          status: 400,
        };
      }
      if (target.status !== 'DEACTIVATED') {
        return {
          ok: false as const,
          error: 'Only deactivated users can be reactivated this way',
          status: 400,
        };
      }
      await prisma.user.update({
        where: { id: targetUserId },
        data: { status: 'ACTIVE' },
      });
    }
  }

  // Role change (primary and/or multi-role set)
  if (input.roles !== undefined || input.role !== undefined) {
    const nextRoles = normalizeUserRoles(
      input.role ?? target.role,
      input.roles ?? target.roles
    ) as Role[];
    const nextPrimary = pickPrimaryRole(
      nextRoles as StaffRole[],
      (input.role ?? target.role) as StaffRole
    ) as Role;

    if (target.role === 'ADMIN' && nextPrimary !== 'ADMIN' && target.status === 'ACTIVE') {
      const otherAdmins = await prisma.user.count({
        where: {
          organizationId,
          role: 'ADMIN',
          status: 'ACTIVE',
          id: { not: targetUserId },
        },
      });
      if (otherAdmins === 0) {
        return {
          ok: false as const,
          error: 'Cannot change role of the last active admin',
          status: 400,
        };
      }
    }
    await prisma.user.update({
      where: { id: targetUserId },
      data: { role: nextPrimary, roles: nextRoles },
    });
  }

  // Email correction (invite typo / staff rename of login)
  if (input.email !== undefined) {
    const nextEmail = input.email.trim().toLowerCase();
    if (!nextEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
      return { ok: false as const, error: 'Valid email is required', status: 400 };
    }
    if (nextEmail !== target.email.toLowerCase()) {
      const clash = await prisma.user.findFirst({
        where: {
          email: { equals: nextEmail, mode: 'insensitive' },
          id: { not: targetUserId },
        },
        select: { id: true },
      });
      if (clash) {
        return { ok: false as const, error: 'That email is already in use', status: 409 };
      }
      await prisma.user.update({
        where: { id: targetUserId },
        data: { email: nextEmail },
      });
    }
  }

  // Location reassignment
  if (input.locationId !== undefined) {
    if (input.locationId === null || input.locationId === '') {
      await prisma.$transaction([
        prisma.userLocation.deleteMany({ where: { userId: targetUserId } }),
        prisma.user.update({
          where: { id: targetUserId },
          data: { primaryLocationId: null },
        }),
      ]);
    } else {
      const assigned = await assignUserToLocation(
        targetUserId,
        input.locationId,
        true,
        organizationId
      );
      if (!assigned.ok) {
        return {
          ok: false as const,
          error: assigned.error,
          status: assigned.status,
        };
      }
    }
  }

  const updated = await prisma.user.findUniqueOrThrow({
    where: { id: targetUserId },
    select: staffSelect,
  });

  return { ok: true as const, user: serializeStaffUser(updated) };
}

/**
 * Dedicated sign-in email change (Oct 22) — ADMIN / PRACTICE_DIRECTOR only at route layer.
 * INVITED → caller should resend invite after success.
 */
export async function changeStaffSignInEmail(
  targetUserId: string,
  actorUserId: string,
  organizationId: string,
  rawEmail: string
) {
  if (targetUserId === actorUserId) {
    return {
      ok: false as const,
      error: 'Ask another admin to change your own email',
      status: 400,
    };
  }

  const target = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!target) {
    return { ok: false as const, error: 'User not found', status: 404 };
  }
  const orgCheck = assertSameOrg(target.organizationId, organizationId);
  if (orgCheck.ok === false) {
    return { ok: false as const, error: 'User not found', status: 404 };
  }
  if (target.role === 'SUPER_ADMIN') {
    return { ok: false as const, error: 'Cannot manage platform admins here', status: 403 };
  }
  if (target.status === 'DEACTIVATED') {
    return {
      ok: false as const,
      error: 'Activate the account before changing email',
      status: 400,
    };
  }

  const nextEmail = rawEmail.trim().toLowerCase();
  if (!nextEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
    return { ok: false as const, error: 'Enter a valid email address', status: 400 };
  }
  if (nextEmail === target.email.toLowerCase()) {
    return { ok: false as const, error: 'That is already their email', status: 400 };
  }

  const clash = await prisma.user.findFirst({
    where: {
      email: { equals: nextEmail, mode: 'insensitive' },
      id: { not: targetUserId },
    },
    select: { id: true },
  });
  if (clash) {
    return { ok: false as const, error: 'Another account already uses that email', status: 409 };
  }

  await prisma.user.update({
    where: { id: targetUserId },
    data: { email: nextEmail },
  });

  console.info('[STAFF_EMAIL_CHANGE]', {
    organizationId,
    actorUserId,
    targetUserId,
    from: target.email,
    to: nextEmail,
    status: target.status,
  });

  const updated = await prisma.user.findUniqueOrThrow({
    where: { id: targetUserId },
    select: staffSelect,
  });

  return {
    ok: true as const,
    user: serializeStaffUser(updated),
    previousEmail: target.email,
    resendInvite: target.status === 'INVITED' || !target.passwordHash,
  };
}
