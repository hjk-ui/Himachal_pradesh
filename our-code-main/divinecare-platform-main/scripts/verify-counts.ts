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

const prisma = new PrismaClient({
  datasourceUrl,
  log: ['error', 'warn'],
});

async function main() {
  const clients = await prisma.client.count();
  const activeClients = await prisma.client.count({ where: { status: 'ACTIVE' } });
  const inactiveClients = await prisma.client.count({ where: { status: 'INACTIVE' } });
  const users = await prisma.user.count();
  const appts = await prisma.appointment.count();
  const claims = await prisma.claim.count();
  const probs = await prisma.medicalProblem.count();
  const resResidents = await prisma.residentialResident.count();
  const crisisEpisodes = await prisma.crisisEpisode.count();
  const sudScreenings = await prisma.sudScreening.count();
  const locations = await prisma.location.findMany({
    select: { id: true, name: true, city: true, _count: { select: { clients: true } } }
  });

  console.log(JSON.stringify({
    clients,
    activeClients,
    inactiveClients,
    users,
    appts,
    claims,
    probs,
    resResidents,
    crisisEpisodes,
    sudScreenings,
    locations
  }, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
