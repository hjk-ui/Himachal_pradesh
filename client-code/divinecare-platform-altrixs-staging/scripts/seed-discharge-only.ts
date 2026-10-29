/**
 * Seed only ClinicModuleState `ehr-discharge-cases`.
 *
 *   npm run db:seed:discharge
 */
import "dotenv/config";
import { PrismaClient, type Prisma } from "@prisma/client";
import { DISCHARGE_CASES_SEED } from "../src/features/ehr/dischargeData";

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
          module: "ehr-discharge-cases",
        },
      },
      create: {
        organizationId: org.id,
        module: "ehr-discharge-cases",
        data: DISCHARGE_CASES_SEED as unknown as Prisma.InputJsonValue,
      },
      update: {
        data: DISCHARGE_CASES_SEED as unknown as Prisma.InputJsonValue,
      },
    });
    console.log(`✓ ${org.slug} — ${DISCHARGE_CASES_SEED.length} discharge cases`);
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
