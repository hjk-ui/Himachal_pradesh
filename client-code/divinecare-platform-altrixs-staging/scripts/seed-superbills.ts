/**
 * Seed ClinicModuleState `superbills`.
 *
 *   npm run db:seed:superbills
 */
import "dotenv/config";
import { PrismaClient, type Prisma } from "@prisma/client";
import { SUPERBILL_SEED } from "../src/features/billing/billingSeeds";

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
    await upsert(org.id, "superbills", SUPERBILL_SEED);
    console.log(`✓ ${org.slug} — ${SUPERBILL_SEED.length} superbills`);
  }
  console.log(`\nDone — ${orgs.length} org(s). Open /dashboard/billing/superbills`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
