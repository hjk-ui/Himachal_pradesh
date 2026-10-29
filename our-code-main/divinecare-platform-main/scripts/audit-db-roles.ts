import { prisma } from '../src/lib/db/prisma';

async function main() {
  console.log('Connecting to database via prisma...');
  try {
    const rolesGroup = await prisma.user.groupBy({
      by: ['role'],
      _count: { id: true },
    });
    console.log('SUCCESS! Group by role count:');
    console.log(JSON.stringify(rolesGroup, null, 2));

    const allUsers = await prisma.user.findMany({
      select: { id: true, email: true, name: true, role: true, roles: true },
    });
    console.log(`\nTotal users in DB: ${allUsers.length}`);
    for (const u of allUsers) {
      console.log(`- [${u.role}] ${u.name || 'No Name'} (${u.email}) | Roles: [${u.roles?.join(', ')}]`);
    }

    try {
      const enumVals: any = await prisma.$queryRawUnsafe(`
        SELECT enumlabel 
        FROM pg_enum 
        JOIN pg_type ON pg_enum.enumtypid = pg_type.oid 
        WHERE pg_type.typname = 'Role'
        ORDER BY pg_enum.enumsortorder;
      `);
      console.log('\nPostgreSQL "Role" ENUM labels in pg_enum:');
      console.log(enumVals.map((r: any) => r.enumlabel));
    } catch (e: any) {
      console.log('Could not query pg_enum:', e.message);
    }
  } catch (err: any) {
    console.error('Database connection error:', err.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
