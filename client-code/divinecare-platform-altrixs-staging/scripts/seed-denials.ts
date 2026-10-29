/**
 * Seed Claim + ClaimDenial rows for Denial Management analytics.
 *
 *   npm run db:seed:denials
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { seedDenialsForOrg } from "./denial-seed-rows";

const prisma = new PrismaClient();

async function main() {
  const slug = process.env.SEED_ORG_SLUG?.trim();
  const orgs = slug
    ? await prisma.organization.findMany({ where: { slug } })
    : await prisma.organization.findMany({ orderBy: { slug: "asc" } });
  if (!orgs.length) throw new Error("No organizations found");

  for (const org of orgs) {
    const clients = await prisma.client.findMany({
      where: {
        OR: [{ location: { organizationId: org.id } }, { assignedTo: { organizationId: org.id } }],
      },
      take: 12,
      orderBy: { createdAt: "asc" },
    });
    const created = await seedDenialsForOrg(prisma, org, clients);
    if (created) {
      console.log(`✓ ${org.slug} — ${created} denial claims (ClaimDenial)`);
    }
  }

  console.log(`\nDone — ${orgs.length} org(s). Open /dashboard/billing/denials`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
