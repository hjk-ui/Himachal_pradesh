/* eslint-disable @typescript-eslint/no-require-imports */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const orgs = await prisma.organization.findMany({
    where: {
      OR: [
        { name: { contains: 'mindaptix', mode: 'insensitive' } },
        { name: { contains: 'altrixs', mode: 'insensitive' } },
        { slug: { contains: 'mindaptix', mode: 'insensitive' } },
      ],
    },
    select: {
      id: true,
      name: true,
      slug: true,
      _count: { select: { users: true, locations: true } },
    },
  });

  const users = await prisma.user.findMany({
    where: {
      OR: [
        { email: { contains: 'mindaptix', mode: 'insensitive' } },
        { name: { contains: 'gaurav', mode: 'insensitive' } },
        { name: { contains: 'mindaptix', mode: 'insensitive' } },
      ],
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      organizationId: true,
      organization: { select: { name: true, slug: true } },
    },
  });

  console.log('Organizations:');
  console.log(JSON.stringify(orgs, null, 2));
  console.log('Users:');
  console.log(JSON.stringify(users, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
