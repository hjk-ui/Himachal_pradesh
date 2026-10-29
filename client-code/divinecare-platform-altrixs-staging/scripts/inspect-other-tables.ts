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
  const residents = await prisma.residentialResident.findMany({
    take: 5
  });
  const episodes = await prisma.crisisEpisode.findMany({
    take: 5
  });
  console.log('RESIDENTS:', JSON.stringify(residents, null, 2));
  console.log('CRISIS:', JSON.stringify(episodes, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
