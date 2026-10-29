import { prisma } from '../src/lib/db/prisma';

async function main() {
  console.log('=== STARTING SAFE LEGACY ROLE MIGRATION ===');

  // Step 1: Add new ENUM values to PostgreSQL enum if not already present
  console.log('\n1. Ensuring new values exist in PostgreSQL "Role" ENUM...');
  try {
    await prisma.$executeRawUnsafe(`ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'PRACTICE_DIRECTOR';`);
    console.log('  ✔ PRACTICE_DIRECTOR enum value confirmed');
  } catch (err: any) {
    console.log('  Notice (PRACTICE_DIRECTOR):', err.message);
  }

  try {
    await prisma.$executeRawUnsafe(`ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'OFFICE_MANAGER';`);
    console.log('  ✔ OFFICE_MANAGER enum value confirmed');
  } catch (err: any) {
    console.log('  Notice (OFFICE_MANAGER):', err.message);
  }

  // Check roles before migration
  console.log('\n2. User role distribution BEFORE migration:');
  const beforeRoles: any = await prisma.$queryRawUnsafe(`
    SELECT role, COUNT(*)::int as count FROM "User" GROUP BY role ORDER BY count DESC;
  `);
  console.table(beforeRoles);

  // Step 2: Migrate primary role
  console.log('\n3. Executing primary role data updates...');
  const resClinician = await prisma.$executeRawUnsafe(`
    UPDATE "User" SET role = 'THERAPIST' WHERE role = 'CLINICIAN';
  `);
  console.log(`  ✔ Migrated ${resClinician} CLINICIAN -> THERAPIST`);

  const resDirector = await prisma.$executeRawUnsafe(`
    UPDATE "User" SET role = 'PRACTICE_DIRECTOR' WHERE role = 'DIRECTOR';
  `);
  console.log(`  ✔ Migrated ${resDirector} DIRECTOR -> PRACTICE_DIRECTOR`);

  const resOffice = await prisma.$executeRawUnsafe(`
    UPDATE "User" SET role = 'OFFICE_MANAGER' WHERE role IN ('FRONT_DESK', 'BILLING', 'HR');
  `);
  console.log(`  ✔ Migrated ${resOffice} FRONT_DESK / BILLING / HR -> OFFICE_MANAGER`);

  // Step 3: Migrate roles array column
  console.log('\n4. Synchronizing user "roles" array column...');
  const resArrayClinician = await prisma.$executeRawUnsafe(`
    UPDATE "User" SET roles = array_replace(roles, 'CLINICIAN', 'THERAPIST') WHERE 'CLINICIAN' = ANY(roles);
  `);
  console.log(`  ✔ Replaced CLINICIAN in ${resArrayClinician} role arrays`);

  const resArrayDirector = await prisma.$executeRawUnsafe(`
    UPDATE "User" SET roles = array_replace(roles, 'DIRECTOR', 'PRACTICE_DIRECTOR') WHERE 'DIRECTOR' = ANY(roles);
  `);
  console.log(`  ✔ Replaced DIRECTOR in ${resArrayDirector} role arrays`);

  const resArrayOffice = await prisma.$executeRawUnsafe(`
    UPDATE "User" 
    SET roles = array_replace(array_replace(array_replace(roles, 'FRONT_DESK', 'OFFICE_MANAGER'), 'BILLING', 'OFFICE_MANAGER'), 'HR', 'OFFICE_MANAGER')
    WHERE 'FRONT_DESK' = ANY(roles) OR 'BILLING' = ANY(roles) OR 'HR' = ANY(roles);
  `);
  console.log(`  ✔ Replaced FRONT_DESK/BILLING/HR in ${resArrayOffice} role arrays`);

  // Deduplicate roles array (e.g. if multirole had both FRONT_DESK and BILLING)
  await prisma.$executeRawUnsafe(`
    UPDATE "User"
    SET roles = ARRAY(SELECT DISTINCT unnest(roles));
  `);
  console.log('  ✔ Deduplicated roles arrays');

  // Step 4: Verification
  console.log('\n5. User role distribution AFTER migration:');
  const afterRoles: any = await prisma.$queryRawUnsafe(`
    SELECT role, COUNT(*)::int as count FROM "User" GROUP BY role ORDER BY count DESC;
  `);
  console.table(afterRoles);

  console.log('\n=== MIGRATION COMPLETED SUCCESSFULLY ===');
}

main()
  .catch((e) => {
    console.error('Migration failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
