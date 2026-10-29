/**
 * Seed ClinicModuleState `doc-productivity`.
 *
 *   npm run db:seed:doc-productivity
 */
import "dotenv/config";
import { PrismaClient, type Prisma } from "@prisma/client";
import { DOC_PRODUCTIVITY_SEED } from "../src/features/analytics/docProductivityData";

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
          module: "doc-productivity",
        },
      },
      create: {
        organizationId: org.id,
        module: "doc-productivity",
        data: DOC_PRODUCTIVITY_SEED as unknown as Prisma.InputJsonValue,
      },
      update: {
        data: DOC_PRODUCTIVITY_SEED as unknown as Prisma.InputJsonValue,
      },
    });
    console.log(
      `✓ ${org.slug} — ${DOC_PRODUCTIVITY_SEED.clinicians.length} clinicians`
    );
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
