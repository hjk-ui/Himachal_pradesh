import type { Role, UserStatus } from '@prisma/client';
import { hash } from 'bcryptjs';
import { prisma } from '@/lib/db/prisma';
import { CLINIC_ROLES } from '@/lib/auth/roles';
import { assignUserToLocation } from '@/lib/org/locations';
import { createStaffInvite } from '@/lib/staff/invite';

function slugify(name: string) {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base || 'org';
}

async function uniqueSlug(name: string) {
  const base = slugify(name);
  let slug = base;
  let n = 1;
  while (await prisma.organization.findUnique({ where: { slug } })) {
    slug = `${base}-${n++}`;
  }
  return slug;
}

export async function listOrganizations() {
  const orgs = await prisma.organization.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      _count: {
        select: {
          users: true,
          locations: true,
        },
      },
    },
  });

  return orgs.map((o) => ({
    id: o.id,
    name: o.name,
    slug: o.slug,
    active: o.active,
    createdAt: o.createdAt.toISOString(),
    userCount: o._count.users,
    locationCount: o._count.locations,
  }));
}

export async function getOrganizationDetail(id: string) {
  const org = await prisma.organization.findUnique({
    where: { id },
    include: {
      locations: {
        orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          code: true,
          addressLine1: true,
          addressLine2: true,
          city: true,
          state: true,
          postalCode: true,
          phone: true,
          timezone: true,
          active: true,
          isPrimary: true,
          organizationId: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      users: {
        where: { role: { not: 'SUPER_ADMIN' } },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          status: true,
          createdAt: true,
        },
      },
      _count: { select: { users: true } },
    },
  });
  if (!org) return null;

  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    active: org.active,
    createdAt: org.createdAt.toISOString(),
    userCount: org._count.users,
    locations: org.locations,
    users: org.users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      status: u.status,
      organizationId: org.id,
      organizationName: org.name,
      organizationSlug: org.slug,
      createdAt: u.createdAt.toISOString(),
    })),
  };
}

export type CreateOrgInput = {
  name: string;
  slug?: string | null;
  primaryLocationName?: string | null;
  /** Clinic owner — invited as ADMIN with email link */
  ownerEmail: string;
  ownerName?: string | null;
  invitedById: string;
};

export async function createOrganization(input: CreateOrgInput) {
  const name = input.name.trim();
  if (name.length < 2) {
    return { ok: false as const, error: 'Organization name is required', status: 400 };
  }

  const ownerEmail = input.ownerEmail.trim().toLowerCase();
  if (!ownerEmail || !ownerEmail.includes('@')) {
    return { ok: false as const, error: 'Owner email is required', status: 400 };
  }

  const ownerName = (input.ownerName?.trim() || name + ' Admin').slice(0, 100);

  const existingOwner = await prisma.user.findUnique({ where: { email: ownerEmail } });
  if (existingOwner && existingOwner.status === 'ACTIVE' && existingOwner.passwordHash) {
    return {
      ok: false as const,
      error: 'Owner email is already registered. Use a different email.',
      status: 409,
    };
  }
  if (existingOwner?.role === 'SUPER_ADMIN') {
    return {
      ok: false as const,
      error: 'Cannot use platform admin email as clinic owner',
      status: 400,
    };
  }

  const slug = input.slug?.trim()
    ? await uniqueSlug(input.slug.trim())
    : await uniqueSlug(name);

  const locationName = (input.primaryLocationName || 'Main Clinic').trim();

  const org = await prisma.organization.create({
    data: {
      name,
      slug,
      active: true,
      locations: {
        create: {
          name: locationName,
          code: 'MAIN',
          isPrimary: true,
          active: true,
        },
      },
    },
    include: {
      locations: true,
      _count: { select: { users: true, locations: true } },
    },
  });

  const primaryLocation = org.locations.find((l) => l.isPrimary) || org.locations[0];

  const invite = await createStaffInvite({
    name: ownerName,
    email: ownerEmail,
    role: 'ADMIN',
    invitedById: input.invitedById,
    organizationId: org.id,
    locationId: primaryLocation?.id ?? null,
  });

  if (!invite.ok) {
    // Roll back empty org if owner invite failed
    await prisma.organization.delete({ where: { id: org.id } }).catch(() => null);
    return { ok: false as const, error: invite.error, status: invite.status };
  }

  return {
    ok: true as const,
    organization: {
      id: org.id,
      name: org.name,
      slug: org.slug,
      active: org.active,
      createdAt: org.createdAt.toISOString(),
      userCount: 1,
      locationCount: org._count.locations,
    },
    owner: {
      email: ownerEmail,
      name: ownerName,
      status: 'INVITED' as const,
    },
    emailMode: invite.emailMode,
  };
}

export async function updateOrganization(
  id: string,
  input: { name?: string; active?: boolean }
) {
  const existing = await prisma.organization.findUnique({ where: { id } });
  if (!existing) {
    return { ok: false as const, error: 'Organization not found', status: 404 };
  }

  const org = await prisma.organization.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
    },
    include: {
      _count: { select: { users: true, locations: true } },
    },
  });

  return {
    ok: true as const,
    organization: {
      id: org.id,
      name: org.name,
      slug: org.slug,
      active: org.active,
      createdAt: org.createdAt.toISOString(),
      userCount: org._count.users,
      locationCount: org._count.locations,
    },
  };
}

export async function deleteOrganization(id: string) {
  const existing = await prisma.organization.findUnique({
    where: { id },
    select: { id: true, name: true },
  });
  if (!existing) {
    return { ok: false as const, error: 'Organization not found', status: 404 as const };
  }

  await prisma.$transaction(async (tx) => {
    const locations = await tx.location.findMany({
      where: { organizationId: id },
      select: { id: true },
    });
    const locationIds = locations.map((l) => l.id);

    await tx.client.deleteMany({
      where: {
        OR: [
          ...(locationIds.length ? [{ locationId: { in: locationIds } }] : []),
          { assignedTo: { organizationId: id } },
        ],
      },
    });

    await tx.user.deleteMany({
      where: {
        organizationId: id,
        role: { not: 'SUPER_ADMIN' },
      },
    });

    await tx.user.updateMany({
      where: { organizationId: id, role: 'SUPER_ADMIN' },
      data: { organizationId: null },
    });

    await tx.organization.delete({ where: { id } });
  });

  return { ok: true as const, name: existing.name };
}

export async function listPlatformUsers(filters?: {
  organizationId?: string | null;
  q?: string | null;
  role?: string | null;
}) {
  const q = filters?.q?.trim();
  const roleFilter =
    filters?.role && CLINIC_ROLES.includes(filters.role as (typeof CLINIC_ROLES)[number])
      ? filters.role
      : undefined;

  const users = await prisma.user.findMany({
    where: {
      role: roleFilter ? (roleFilter as Role) : { not: 'SUPER_ADMIN' },
      ...(filters?.organizationId
        ? { organizationId: filters.organizationId }
        : {}),
      ...(q
        ? {
            OR: [
              { email: { contains: q, mode: 'insensitive' } },
              { name: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      organizationId: true,
      createdAt: true,
      organization: {
        select: {
          id: true,
          name: true,
          slug: true,
          _count: { select: { users: true } },
        },
      },
    },
    take: 200,
  });

  return users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    status: u.status,
    organizationId: u.organizationId,
    organizationName: u.organization?.name ?? null,
    organizationSlug: u.organization?.slug ?? null,
    organizationUserCount: u.organization?._count.users ?? 0,
    createdAt: u.createdAt.toISOString(),
  }));
}

export type CreatePlatformUserInput = {
  organizationId: string;
  name: string;
  email: string;
  role: Role;
  /** If set (≥8 chars), user is ACTIVE immediately; otherwise INVITED + email invite. */
  password?: string | null;
  invitedById: string;
};

export async function createPlatformUser(input: CreatePlatformUserInput) {
  if (input.role === 'SUPER_ADMIN') {
    return { ok: false as const, error: 'Cannot create platform admins here', status: 400 };
  }
  if (!CLINIC_ROLES.includes(input.role as (typeof CLINIC_ROLES)[number])) {
    return { ok: false as const, error: 'Invalid clinic role', status: 400 };
  }

  const org = await prisma.organization.findUnique({
    where: { id: input.organizationId },
  });
  if (!org) {
    return { ok: false as const, error: 'Organization not found', status: 404 };
  }
  if (!org.active) {
    return { ok: false as const, error: 'Organization is suspended', status: 400 };
  }

  const password = input.password?.trim() || '';
  if (password) {
    if (password.length < 8) {
      return { ok: false as const, error: 'Password must be at least 8 characters', status: 400 };
    }

    const email = input.email.trim().toLowerCase();
    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) {
      return { ok: false as const, error: 'A user with this email already exists', status: 409 };
    }

    const passwordHash = await hash(password, 12);
    const primary = await prisma.location.findFirst({
      where: { organizationId: org.id, active: true },
      orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }],
    });

    const user = await prisma.user.create({
      data: {
        name: input.name.trim(),
        email,
        passwordHash,
        role: input.role,
        status: 'ACTIVE',
        organizationId: org.id,
        primaryLocationId: primary?.id ?? null,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        organizationId: true,
        createdAt: true,
        organization: { select: { id: true, name: true, slug: true } },
      },
    });

    if (primary) {
      await assignUserToLocation(user.id, primary.id, true, org.id);
    }

    return {
      ok: true as const,
      mode: 'password' as const,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        organizationId: user.organizationId,
        organizationName: user.organization?.name ?? null,
        organizationSlug: user.organization?.slug ?? null,
        createdAt: user.createdAt.toISOString(),
      },
    };
  }

  const invited = await createStaffInvite({
    name: input.name,
    email: input.email,
    role: input.role,
    organizationId: org.id,
    invitedById: input.invitedById,
  });
  if (!invited.ok) {
    return { ok: false as const, error: invited.error, status: invited.status };
  }

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: invited.user.id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      organizationId: true,
      createdAt: true,
      organization: { select: { id: true, name: true, slug: true } },
    },
  });

  return {
    ok: true as const,
    mode: 'invite' as const,
    emailMode: invited.emailMode,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      organizationId: user.organizationId,
      organizationName: user.organization?.name ?? null,
      organizationSlug: user.organization?.slug ?? null,
      createdAt: user.createdAt.toISOString(),
    },
  };
}

export type UpdatePlatformUserInput = {
  role?: Role;
  status?: Extract<UserStatus, 'ACTIVE' | 'DEACTIVATED'>;
  organizationId?: string | null;
};

export async function updatePlatformUser(
  userId: string,
  input: UpdatePlatformUserInput
) {
  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) {
    return { ok: false as const, error: 'User not found', status: 404 };
  }
  if (target.role === 'SUPER_ADMIN') {
    return { ok: false as const, error: 'Cannot modify platform admins here', status: 403 };
  }

  if (input.role === 'SUPER_ADMIN') {
    return { ok: false as const, error: 'Cannot assign SUPER_ADMIN via this API', status: 400 };
  }

  if (input.role && !CLINIC_ROLES.includes(input.role as (typeof CLINIC_ROLES)[number])) {
    return { ok: false as const, error: 'Invalid clinic role', status: 400 };
  }

  let nextOrgId = target.organizationId;
  if (input.organizationId !== undefined) {
    if (input.organizationId === null) {
      return { ok: false as const, error: 'Clinic users must belong to an organization', status: 400 };
    }
    const org = await prisma.organization.findUnique({
      where: { id: input.organizationId },
    });
    if (!org) {
      return { ok: false as const, error: 'Organization not found', status: 404 };
    }
    nextOrgId = org.id;
  }

  if (input.status === 'DEACTIVATED' && target.role === 'ADMIN' && target.status === 'ACTIVE') {
    const otherAdmins = await prisma.user.count({
      where: {
        organizationId: target.organizationId,
        role: 'ADMIN',
        status: 'ACTIVE',
        id: { not: userId },
      },
    });
    if (otherAdmins === 0) {
      return {
        ok: false as const,
        error: 'Cannot deactivate the last active admin for this organization',
        status: 400,
      };
    }
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(input.role !== undefined ? { role: input.role } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.organizationId !== undefined ? { organizationId: nextOrgId } : {}),
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      organizationId: true,
      createdAt: true,
      organization: { select: { id: true, name: true, slug: true } },
    },
  });

  if (input.organizationId && nextOrgId) {
    const primary = await prisma.location.findFirst({
      where: { organizationId: nextOrgId, active: true },
      orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }],
    });
    if (primary) {
      await assignUserToLocation(userId, primary.id, true, nextOrgId);
    }
  }

  return {
    ok: true as const,
    user: {
      id: updated.id,
      name: updated.name,
      email: updated.email,
      role: updated.role,
      status: updated.status,
      organizationId: updated.organizationId,
      organizationName: updated.organization?.name ?? null,
      organizationSlug: updated.organization?.slug ?? null,
      createdAt: updated.createdAt.toISOString(),
    },
  };
}
