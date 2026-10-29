/**
 * Create / update a clinic staff user for a specific role.
 *
 * Usage (PowerShell):
 *   $env:ROLE="FRONT_DESK"
 *   $env:ROLE_NAME="Front Desk"
 *   $env:ROLE_EMAIL="front@clinic.com"
 *   $env:ROLE_PASSWORD="StrongPass123"
 *   npm run db:create-clinic-role
 *
 * Roles: DIRECTOR | CLINICIAN | FRONT_DESK | BILLING | HR | ADMIN
 */
import { PrismaClient, Role } from '@prisma/client';
import { hash } from 'bcryptjs';

const prisma = new PrismaClient();

const ALLOWED: Role[] = [
  Role.ADMIN,
  Role.DIRECTOR,
  Role.CLINICIAN,
  Role.FRONT_DESK,
  Role.BILLING,
  Role.HR,
];

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
          { slug: 'altrixs-demo' },
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
  const roleRaw = (process.env.ROLE || '').trim().toUpperCase();
  const name = process.env.ROLE_NAME?.trim() || roleRaw.replaceAll('_', ' ');
  const email = process.env.ROLE_EMAIL?.trim().toLowerCase();
  const password = process.env.ROLE_PASSWORD;

  if (!roleRaw || !email || !password) {
    console.error('Set ROLE, ROLE_EMAIL, ROLE_PASSWORD (optional ROLE_NAME).');
    console.error('Example ROLE values: FRONT_DESK, BILLING, HR, DIRECTOR, CLINICIAN');
    process.exit(1);
  }

  if (!ALLOWED.includes(roleRaw as Role)) {
    console.error(`Invalid ROLE "${roleRaw}". Allowed: ${ALLOWED.join(', ')}`);
    process.exit(1);
  }

  if (password.length < 8) {
    console.error('ROLE_PASSWORD must be at least 8 characters.');
    process.exit(1);
  }

  const role = roleRaw as Role;
  const org = await ensureDefaultOrg();
  const primary =
    org.locations.find((l) => l.isPrimary && l.active) || org.locations[0] || null;

  const passwordHash = await hash(password, 12);
  const user = await prisma.user.upsert({
    where: { email },
    update: {
      name,
      passwordHash,
      role,
      status: 'ACTIVE',
      organizationId: org.id,
      primaryLocationId: primary?.id ?? null,
    },
    create: {
      name,
      email,
      passwordHash,
      role,
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

  const home =
    role === 'BILLING'
      ? '/dashboard/billing'
      : role === 'HR'
        ? '/dashboard/hr'
        : role === 'FRONT_DESK'
          ? '/dashboard/appointments'
          : '/dashboard';

  console.log('Clinic role user ready:');
  console.log(`  ${user.email} (${user.role})`);
  console.log(`  org=${org.slug}`);
  console.log(`  home=${home}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
