const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const prisma = new PrismaClient();

async function main() {
  const patientAppts = await prisma.appointment.findMany({
    where: { clientName: { not: 'NON-PATIENT' } },
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
  console.log('=== REAL PATIENT APPOINTMENTS (Sample 5 of patient schedule) ===');
  console.log(JSON.stringify(patientAppts, null, 2));

  const totalPatientAppts = await prisma.appointment.count({
    where: { clientName: { not: 'NON-PATIENT' } }
  });
  const totalNonPatient = await prisma.appointment.count({
    where: { clientName: 'NON-PATIENT' }
  });
  console.log('Patient Scheduled Appointments: ' + totalPatientAppts);
  console.log('Staff/Supervisory Blocks: ' + totalNonPatient);

  const claimCount = await prisma.claim.count();
  console.log('Claims in DB: ' + claimCount);
  if (claimCount > 0) {
    const claims = await prisma.claim.findMany({
      take: 3,
      select: {
        id: true,
        cptCode: true,
        units: true,
        amountCents: true,
        payer: true,
        icd10Codes: true,
        status: true,
        client: { select: { name: true, mrn: true } }
      }
    });
    console.log('=== SAMPLE CLAIMS ===');
    console.log(JSON.stringify(claims, null, 2));
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());