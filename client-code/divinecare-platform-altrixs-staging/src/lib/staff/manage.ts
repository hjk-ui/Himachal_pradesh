import type { Role, UserStatus } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { assignUserToLocation } from '@/lib/org/locations';
import { assertSameOrg } from '@/lib/auth/tenant';
import { normalizeUserRoles, pickPrimaryRole } from '@/lib/auth/userRoles';
import type { StaffRole } from '@/types/roles';
import { invalidateSessionUser } from '@/lib/auth/requireSession';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { canHoldMedicalDirector, normalizeMedicalDirectorScope } from '@/lib/auth/medicalDirector';
import { resendStaffInvite, sendEmailChangeNotice } from './invite';

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
  rcopiaUsername: true,
  isMedicalDirector: true,
  medicalDirectorScope: true,
  mfaEnabledAt: true,
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
  rcopiaUsername?: string | null;
  isMedicalDirector?: boolean | null;
  medicalDirectorScope?: string | null;
  mfaEnabledAt?: Date | null;
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
    rcopiaUsername: u.rcopiaUsername ?? null,
    isMedicalDirector: Boolean(u.isMedicalDirector),
    medicalDirectorScope: u.isMedicalDirector ? u.medicalDirectorScope ?? null : null,
    primaryLocationName: u.primaryLocation?.name ?? null,
    /** Two-factor sign-in set up (authenticator app); never the secret */
    mfaEnabled: Boolean(u.mfaEnabledAt),
    createdAt: u.createdAt.toISOString(),
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
  /** Display name (corrections, legal name changes). Signed notes keep the name they were signed with. */
  name?: string;
  role?: Role;
  roles?: Role[];
  status?: 'ACTIVE' | 'DEACTIVATED';
  locationId?: string | null;
  /** The prescriber's own DrFirst (Rcopia) username; /api/drfirst/sso signs as this user */
  rcopiaUsername?: string | null;
  /** Medical Director designation (prescriber roles only); org-wide scope, see lib/auth/medicalDirector */
  isMedicalDirector?: boolean;
  /** Optional scope note shown with the designation, e.g. "Primary care" */
  medicalDirectorScope?: string | null;
};

type StaffAccessSnapshot = {
  role: Role;
  roles: Role[];
  status: UserStatus;
  primaryLocationId: string | null;
  isMedicalDirector: boolean;
  medicalDirectorScope: string | null;
};

async function staffAccessSnapshot(userId: string): Promise<StaffAccessSnapshot | null> {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, roles: true, status: true, primaryLocationId: true, isMedicalDirector: true, medicalDirectorScope: true },
  });
}

function sameRoleSet(a: readonly string[], b: readonly string[]) {
  const sa = new Set(a);
  const sb = new Set(b);
  return sa.size === sb.size && [...sa].every((r) => sb.has(r));
}

/**
 * Admin edit of a staff user. Guards self-escalation (no changing your own role or status),
 * drops the cached session row after an access change so it takes effect on the next request,
 * and writes a STAFF_ACCESS_CHANGE audit entry with before/after role and status.
 */
export async function updateStaffUser(
  targetUserId: string,
  actorUserId: string,
  organizationId: string,
  input: UpdateStaffInput,
  actorMeta?: { actorRole?: string | null; ipAddress?: string | null; userAgent?: string | null }
) {
  const before = await staffAccessSnapshot(targetUserId);
  if (before && targetUserId === actorUserId) {
    const nextRoles = normalizeUserRoles(input.role ?? before.role, input.roles ?? before.roles);
    const roleChange =
      (input.role !== undefined && input.role !== before.role) ||
      (input.roles !== undefined &&
        !sameRoleSet(nextRoles, normalizeUserRoles(before.role, before.roles)));
    const statusChange = input.status !== undefined && input.status !== before.status;
    if (roleChange || statusChange) {
      return { ok: false as const, error: 'You cannot change your own role', status: 400 };
    }
    // Same rule for the Medical Director designation: never self-granted (or self-edited)
    const directorChange =
      (input.isMedicalDirector !== undefined && input.isMedicalDirector !== before.isMedicalDirector) ||
      (input.medicalDirectorScope !== undefined &&
        normalizeMedicalDirectorScope(input.medicalDirectorScope) !== (before.medicalDirectorScope ?? null));
    if (directorChange) {
      return { ok: false as const, error: 'You cannot change your own Medical Director designation', status: 400 };
    }
  }

  const accessFieldsTouched =
    input.role !== undefined ||
    input.roles !== undefined ||
    input.status !== undefined ||
    input.locationId !== undefined ||
    input.isMedicalDirector !== undefined ||
    input.medicalDirectorScope !== undefined;

  const result = await applyStaffUpdate(targetUserId, actorUserId, organizationId, input);

  // Even a partial failure (e.g. bad location after a status change) may have written rows.
  if (before && accessFieldsTouched) {
    invalidateSessionUser(targetUserId);
    const after = await staffAccessSnapshot(targetUserId);
    if (
      after &&
      (after.role !== before.role ||
        !sameRoleSet(after.roles, before.roles) ||
        after.status !== before.status ||
        after.primaryLocationId !== before.primaryLocationId ||
        after.isMedicalDirector !== before.isMedicalDirector ||
        (after.medicalDirectorScope ?? null) !== (before.medicalDirectorScope ?? null))
    ) {
      await writeAuditLog({
        action: 'STAFF_ACCESS_CHANGE',
        actorUserId,
        actorRole: actorMeta?.actorRole ?? null,
        organizationId,
        resourceType: 'user',
        resourceId: targetUserId,
        outcome: result.ok ? 'SUCCESS' : 'FAILURE',
        ipAddress: actorMeta?.ipAddress ?? null,
        userAgent: actorMeta?.userAgent ?? null,
        metadata: {
          beforeRole: before.role,
          afterRole: after.role,
          beforeRoles: before.roles,
          afterRoles: after.roles,
          beforeStatus: before.status,
          afterStatus: after.status,
          locationChanged: after.primaryLocationId !== before.primaryLocationId,
          beforeMedicalDirector: before.isMedicalDirector,
          afterMedicalDirector: after.isMedicalDirector,
          beforeMedicalDirectorScope: before.medicalDirectorScope ?? null,
          afterMedicalDirectorScope: after.medicalDirectorScope ?? null,
        },
      });
    }
  }
  return result;
}

async function applyStaffUpdate(
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
    // A role change that leaves no prescriber role also ends the Medical Director designation
    const keepsDirector = canHoldMedicalDirector(nextPrimary, nextRoles);
    await prisma.user.update({
      where: { id: targetUserId },
      data: {
        role: nextPrimary,
        roles: nextRoles,
        ...(!keepsDirector && target.isMedicalDirector && input.isMedicalDirector !== true
          ? { isMedicalDirector: false, medicalDirectorScope: null }
          : {}),
      },
    });
  }

  // Medical Director designation: prescriber roles only (Psychiatrist, NP, Physician, Medical NP)
  if (input.isMedicalDirector !== undefined || input.medicalDirectorScope !== undefined) {
    const current = await prisma.user.findUniqueOrThrow({
      where: { id: targetUserId },
      select: { role: true, roles: true, isMedicalDirector: true },
    });
    const nextFlag = input.isMedicalDirector ?? current.isMedicalDirector;
    if (nextFlag && !canHoldMedicalDirector(current.role, current.roles)) {
      return {
        ok: false as const,
        error: 'Medical Director can only be given to a Psychiatrist, NP, Primary Care Physician or Medical NP',
        status: 400,
      };
    }
    await prisma.user.update({
      where: { id: targetUserId },
      data: {
        isMedicalDirector: nextFlag,
        medicalDirectorScope: nextFlag
          ? input.medicalDirectorScope !== undefined
            ? normalizeMedicalDirectorScope(input.medicalDirectorScope)
            : undefined
          : null,
      },
    });
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

  if (input.rcopiaUsername !== undefined) {
    const rcopiaUsername = input.rcopiaUsername?.trim() || null;
    if (rcopiaUsername) {
      const taken = await prisma.user.findFirst({
        where: { rcopiaUsername, id: { not: targetUserId } },
        select: { id: true },
      });
      if (taken) {
        return { ok: false as const, error: 'That DrFirst username is already assigned to another user', status: 409 };
      }
    }
    await prisma.user.update({ where: { id: targetUserId }, data: { rcopiaUsername } });
  }

  if (input.name !== undefined) {
    const name = input.name.replace(/\s+/g, ' ').trim();
    if (name.length < 2) return { ok: false as const, error: 'Name must be at least 2 characters', status: 400 };
    if (name !== (target.name ?? '')) {
      await prisma.user.update({ where: { id: targetUserId }, data: { name } });
      invalidateSessionUser(targetUserId);
      await writeAuditLog({
        action: 'STAFF_NAME_CHANGE',
        actorUserId,
        actorRole: null,
        organizationId,
        resourceType: 'user',
        resourceId: targetUserId,
        outcome: 'SUCCESS',
        metadata: { beforeName: target.name ?? null, afterName: name },
      });
    }
  }

  const updated = await prisma.user.findUniqueOrThrow({
    where: { id: targetUserId },
    select: staffSelect,
  });

  return { ok: true as const, user: serializeStaffUser(updated) };
}

/**
 * Admin change of a staff member's login email (never your own; never a platform admin or a
 * deactivated account). Invited accounts get a fresh invite at the new address; active accounts
 * keep their password and sign in with the new email, and both addresses are told about the change.
 * Audited as STAFF_EMAIL_CHANGE.
 */
export async function changeStaffEmail(
  targetUserId: string,
  actorUserId: string,
  organizationId: string,
  newEmailRaw: string,
  actorMeta?: { actorRole?: string | null; ipAddress?: string | null; userAgent?: string | null }
) {
  const email = newEmailRaw.trim().toLowerCase();
  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, email: true, name: true, role: true, status: true, passwordHash: true, organizationId: true },
  });
  if (!target || assertSameOrg(target.organizationId, organizationId).ok === false) {
    return { ok: false as const, error: 'User not found', status: 404 };
  }
  if (target.role === 'SUPER_ADMIN') {
    return { ok: false as const, error: 'Cannot manage platform admins here', status: 403 };
  }
  if (targetUserId === actorUserId) {
    return { ok: false as const, error: 'Ask another admin to change your own sign-in email', status: 400 };
  }
  if (target.status === 'DEACTIVATED') {
    return { ok: false as const, error: 'This account is deactivated. Activate it before changing the email.', status: 400 };
  }
  if (email === target.email.toLowerCase()) {
    return { ok: false as const, error: 'That is already their email', status: 400 };
  }
  const taken = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (taken && taken.id !== targetUserId) {
    return { ok: false as const, error: 'Another account already uses this email', status: 409 };
  }

  const oldEmail = target.email;
  await prisma.user.update({ where: { id: targetUserId }, data: { email } });
  invalidateSessionUser(targetUserId);

  const invited = target.status === 'INVITED' || !target.passwordHash;
  let inviteResent = false;
  if (invited) {
    const resent = await resendStaffInvite(targetUserId, actorUserId, organizationId);
    inviteResent = resent.ok;
  } else {
    await sendEmailChangeNotice({ name: target.name || 'there', oldEmail, newEmail: email });
  }

  await writeAuditLog({
    action: 'STAFF_EMAIL_CHANGE',
    actorUserId,
    actorRole: actorMeta?.actorRole ?? null,
    organizationId,
    resourceType: 'user',
    resourceId: targetUserId,
    outcome: 'SUCCESS',
    ipAddress: actorMeta?.ipAddress ?? null,
    userAgent: actorMeta?.userAgent ?? null,
    metadata: { oldEmail, newEmail: email, status: target.status, inviteResent },
  });

  const user = await prisma.user.findUniqueOrThrow({ where: { id: targetUserId }, select: staffSelect });
  return { ok: true as const, user: serializeStaffUser(user), invited, inviteResent };
}
