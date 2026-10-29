const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const prisma = new PrismaClient();

async function testTake() {
  const t0 = Date.now();
  const rows = await prisma.client.findMany({
    where: {
      organizationId: 'cmt03b5470000qfygksml21e6',
      name: { not: 'NON-PATIENT (Supervisory / Unavailable Block)' }
    },
    take: 100,
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      name: true,
      mrn: true,
      city: true,
      state: true,
      phone: true,
      primaryDiagnosisCode: true,
      secondaryDiagnoses: true,
      insurancePayer: true
    }
  });
  console.log('Query took:', Date.now() - t0, 'ms. Got rows:', rows.length);
  console.log('Sample client 1:', rows[0]);
  console.log('Sample client 2:', rows[1]);
}

testTake().catch(console.error).finally(() => prisma.$disconnect());