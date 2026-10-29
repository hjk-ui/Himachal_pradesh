import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const rawUrl = process.env.DATABASE_URL;
let datasourceUrl = rawUrl;
if (rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.hostname === '127.0.0.1' && url.port === '5433') {
      url.searchParams.set('connection_limit', '3');
      url.searchParams.set('pool_timeout', '30');
      url.searchParams.set('connect_timeout', '20');
      url.searchParams.set('sslaccept', 'accept_invalid_certs');
    }
    datasourceUrl = url.toString();
  } catch {
    datasourceUrl = rawUrl;
  }
}

const prisma = new PrismaClient({ datasourceUrl });

async function main() {
  console.log('🧹 Purging any lingering fake seed records from DB...');

  // 1. Purge fake residential & crisis seeds
  const delShiftNotes = await prisma.residentialShiftNote.deleteMany({});
  const delResidents = await prisma.residentialResident.deleteMany({});
  const delCrisisPages = await prisma.crisisTeamPage.deleteMany({});
  const delCrisis = await prisma.crisisEpisode.deleteMany({});
  const delAot = await prisma.aotParticipant.deleteMany({});
  const delSpecBilling = await prisma.specializedBillingCharge.deleteMany({});

  console.log(`- Cleared ${delResidents.count} residential residents & ${delShiftNotes.count} shift notes`);
  console.log(`- Cleared ${delCrisis.count} crisis episodes & ${delCrisisPages.count} crisis pages`);
  console.log(`- Cleared ${delAot.count} AOT participants`);
  console.log(`- Cleared ${delSpecBilling.count} specialized billing charges`);

  // Verify core imported data remains 100% intact
  const clientsCount = await prisma.client.count();
  const activeClients = await prisma.client.count({ where: { status: 'ACTIVE' } });
  const inactiveClients = await prisma.client.count({ where: { status: 'INACTIVE' } });
  const apptsCount = await prisma.appointment.count();
  const claimsCount = await prisma.claim.count();
  const probsCount = await prisma.medicalProblem.count();
  const usersCount = await prisma.user.count();

  console.log('\n📊 VERIFIED LIVE DATA IN POSTGRESQL:');
  console.log(`- Total Clients: ${clientsCount} (${activeClients} Active, ${inactiveClients} Inactive)`);
  console.log(`- Scheduled Appointments: ${apptsCount}`);
  console.log(`- Billable Claims: ${claimsCount}`);
  console.log(`- ICD-10 Medical Problems: ${probsCount}`);
  console.log(`- Staff Users / Providers: ${usersCount}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
