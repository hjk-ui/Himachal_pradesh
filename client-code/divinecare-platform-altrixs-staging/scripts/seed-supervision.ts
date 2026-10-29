/**
 * Seed Clinical Supervision Log (tracks + sessions) for clinic orgs.
 *
 *   npm run db:seed:supervision
 *   SEED_ORG_SLUG=demo-clinic npm run db:seed:supervision
 *   REPLACE=1 npm run db:seed:supervision
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { seedClinicalSupervision } from '../prisma/supervisionSeed';

const prisma = new PrismaClient();

async function main() {
  const slug = process.env.SEED_ORG_SLUG?.trim();
  const replace = process.env.REPLACE === '1' || process.env.REPLACE === 'true';
  const orgs = slug
    ? await prisma.organization.findMany({ where: { slug } })
    : await prisma.organization.findMany({ orderBy: { slug: 'asc' } });
  if (!orgs.length) throw new Error('No organizations found');

  for (const org of orgs) {
    const result = await seedClinicalSupervision(prisma, org.id, org.slug, { replace });
    if (result.skipped) {
      console.log(
        `↷ ${org.slug} — already has ${result.tracks} tracks / ${result.logs} logs (set REPLACE=1 to reset)`
      );
    } else {
      console.log(
        `✓ ${org.slug} — ${result.users} staff, ${result.tracks} tracks, ${result.logs} sessions`
      );
    }
  }
  console.log(`\nDone — ${orgs.length} org(s). Open /dashboard/hr/supervision`);
  console.log('Demo logins (password Altrixs@123): jasmine.torres@<org-slug>.altrixs.local');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
