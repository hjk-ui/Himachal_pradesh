/**
 * Seed ClinicModuleState `incidents` for Incident Reporting.
 *
 *   npm run db:seed:incidents
 */
import "dotenv/config";
import { PrismaClient, type Prisma } from "@prisma/client";
import { INCIDENTS_SEED } from "../src/features/compliance/incidentsData";

const prisma = new PrismaClient();

async function main() {
  const slug = process.env.SEED_ORG_SLUG?.trim();
  const orgs = slug
    ? await prisma.organization.findMany({ where: { slug } })
    : await prisma.organization.findMany({ orderBy: { slug: "asc" } });
  if (!orgs.length) throw new Error("No organizations found");

  for (const org of orgs) {
    await prisma.clinicModuleState.upsert({
      where: { organizationId_module: { organizationId: org.id, module: "incidents" } },
      create: {
        organizationId: org.id,
        module: "incidents",
        data: INCIDENTS_SEED as unknown as Prisma.InputJsonValue,
      },
      update: { data: INCIDENTS_SEED as unknown as Prisma.InputJsonValue },
    });
    const open = INCIDENTS_SEED.filter((i) => i.status !== "closed").length;
    console.log(`✓ ${org.slug} — ${INCIDENTS_SEED.length} incidents (${open} open)`);
  }
  console.log(`\nDone — ${orgs.length} org(s). Open /dashboard/incidents`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
