/**
 * Seed PRP Program ClinicModuleState modules.
 *
 *   npm run db:seed:prp
 */
import "dotenv/config";
import { PrismaClient, type Prisma } from "@prisma/client";
import {
  PRP_DOMAINS_SEED,
  PRP_GROUPS_SEED,
  PRP_META_SEED,
  PRP_PARTICIPANTS_SEED,
  PRP_REPORTS_SEED,
} from "../src/features/programs/prpProgramData";

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
    await upsert(org.id, "prp-meta", [PRP_META_SEED]);
    await upsert(org.id, "prp-groups", PRP_GROUPS_SEED);
    await upsert(org.id, "prp-participants", PRP_PARTICIPANTS_SEED);
    await upsert(org.id, "prp-domains", PRP_DOMAINS_SEED);
    await upsert(org.id, "prp-reports", PRP_REPORTS_SEED);
    console.log(
      `✓ ${org.slug} — ${PRP_PARTICIPANTS_SEED.length} participants, ${PRP_GROUPS_SEED.length} sessions, ${PRP_DOMAINS_SEED.length} domains, ${PRP_REPORTS_SEED.length} reports`
    );
  }
  console.log(`\nDone — ${orgs.length} org(s). Open /dashboard/prp`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
