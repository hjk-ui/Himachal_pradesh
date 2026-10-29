const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const prisma = new PrismaClient();

async function checkOrgs() {
  const orgs = await prisma.organization.findMany();
  console.log('Orgs in DB:', orgs.map(o => ({ id: o.id, name: o.name, slug: o.slug })));

  const clientsWithOrg = await prisma.client.count({ where: { organizationId: { not: null } } });
  const clientsWithoutOrg = await prisma.client.count({ where: { organizationId: null } });
  console.log('Clients WITH organizationId:', clientsWithOrg);
  console.log('Clients WITHOUT organizationId:', clientsWithoutOrg);

  const sampleClient = await prisma.client.findFirst({
    select: { id: true, name: true, organizationId: true, locationId: true }
  });
  console.log('Sample client:', sampleClient);
}

checkOrgs().catch(console.error).finally(() => prisma['']());