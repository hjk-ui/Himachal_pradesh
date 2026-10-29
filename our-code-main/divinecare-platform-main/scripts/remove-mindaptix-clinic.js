/* eslint-disable @typescript-eslint/no-require-imports */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    where: {
      email: {
        contains: 'mindaptix.com',
        mode: 'insensitive',
      },
    },
    select: {
      id: true,
      email: true,
      organizationId: true,
      organization: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
    },
  });

  if (!users.length) {
    console.log('No mindaptix users found.');
    return;
  }

  const orgIds = [...new Set(users.map((user) => user.organizationId).filter(Boolean))];
  if (!orgIds.length) {
    console.log('Mindaptix users found but no organization attached.');
    return;
  }

  for (const orgId of orgIds) {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      include: {
        users: { select: { id: true, email: true } },
        locations: { select: { id: true, name: true } },
      },
    });

    if (!org) continue;

    const hasMindaptix = org.users.some((user) => user.email.toLowerCase().includes('mindaptix.com'));
    if (!hasMindaptix) continue;

    console.log(`Removing org: ${org.name} (${org.slug})`);
    console.log(`  users: ${org.users.length}`);
    console.log(`  locations: ${org.locations.length}`);

    await prisma.organization.delete({ where: { id: org.id } });
    console.log('  deleted');
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
