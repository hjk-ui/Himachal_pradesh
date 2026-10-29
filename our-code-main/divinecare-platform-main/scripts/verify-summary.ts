import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const rawUrl = process.env.DATABASE_URL;
let datasourceUrl = rawUrl;
if (rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.hostname === '127.0.0.1' && url.port === '5433') {
      url.searchParams.set('connection_limit', '5');
      url.searchParams.set('pool_timeout', '60');
      url.searchParams.set('connect_timeout', '30');
      url.searchParams.set('sslaccept', 'accept_invalid_certs');
    }
    datasourceUrl = url.toString();
  } catch {
    datasourceUrl = rawUrl;
  }
}

const prisma = new PrismaClient({ datasourceUrl });

async function verify() {
  const [
    clientCount,
    appointmentCount,
    userCount,
    medicalProblemCount,
    claimCount,
    locationCount
  ] = await Promise.all([
    prisma.client.count(),
    prisma.appointment.count(),
    prisma.user.count(),
    prisma.medicalProblem.count(),
    prisma.claim.count(),
    prisma.location.count(),
  ]);

  console.log('=== REAL DATABASE COUNTS ===');
  console.log('Clients:', clientCount);
  console.log('Appointments:', appointmentCount);
  console.log('Users/Providers:', userCount);
  console.log('Medical Problems (ICD-10):', medicalProblemCount);
  console.log('Claims:', claimCount);
  console.log('Locations:', locationCount);

  const sampleClients = await prisma.client.findMany({
    take: 5,
    select: {
      id: true,
      name: true,
      mrn: true,
      dateOfBirth: true,
      gender: true,
      phone: true,
      city: true,
      state: true,
      status: true,
      insurancePayer: true,
      primaryDiagnosis: true,
      primaryDiagnosisCode: true,
    }
  });
  console.log('\n=== SAMPLE REAL CLIENTS (FROM VALANT) ===');
  console.log(JSON.stringify(sampleClients, null, 2));

  const sampleAppointments = await prisma.appointment.findMany({
    take: 5,
    select: {
      id: true,
      type: true,
      startsAt: true,
      endsAt: true,
      status: true,
      client: { select: { name: true, mrn: true } },
      clinician: { select: { name: true, email: true } },
    }
  });
  console.log('\n=== SAMPLE REAL APPOINTMENTS ===');
  console.log(JSON.stringify(sampleAppointments, null, 2));
}

verify().catch(console.error).finally(() => prisma.$disconnect());
