/**
 * Seed ClinicModuleState `grievances` + `grievances-meta`.
 *
 *   npm run db:seed:grievances
 */
import "dotenv/config";
import { PrismaClient, type Prisma } from "@prisma/client";
import {
  GRIEVANCES_META_SEED,
  GRIEVANCES_SEED,
} from "../src/features/compliance/grievancesData";

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
    await upsert(org.id, "grievances", GRIEVANCES_SEED);
    await upsert(org.id, "grievances-meta", [GRIEVANCES_META_SEED]);
    const open = GRIEVANCES_SEED.filter(
      (g) => !["resolved", "closed"].includes(g.status)
    ).length;
    console.log(
      `✓ ${org.slug} — ${GRIEVANCES_SEED.length} grievances (${open} active)`
    );
  }
  console.log(`\nDone — ${orgs.length} org(s). Open /dashboard/grievances`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
