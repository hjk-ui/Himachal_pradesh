/**
 * Seed Community Events & Outreach for clinic orgs.
 *
 *   npm run db:seed:community
 *   SEED_ORG_SLUG=demo-clinic npm run db:seed:community
 *   REPLACE=1 npm run db:seed:community
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { seedCommunityOutreach } from '../prisma/communitySeed';

const prisma = new PrismaClient();

async function main() {
  const slug = process.env.SEED_ORG_SLUG?.trim();
  const replace = process.env.REPLACE === '1' || process.env.REPLACE === 'true';
  const orgs = slug
    ? await prisma.organization.findMany({ where: { slug } })
    : await prisma.organization.findMany({ orderBy: { slug: 'asc' } });
  if (!orgs.length) throw new Error('No organizations found');

  for (const org of orgs) {
    const result = await seedCommunityOutreach(prisma, org.id, { replace });
    if (result.skipped) {
      console.log(`↷ ${org.slug} — already has ${result.events} events (set REPLACE=1 to reset)`);
    } else {
      console.log(
        `✓ ${org.slug} — ${result.events} events, ${result.partners} partners, ${result.volunteers} volunteers`
      );
    }
  }
  console.log(`\nDone — ${orgs.length} org(s). Open /dashboard/community`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
