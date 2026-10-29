/* eslint-disable @typescript-eslint/no-require-imports */
const { PrismaClient, Role } = require('@prisma/client');
const { hash } = require('bcryptjs');

const prisma = new PrismaClient();

const PASSWORD = process.env.ROLE_DEMO_PASSWORD?.trim() || 'Altrixs@123';
const TARGET_ORG_ID = process.env.TARGET_ORG_ID?.trim() || '';
const TARGET_ORG_SLUG = process.env.TARGET_ORG_SLUG?.trim() || '';

const ROLES = [
  { role: Role.ADMIN, name: 'Clinic Admin', email: 'admin@role-demo.local' },
  { role: Role.DIRECTOR, name: 'Practice Director', email: 'director@role-demo.local' },
  { role: Role.THERAPIST, name: 'Therapist Nia Patel', email: 'therapist@role-demo.local' },
  { role: Role.PSYCHIATRIST, name: 'Dr. Samir Shah', email: 'psychiatrist@role-demo.local' },
  { role: Role.NP, name: 'Maya Lewis, NP', email: 'np@role-demo.local' },
  { role: Role.PRP_SPECIALIST, name: 'PRP Specialist Jordan Reed', email: 'prp@role-demo.local' },
  { role: Role.CASE_MANAGER, name: 'Case Manager Elena Brooks', email: 'case@role-demo.local' },
  { role: Role.PEER_SUPPORT, name: 'Peer Support Tariq Ahmed', email: 'peer@role-demo.local' },
  { role: Role.FRONT_DESK, name: 'Front Desk', email: 'office@role-demo.local' },
  { role: Role.BILLING, name: 'Billing Specialist Nina Clark', email: 'billing@role-demo.local' },
  { role: Role.HR, name: 'HR Manager Sofia Jones', email: 'hr@role-demo.local' },
];

async function resolveOrg() {
  if (TARGET_ORG_ID) {
    const org = await prisma.organization.findUnique({
      where: { id: TARGET_ORG_ID },
      include: { locations: { orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] } },
    });
    if (!org) throw new Error(`Organization not found for TARGET_ORG_ID=${TARGET_ORG_ID}`);
    return org;
  }

  if (TARGET_ORG_SLUG) {
    const org = await prisma.organization.findUnique({
      where: { slug: TARGET_ORG_SLUG },
      include: { locations: { orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] } },
    });
    if (org) return org;
  }

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
  if (legacy) return legacy;

  const org = await prisma.organization.findUnique({
    where: { slug: 'role-demo-clinic' },
    include: { locations: { orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] } },
  });
  if (!org) throw new Error('role-demo-clinic org not found');
  return org;
}

async function main() {
  if (PASSWORD.length < 8) {
    throw new Error('ROLE_DEMO_PASSWORD must be at least 8 characters.');
  }

  const org = await resolveOrg();
  const primary = org.locations.find((l) => l.isPrimary && l.active) || org.locations[0] || null;
  const passwordHash = await hash(PASSWORD, 12);

  await prisma.user.deleteMany({ where: { organizationId: org.id } });

  for (const entry of ROLES) {
    const user = await prisma.user.upsert({
      where: { email: entry.email },
      update: {
        name: entry.name,
        passwordHash,
        role: entry.role,
        status: 'ACTIVE',
        organizationId: org.id,
        primaryLocationId: primary?.id ?? null,
      },
      create: {
        name: entry.name,
        email: entry.email,
        passwordHash,
        role: entry.role,
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
  }

  console.log(`Seeded 11 clinic roles for ${org.slug} using password ${PASSWORD}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
