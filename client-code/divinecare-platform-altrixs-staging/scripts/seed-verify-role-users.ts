import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('Altrixs@123', 10);
  const org =
    (await prisma.organization.findFirst({ where: { slug: 'altrixs-demo' } })) ??
    (await prisma.organization.findFirst());
  if (!org) throw new Error('No organization found');

  const users: { email: string; name: string; role: Role }[] = [
    { email: 'frontdesk@altrixs.local', name: 'Front Desk', role: Role.FRONT_DESK },
    { email: 'billing@altrixs.local', name: 'Billing Staff', role: Role.BILLING },
    { email: 'hr@altrixs.local', name: 'HR Manager', role: Role.HR },
    { email: 'director@altrixs.local', name: 'Clinical Director', role: Role.DIRECTOR },
  ];

  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: { role: u.role, organizationId: org.id, passwordHash, name: u.name },
      create: {
        email: u.email,
        name: u.name,
        role: u.role,
        organizationId: org.id,
        passwordHash,
      },
    });
    console.log('upserted', u.email, u.role);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
