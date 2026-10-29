/**
 * Seed only ClinicModuleState `ehr-safety-plans` (Stanley-Brown demo).
 *
 *   npm run db:seed:safety-plans
 */
import "dotenv/config";
import { PrismaClient, type Prisma } from "@prisma/client";
import { SAFETY_PLAN_SEED } from "../src/features/ehr/safetyPlansData";

const prisma = new PrismaClient();

async function main() {
  const slug = process.env.SEED_ORG_SLUG?.trim();
  const orgs = slug
    ? await prisma.organization.findMany({ where: { slug } })
    : await prisma.organization.findMany({ orderBy: { slug: "asc" } });
  if (!orgs.length) throw new Error("No organizations found");

  for (const org of orgs) {
    await prisma.clinicModuleState.upsert({
      where: {
        organizationId_module: {
          organizationId: org.id,
          module: "ehr-safety-plans",
        },
      },
      create: {
        organizationId: org.id,
        module: "ehr-safety-plans",
        data: SAFETY_PLAN_SEED as unknown as Prisma.InputJsonValue,
      },
      update: {
        data: SAFETY_PLAN_SEED as unknown as Prisma.InputJsonValue,
      },
    });
    console.log(`✓ ${org.slug} — ${SAFETY_PLAN_SEED.length} safety plans`);
  }
  console.log(`\nDone — ${orgs.length} org(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
