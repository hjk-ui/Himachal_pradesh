import { PrismaClient } from '@prisma/client';

async function main() {
  const url = 'postgresql://postgres:Altrixs2026andyusa22@127.0.0.1:5433/altrixs_local?sslmode=require&sslaccept=accept_invalid_certs';
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  try {
    const rolesGroup = await prisma.user.groupBy({
      by: ['role'],
      _count: { id: true },
    });
    console.log('🎉 SUCCESS! User roles grouped:');
    console.log(JSON.stringify(rolesGroup, null, 2));

    const total = await prisma.user.count();
    console.log('\nTotal users in DB:', total);

    const users = await prisma.user.findMany({
      select: { id: true, name: true, email: true, role: true, roles: true, status: true },
    });
    console.log('\nAll users in database:');
    for (const u of users) {
      console.log(`- [${u.role}] ${u.name || 'No Name'} (${u.email}) | extra roles: [${u.roles?.join(', ')}] | status: ${u.status}`);
    }

    const rawEnum: any = await prisma.$queryRawUnsafe(`
      SELECT enumlabel 
      FROM pg_enum 
      JOIN pg_type ON pg_enum.enumtypid = pg_type.oid 
      WHERE pg_type.typname = 'Role'
      ORDER BY pg_enum.enumsortorder;
    `);
    console.log('\nPostgreSQL "Role" ENUM labels in database:');
    console.log(rawEnum.map((r: any) => r.enumlabel));
  } catch (err: any) {
    console.error('Error with accept_invalid_certs:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
