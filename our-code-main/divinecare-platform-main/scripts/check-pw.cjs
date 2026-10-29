const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const prisma = new PrismaClient();

async function checkUsers() {
  const usersWithPw = await prisma.user.findMany({
    where: { passwordHash: { not: null } },
    select: { email: true, name: true, role: true }
  });
  console.log('Users with passwordHash:', usersWithPw);
}

checkUsers().catch(console.error).finally(() => prisma['']());