import { prisma } from '@/lib/db/prisma';
import { ensureDefaultOrganization } from './ensureOrganization';
import type { CreateLocationInput, UpdateLocationInput } from '@/types/locations';
import { assertSameOrg } from '@/lib/auth/tenant';

function mapLocation(l: {
  id: string;
  organizationId: string;
  name: string;
  code: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  phone: string | null;
  timezone: string;
  active: boolean;
  isPrimary: boolean;
  createdAt: Date;
  updatedAt: Date;
  _count?: { staffMemberships: number };
}) {
  return {
    id: l.id,
    organizationId: l.organizationId,
    name: l.name,
    code: l.code,
    addressLine1: l.addressLine1,
    addressLine2: l.addressLine2,
    city: l.city,
    state: l.state,
    postalCode: l.postalCode,
    phone: l.phone,
    timezone: l.timezone,
    active: l.active,
    isPrimary: l.isPrimary,
    createdAt: l.createdAt.toISOString(),
    updatedAt: l.updatedAt.toISOString(),
    staffCount: l._count?.staffMemberships ?? 0,
  };
}

async function resolveOrgId(organizationId?: string | null) {
  if (organizationId) return organizationId;
  const org = await ensureDefaultOrganization();
  return org.id;
}

export async function getOrganizationWithLocations(organizationId?: string | null) {
  const orgId = await resolveOrgId(organizationId);
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: orgId },
  });
  const locations = await prisma.location.findMany({
    where: { organizationId: org.id },
    orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }],
    include: { _count: { select: { staffMemberships: true } } },
  });

  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    active: org.active,
    locations: locations.map(mapLocation),
  };
}

export async function listLocations(organizationId?: string | null, activeOnly = false) {
  const orgId = await resolveOrgId(organizationId);
  const locations = await prisma.location.findMany({
    where: {
      organizationId: orgId,
      ...(activeOnly ? { active: true } : {}),
    },
    orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }],
    include: { _count: { select: { staffMemberships: true } } },
  });
  return locations.map(mapLocation);
}

export async function createLocation(
  input: CreateLocationInput,
  organizationId?: string | null
) {
  const orgId = await resolveOrgId(organizationId);
  const name = input.name.trim();
  if (name.length < 2) {
    return { ok: false as const, error: 'Location name is required', status: 400 };
  }

  const exists = await prisma.location.findFirst({
    where: { organizationId: orgId, name: { equals: name, mode: 'insensitive' } },
  });
  if (exists) {
    return { ok: false as const, error: 'A location with this name already exists', status: 409 };
  }

  const makePrimary = Boolean(input.isPrimary);
  if (makePrimary) {
    await prisma.location.updateMany({
      where: { organizationId: orgId, isPrimary: true },
      data: { isPrimary: false },
    });
  }

  const primaryCount = await prisma.location.count({
    where: { organizationId: orgId, isPrimary: true },
  });

  const location = await prisma.location.create({
    data: {
      organizationId: orgId,
      name,
      code: input.code?.trim() || null,
      addressLine1: input.addressLine1?.trim() || null,
      addressLine2: input.addressLine2?.trim() || null,
      city: input.city?.trim() || null,
      state: input.state?.trim() || null,
      postalCode: input.postalCode?.trim() || null,
      phone: input.phone?.trim() || null,
      timezone: input.timezone?.trim() || 'America/New_York',
      active: input.active ?? true,
      isPrimary: makePrimary || primaryCount === 0,
    },
    include: { _count: { select: { staffMemberships: true } } },
  });

  return { ok: true as const, location: mapLocation(location) };
}

export async function updateLocation(
  id: string,
  input: UpdateLocationInput,
  organizationId?: string | null
) {
  const existing = await prisma.location.findUnique({ where: { id } });
  if (!existing) {
    return { ok: false as const, error: 'Location not found', status: 404 };
  }

  if (organizationId) {
    const orgCheck = assertSameOrg(existing.organizationId, organizationId);
    if (orgCheck.ok === false) {
      return { ok: false as const, error: orgCheck.error, status: orgCheck.status };
    }
  }

  if (input.name) {
    const clash = await prisma.location.findFirst({
      where: {
        organizationId: existing.organizationId,
        id: { not: id },
        name: { equals: input.name.trim(), mode: 'insensitive' },
      },
    });
    if (clash) {
      return { ok: false as const, error: 'A location with this name already exists', status: 409 };
    }
  }

  if (input.isPrimary === true) {
    await prisma.location.updateMany({
      where: { organizationId: existing.organizationId, isPrimary: true, id: { not: id } },
      data: { isPrimary: false },
    });
  }

  if (input.isPrimary === false && existing.isPrimary) {
    return {
      ok: false as const,
      error: 'Set another location as primary before unsetting this one',
      status: 400,
    };
  }

  if (input.active === false && existing.isPrimary) {
    return {
      ok: false as const,
      error: 'Cannot deactivate the primary location. Make another location primary first.',
      status: 400,
    };
  }

  const location = await prisma.location.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.code !== undefined ? { code: input.code.trim() || null } : {}),
      ...(input.addressLine1 !== undefined
        ? { addressLine1: input.addressLine1.trim() || null }
        : {}),
      ...(input.addressLine2 !== undefined
        ? { addressLine2: input.addressLine2.trim() || null }
        : {}),
      ...(input.city !== undefined ? { city: input.city.trim() || null } : {}),
      ...(input.state !== undefined ? { state: input.state.trim() || null } : {}),
      ...(input.postalCode !== undefined ? { postalCode: input.postalCode.trim() || null } : {}),
      ...(input.phone !== undefined ? { phone: input.phone.trim() || null } : {}),
      ...(input.timezone !== undefined ? { timezone: input.timezone.trim() || 'America/New_York' } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
      ...(input.isPrimary !== undefined ? { isPrimary: input.isPrimary } : {}),
    },
    include: { _count: { select: { staffMemberships: true } } },
  });

  return { ok: true as const, location: mapLocation(location) };
}

/** Soft-deactivate location */
export async function deactivateLocation(id: string, organizationId?: string | null) {
  return updateLocation(id, { active: false }, organizationId);
}

export async function assignUserToLocation(
  userId: string,
  locationId: string,
  asPrimary = true,
  organizationId?: string | null
) {
  const location = await prisma.location.findFirst({
    where: { id: locationId, active: true },
  });
  if (!location) {
    return { ok: false as const, error: 'Active location not found', status: 404 };
  }

  if (organizationId) {
    const orgCheck = assertSameOrg(location.organizationId, organizationId);
    if (orgCheck.ok === false) {
      return { ok: false as const, error: orgCheck.error, status: orgCheck.status };
    }
  }

  if (asPrimary) {
    await prisma.userLocation.updateMany({
      where: { userId, isPrimary: true },
      data: { isPrimary: false },
    });
  }

  await prisma.userLocation.upsert({
    where: { userId_locationId: { userId, locationId } },
    create: { userId, locationId, isPrimary: asPrimary },
    update: { isPrimary: asPrimary },
  });

  if (asPrimary) {
    await prisma.user.update({
      where: { id: userId },
      data: {
        primaryLocationId: locationId,
        ...(organizationId ? { organizationId } : { organizationId: location.organizationId }),
      },
    });
  }

  return { ok: true as const };
}
