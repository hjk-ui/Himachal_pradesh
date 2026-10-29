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
  const staff = await prisma.user.findMany({
    take: 12,
    select: {
      id: true,
      name: true,
      email: true,
      role: true
    }
  });
  console.log(JSON.stringify(staff, null, 2));
  await prisma['$disconnect']();
}
main().catch(console.error);