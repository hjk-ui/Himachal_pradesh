/**
 * Seed HR Corner (People, Payroll, Benefits, PTO, Talent, Learning, Compliance, Analytics).
 *
 *   npm run db:seed:hr-corner
 *   SEED_ORG_SLUG=demo-clinic npm run db:seed:hr-corner
 *   REPLACE=1 npm run db:seed:hr-corner
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { seedHrCorner } from '../prisma/hrCornerSeed';

const prisma = new PrismaClient();

async function main() {
  const slug = process.env.SEED_ORG_SLUG?.trim();
  const replace = process.env.REPLACE === '1' || process.env.REPLACE === 'true';
  const orgs = slug
    ? await prisma.organization.findMany({ where: { slug } })
    : await prisma.organization.findMany({ orderBy: { slug: 'asc' } });
  if (!orgs.length) throw new Error('No organizations found');

  for (const org of orgs) {
    const result = await seedHrCorner(prisma, org.id, org.slug, { replace });
    if (result.skipped) {
      console.log(`↷ ${org.slug} — already has ${result.staff} HR Corner staff (set REPLACE=1 to reset)`);
    } else {
      console.log(`✓ ${org.slug} — ${result.staff} employees seeded`);
    }
  }
  console.log(`\nDone — ${orgs.length} org(s). Open /dashboard/hr`);
  console.log('Demo HR logins (password Altrixs@123): marcus.johnson@divinecounseling.com (demo-clinic)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
