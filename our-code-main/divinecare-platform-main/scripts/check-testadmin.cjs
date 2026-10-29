const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const prisma = new PrismaClient();

async function checkTestAdmin() {
  const user = await prisma.user.findFirst({
    where: { email: 'testadmin@altrixs.com' },
    select: { id: true, name: true, email: true, role: true, organizationId: true, passwordHash: true }
  });
  console.log('testadmin user:', user ? { ...user, passwordHash: !!user.passwordHash } : 'NOT FOUND');
}

checkTestAdmin().catch(console.error).finally(() => prisma['']());