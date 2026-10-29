const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const prisma = new PrismaClient();

async function checkApptOrg() {
  const apptsWithOrg = await prisma.appointment.count({ where: { organizationId: { not: null } } });
  const apptsWithoutOrg = await prisma.appointment.count({ where: { organizationId: null } });
  console.log('Appts WITH organizationId:', apptsWithOrg);
  console.log('Appts WITHOUT organizationId:', apptsWithoutOrg);

  const sampleAppt = await prisma.appointment.findFirst({
    select: { id: true, clientName: true, clinicianName: true, organizationId: true }
  });
  console.log('Sample appt:', sampleAppt);
}

checkApptOrg().catch(console.error).finally(() => prisma['']());