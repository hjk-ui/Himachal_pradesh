const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const prisma = new PrismaClient();

async function testList() {
  const user = await prisma.user.findFirst({
    where: { email: 'testadmin@altrixs.com' }
  });
  console.log('User found:', user.email, 'role:', user.role, 'orgId:', user.organizationId);

  const orgId = user.organizationId;
  const countTotalClients = await prisma.client.count({
    where: { organizationId: orgId }
  });
  console.log('Total clients for orgId in DB:', countTotalClients);

  // Let's test the exact where query used by listClientsForUser:
  // clientAccessWhere({ organizationId: orgId, actorUserId: user.id, actorRole: user.role })
  // For ADMIN: clientOrgFilter(orgId)
  // Which is: OR: [{ organizationId: orgId }, { location: { organizationId: orgId } }, ...]
  const clientsMatching = await prisma.client.findMany({
    where: {
      OR: [
        { organizationId: orgId },
        { location: { organizationId: orgId } },
        { AND: [{ locationId: null }, { assignedTo: { organizationId: orgId } }] }
      ]
    },
    take: 5,
    select: { id: true, name: true, mrn: true, organizationId: true }
  });
  console.log('Clients matching where filter:', clientsMatching.length);
  console.log('Sample:', clientsMatching);
}

testList().catch(console.error).finally(() => prisma['']());