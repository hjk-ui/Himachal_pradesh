/**
 * Seed Quality Improvement ClinicModuleState modules.
 *
 *   npm run db:seed:qi
 */
import "dotenv/config";
import { PrismaClient, type Prisma } from "@prisma/client";
import {
  QI_CAPS_SEED,
  QI_INDICATORS_SEED,
  QI_MEETINGS_SEED,
  QI_META_SEED,
} from "../src/features/analytics/qiData";

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
    await upsert(org.id, "qi-indicators", QI_INDICATORS_SEED);
    await upsert(org.id, "qi-caps", QI_CAPS_SEED);
    await upsert(org.id, "qi-meetings", QI_MEETINGS_SEED);
    await upsert(org.id, "qi-meta", [QI_META_SEED]);
    console.log(
      `✓ ${org.slug} — ${QI_INDICATORS_SEED.length} indicators, ${QI_CAPS_SEED.filter((c) => c.status !== "Completed").length} open CAPs, ${QI_MEETINGS_SEED.length} meetings`
    );
  }
  console.log(`\nDone — ${orgs.length} org(s). Open /dashboard/qi`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
