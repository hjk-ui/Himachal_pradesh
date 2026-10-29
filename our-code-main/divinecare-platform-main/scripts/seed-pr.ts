/**
 * Seed PR & Marketing for clinic orgs.
 *
 *   npm run db:seed:pr
 *   SEED_ORG_SLUG=demo-clinic npm run db:seed:pr
 *   REPLACE=1 npm run db:seed:pr
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { seedPrMarketing } from '../prisma/prSeed';

const prisma = new PrismaClient();

async function main() {
  const slug = process.env.SEED_ORG_SLUG?.trim();
  const replace = process.env.REPLACE === '1' || process.env.REPLACE === 'true';
  const orgs = slug
    ? await prisma.organization.findMany({ where: { slug } })
    : await prisma.organization.findMany({ orderBy: { slug: 'asc' } });
  if (!orgs.length) throw new Error('No organizations found');

  for (const org of orgs) {
    const result = await seedPrMarketing(prisma, org.id, { replace });
    if (result.skipped) {
      console.log(`↷ ${org.slug} — PR data already present (set REPLACE=1 to reset)`);
    } else {
      console.log(
        `✓ ${org.slug} — ${result.campaigns} campaigns, ${result.posts} posts, ${result.coverage} coverage items`
      );
    }
  }
  console.log(`\nDone — ${orgs.length} org(s). Open /dashboard/pr`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
