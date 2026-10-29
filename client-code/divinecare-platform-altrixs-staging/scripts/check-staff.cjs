const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const prisma = new PrismaClient();

async function checkStaff() {
  const staff = await prisma.user.findMany({
    where: { organizationId: 'cmt03b5470000qfygksml21e6' },
    select: { id: true, name: true, email: true, role: true },
    take: 10
  });
  console.log('Sample Staff/Admins for Altrixs:', staff);
}

checkStaff().catch(console.error).finally(() => prisma['']());