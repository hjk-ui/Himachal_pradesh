/**
 * Production helper: create a clinic ADMIN from env vars (attached to default org).
 *
 * Usage:
 *   ADMIN_NAME="Your Name" ADMIN_EMAIL="you@clinic.com" ADMIN_PASSWORD="StrongPass123" npm run db:create-admin
 */
import { PrismaClient, Role } from '@prisma/client';
import { hash } from 'bcryptjs';

const prisma = new PrismaClient();

const DEFAULT_ORG_SLUG = 'demo-clinic';

async function ensureDefaultOrg() {
  let org = await prisma.organization.findUnique({
    where: { slug: DEFAULT_ORG_SLUG },
    include: { locations: { orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] } },
  });

  if (!org) {
    const legacy = await prisma.organization.findFirst({
      where: {
        OR: [
          { slug: 'altrixs' },
          { slug: 'bridgecare' },
          { name: { equals: 'Altrixs', mode: 'insensitive' } },
        ],
      },
      include: { locations: { orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] } },
    });
    if (legacy) {
      org = await prisma.organization.update({
        where: { id: legacy.id },
        data: { name: 'Demo Clinic', slug: DEFAULT_ORG_SLUG },
        include: { locations: { orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] } },
      });
    }
  }

  if (!org) {
    org = await prisma.organization.create({
      data: {
        name: 'Demo Clinic',
        slug: DEFAULT_ORG_SLUG,
        locations: {
          create: {
            name: 'Main Clinic',
            code: 'MAIN',
            isPrimary: true,
            active: true,
          },
        },
      },
      include: { locations: { orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] } },
    });
  }
  return org;
}

async function main() {
  const name = process.env.ADMIN_NAME?.trim();
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;

  if (!name || !email || !password) {
    console.error('Set ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD env vars.');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('ADMIN_PASSWORD must be at least 8 characters.');
    process.exit(1);
  }

  const org = await ensureDefaultOrg();
  const primary =
    org.locations.find((l) => l.isPrimary && l.active) || org.locations[0] || null;

  const passwordHash = await hash(password, 12);
  const user = await prisma.user.upsert({
    where: { email },
    update: {
      name,
      passwordHash,
      role: Role.ADMIN,
      status: 'ACTIVE',
      organizationId: org.id,
      primaryLocationId: primary?.id ?? null,
    },
    create: {
      name,
      email,
      passwordHash,
      role: Role.ADMIN,
      status: 'ACTIVE',
      organizationId: org.id,
      primaryLocationId: primary?.id ?? null,
    },
  });

  if (primary) {
    await prisma.userLocation.upsert({
      where: {
        userId_locationId: { userId: user.id, locationId: primary.id },
      },
      create: { userId: user.id, locationId: primary.id, isPrimary: true },
      update: { isPrimary: true },
    });
  }

  console.log('Clinic admin ready:');
  console.log(`  ${user.email} (${user.role}) org=${org.slug}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
