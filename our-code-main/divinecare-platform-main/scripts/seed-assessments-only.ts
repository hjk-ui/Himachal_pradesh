import "dotenv/config";
import { PrismaClient, type Prisma } from "@prisma/client";
import { ASSESSMENTS_SEED } from "../src/features/ehr/assessments/catalog";

const prisma = new PrismaClient();

async function main() {
  const orgs = await prisma.organization.findMany({ orderBy: { slug: "asc" } });
  for (const org of orgs) {
    await prisma.clinicModuleState.upsert({
      where: {
        organizationId_module: { organizationId: org.id, module: "assessments" },
      },
      create: {
        organizationId: org.id,
        module: "assessments",
        data: ASSESSMENTS_SEED as unknown as Prisma.InputJsonValue,
      },
      update: { data: ASSESSMENTS_SEED as unknown as Prisma.InputJsonValue },
    });
    console.log(`✓ assessments → ${org.slug} (${ASSESSMENTS_SEED.length} clients)`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
