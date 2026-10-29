const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

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
  } catch {}
}

const prisma = new PrismaClient({ datasourceUrl });

async function main() {
  const countC = await prisma.client.count();
  const countA = await prisma.appointment.count();
  const countU = await prisma.user.count();
  console.log('--- DATABASE RECORD COUNTS ---');
  console.log('Real Clients: ' + countC);
  console.log('Real Appointments: ' + countA);
  console.log('Active Providers/Staff: ' + countU);

  const clients = await prisma.client.findMany({
    take: 4,
    select: {
      id: true,
      name: true,
      mrn: true,
      city: true,
      state: true,
      phone: true,
      insurancePayer: true,
      primaryDiagnosisCode: true,
      secondaryDiagnoses: true
    }
  });
  console.log('\n--- SAMPLE REAL CLIENTS (FROM VALANT CSV) ---');
  console.log(JSON.stringify(clients, null, 2));

  const appts = await prisma.appointment.findMany({
    take: 3,
    select: {
      id: true,
      title: true,
      startTime: true,
      endTime: true,
      status: true,
      type: true,
      client: { select: { name: true, mrn: true } },
      provider: { select: { name: true, email: true } }
    }
  });
  console.log('\n--- SAMPLE REAL APPOINTMENTS (FROM APPOINTMENTS CSV) ---');
  console.log(JSON.stringify(appts, null, 2));
}

main().catch(console.error).finally(() => prisma['']());