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
  const counts: Record<string, number> = {};
  counts.clients = await prisma.client.count();
  counts.appointments = await prisma.appointment.count();
  counts.claims = await prisma.claim.count();
  counts.medicalProblems = await prisma.medicalProblem.count();
  counts.users = await prisma.user.count();
  counts.locations = await prisma.location.count();

  // Specialized tables
  counts.residentialResident = await prisma.residentialResident.count();
  counts.residentialShiftNote = await prisma.residentialShiftNote.count();
  counts.crisisEpisode = await prisma.crisisEpisode.count();
  counts.crisisTeamPage = await prisma.crisisTeamPage.count();
  counts.aotParticipant = await prisma.aotParticipant.count();
  counts.specializedBillingCharge = await prisma.specializedBillingCharge.count();
  counts.riskAlert = await prisma.riskAlert.count();
  counts.sudScreening = await prisma.sudScreening.count();
  counts.sudRadarSignal = await prisma.sudRadarSignal.count();
  counts.waitlist = await prisma.waitlistEntry.count();
  counts.referral = await prisma.prpReferral.count();
  counts.message = await prisma.message.count();

  console.log('TABLE COUNTS:', JSON.stringify(counts, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
