/**
 * Seed ClinicModuleState `compliance-calendar` + `compliance-meta`.
 *
 *   npm run db:seed:compliance
 */
import "dotenv/config";
import { PrismaClient, type Prisma } from "@prisma/client";
import {
  COMPLIANCE_CALENDAR_SEED,
  COMPLIANCE_META_SEED,
} from "../src/features/compliance/complianceCalendarData";

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
    await upsert(org.id, "compliance-calendar", COMPLIANCE_CALENDAR_SEED);
    await upsert(org.id, "compliance-meta", [COMPLIANCE_META_SEED]);
    const open = COMPLIANCE_CALENDAR_SEED.filter((i) => i.status !== "completed").length;
    const overdue = COMPLIANCE_CALENDAR_SEED.filter((i) => i.status === "overdue").length;
    console.log(
      `✓ ${org.slug} — ${COMPLIANCE_CALENDAR_SEED.length} items (${open} open, ${overdue} overdue)`
    );
  }
  console.log(`\nDone — ${orgs.length} org(s). Open /dashboard/compliance`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
