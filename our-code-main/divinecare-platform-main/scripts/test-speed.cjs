const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const prisma = new PrismaClient();

async function testQuerySpeed() {
  console.time('findMany-take-50');
  const r50 = await prisma.client.findMany({
    where: { organizationId: 'cmt03b5470000qfygksml21e6' },
    take: 50,
    select: { id: true, name: true, mrn: true, city: true, phone: true }
  });
  console.timeEnd('findMany-take-50');
  console.log('Got 50 clients:', r50.length);

  console.time('findMany-take-15440-with-includes');
  try {
    const t0 = Date.now();
    const count = await prisma.client.count();
    console.log('Total count:', count, 'in', Date.now() - t0, 'ms');
  } catch (e) {
    console.error(e);
  }
}

testQuerySpeed().catch(console.error).finally(() => prisma['']());