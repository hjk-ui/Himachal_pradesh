/**
 * Seed Staff Credentialing (licenses, CEUs, malpractice, DEA, background) for clinic orgs.
 *
 *   npm run db:seed:credentialing
 *   SEED_ORG_SLUG=demo-clinic npm run db:seed:credentialing
 *   REPLACE=1 npm run db:seed:credentialing
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { seedStaffCredentialing } from '../prisma/credentialSeed';

const prisma = new PrismaClient();

async function main() {
  const slug = process.env.SEED_ORG_SLUG?.trim();
  const replace = process.env.REPLACE === '1' || process.env.REPLACE === 'true';
  const orgs = slug
    ? await prisma.organization.findMany({ where: { slug } })
    : await prisma.organization.findMany({ orderBy: { slug: 'asc' }, take: 3 });
  if (!orgs.length) throw new Error('No organizations found');

  for (const org of orgs) {
    const result = await seedStaffCredentialing(prisma, org.id, org.slug, { replace });
    if (result.skipped) {
      console.log(
        `↷ ${org.slug} — already has ${result.credentials} credentials (set REPLACE=1 to reset)`
      );
    } else {
      console.log(`✓ ${org.slug} — ${result.users} staff, ${result.credentials} credentials`);
    }
  }
  console.log(`\nDone — ${orgs.length} org(s). Open /dashboard/hr/credentialing`);
  console.log('Demo logins (password Altrixs@123): renee.jackson@<org-slug>.altrixs.local');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
