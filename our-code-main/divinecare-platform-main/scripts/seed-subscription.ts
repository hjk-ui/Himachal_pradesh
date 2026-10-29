/**
 * Seed Plan & Subscription marketing content (FAQ, competitor compare, enterprise CTA).
 *
 *   npm run db:seed:subscription
 */
import "dotenv/config";
import { PrismaClient, type Prisma } from "@prisma/client";
import { SUBSCRIPTION_PAGE_SEED } from "../src/lib/subscription/catalog";

const prisma = new PrismaClient();

async function upsert(orgId: string, module: string, data: unknown) {
  await prisma.clinicModuleState.upsert({
    where: { organizationId_module: { organizationId: orgId, module } },
    create: {
      organizationId: orgId,
      module,
      data: data as Prisma.InputJsonValue,
    },
    update: { data: data as Prisma.InputJsonValue },
  });
}

async function main() {
  const slug = process.env.SEED_ORG_SLUG?.trim();
  const orgs = slug
    ? await prisma.organization.findMany({ where: { slug } })
    : await prisma.organization.findMany({ orderBy: { slug: "asc" } });
  if (!orgs.length) throw new Error("No organizations found");

  for (const org of orgs) {
    await upsert(org.id, "subscription-page", [SUBSCRIPTION_PAGE_SEED]);
    const existing = await prisma.clinicModuleState.findUnique({
      where: {
        organizationId_module: { organizationId: org.id, module: "subscription-state" },
      },
    });
    if (!existing) {
      await upsert(org.id, "subscription-state", {
        plan: "free",
        billingCycle: "monthly",
        updatedAt: new Date().toISOString(),
        stripePortalConfigured: Boolean(process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET),
      });
    }
    console.log(
      `✓ ${org.slug} — subscription-page (${SUBSCRIPTION_PAGE_SEED.faqs.length} FAQs, ${SUBSCRIPTION_PAGE_SEED.competitors.length} compare rows)`
    );
  }
  console.log(`\nDone — ${orgs.length} org(s). Open /dashboard/subscription`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
