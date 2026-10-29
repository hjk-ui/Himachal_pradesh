/**
 * Billing status report (read-only). Formerly seeded "free" plan records; that is no longer done
 * because plans now come from src/lib/billing/plans.ts and orgs without a record are grandfathered.
 *
 *   npm run db:seed:subscription            # all orgs
 *   SEED_ORG_SLUG=<slug> npm run db:seed:subscription
 *
 * Prints each org's billing status and access mode. Writes nothing.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { SUBSCRIPTION_MODULE, normalizeRecord } from "../src/lib/billing/subscriptionRecord";
import { resolveAccess } from "../src/lib/billing/entitlements";

const prisma = new PrismaClient();

async function main() {
  const slug = process.env.SEED_ORG_SLUG?.trim();
  const orgs = await prisma.organization.findMany({
    where: slug ? { slug } : undefined,
    orderBy: { slug: "asc" },
    select: { id: true, slug: true, name: true },
  });
  for (const org of orgs) {
    const row = await prisma.clinicModuleState.findUnique({
      where: { organizationId_module: { organizationId: org.id, module: SUBSCRIPTION_MODULE } },
    });
    const record = normalizeRecord(row?.data ?? null);
    const access = resolveAccess(org.id, record);
    console.log(
      `${org.slug.padEnd(32)} status=${access.status.padEnd(13)} tier=${(record.tier ?? "-").padEnd(12)} mode=${access.mode}${access.unlimited ? " (unlimited)" : ""}`
    );
  }
  console.log(`\n${orgs.length} org(s). Nothing was written.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
