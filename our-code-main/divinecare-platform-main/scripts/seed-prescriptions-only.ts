import "dotenv/config";
import { PrismaClient, type Prisma } from "@prisma/client";
import {
  PRESCRIPTIONS_SEED,
  REFILL_REQUESTS_SEED,
} from "../src/features/ehr/prescriptionSeedData";

const prisma = new PrismaClient();

async function upsert(orgId: string, module: string, data: unknown) {
  await prisma.clinicModuleState.upsert({
    where: { organizationId_module: { organizationId: orgId, module } },
    create: {
      organizationId: orgId,
      module,
      data: data as unknown as Prisma.InputJsonValue,
    },
    update: { data: data as unknown as Prisma.InputJsonValue },
  });
}

async function main() {
  const orgs = await prisma.organization.findMany({ orderBy: { slug: "asc" } });
  for (const org of orgs) {
    await upsert(org.id, "prescriptions", PRESCRIPTIONS_SEED);
    await upsert(org.id, "prescription-refills", REFILL_REQUESTS_SEED);
    console.log(
      `✓ ${org.slug} — prescriptions ${PRESCRIPTIONS_SEED.length}, refills ${REFILL_REQUESTS_SEED.length}`
    );
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
