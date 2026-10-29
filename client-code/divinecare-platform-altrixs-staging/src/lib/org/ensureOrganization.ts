import { prisma } from '@/lib/db/prisma';

export const DEFAULT_ORG_SLUG = 'altrixs';
const DEFAULT_ORG_NAME = 'Altrixs';

/** Ensures a default organization + primary location exist (idempotent). */
export async function ensureDefaultOrganization() {
  let org = await prisma.organization.findUnique({
    where: { slug: DEFAULT_ORG_SLUG },
    include: { locations: { orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] } },
  });

  if (!org) {
    org = await prisma.organization.create({
      data: {
        name: DEFAULT_ORG_NAME,
        slug: DEFAULT_ORG_SLUG,
        locations: {
          create: [
            {
              name: 'Main Clinic',
              code: 'MAIN',
              city: 'Baltimore',
              state: 'MD',
              timezone: 'America/New_York',
              isPrimary: true,
              active: true,
            },
            {
              name: 'Telehealth Hub',
              code: 'TELE',
              city: 'Remote',
              state: 'MD',
              timezone: 'America/New_York',
              isPrimary: false,
              active: true,
            },
          ],
        },
      },
      include: { locations: { orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] } },
    });
  }

  if (org.locations.length === 0) {
    await prisma.location.create({
      data: {
        organizationId: org.id,
        name: 'Main Clinic',
        code: 'MAIN',
        isPrimary: true,
        active: true,
      },
    });
    org = await prisma.organization.findUniqueOrThrow({
      where: { id: org.id },
      include: { locations: { orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] } },
    });
  }

  return org;
}

export async function getOrganizationById(organizationId: string) {
  return prisma.organization.findUnique({
    where: { id: organizationId },
    include: { locations: { orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] } },
  });
}

export async function getPrimaryLocationId(organizationId?: string | null) {
  if (organizationId) {
    const locations = await prisma.location.findMany({
      where: { organizationId, active: true },
      orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }],
    });
    const primary = locations.find((l) => l.isPrimary) || locations[0];
    return primary?.id ?? null;
  }

  const org = await ensureDefaultOrganization();
  const primary = org.locations.find((l) => l.isPrimary && l.active) || org.locations[0];
  return primary?.id ?? null;
}

/** Attach any users missing organizationId to the default org (idempotent backfill). */
export async function backfillUsersToDefaultOrg() {
  const org = await ensureDefaultOrganization();
  const result = await prisma.user.updateMany({
    where: {
      organizationId: null,
      role: { not: 'SUPER_ADMIN' },
    },
    data: { organizationId: org.id },
  });
  return { organizationId: org.id, updated: result.count };
}
