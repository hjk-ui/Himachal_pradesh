const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const prisma = new PrismaClient();

async function main() {
  const appts = await prisma.appointment.findMany({
    take: 5,
    select: {
      id: true,
      clientName: true,
      clinicianName: true,
      startsAt: true,
      endsAt: true,
      status: true,
      type: true,
      isVirtual: true,
      notes: true,
      insurancePayer: true
    }
  });
  console.log('\n--- SAMPLE REAL APPOINTMENTS (5 of 5,229) ---');
  console.log(JSON.stringify(appts, null, 2));

  const claims = await prisma.claim.findMany({
    take: 5,
    select: {
      id: true,
      claimNumber: true,
      status: true,
      totalAmount: true,
      billingCodes: true,
      client: { select: { name: true, mrn: true } }
    }
  });
  console.log('\n--- SAMPLE CLAIMS GENERATED ---');
  console.log(JSON.stringify(claims, null, 2));
}

main().catch(console.error).finally(() => prisma['']());