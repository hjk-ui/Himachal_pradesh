/**
 * Seed ClinicModuleState `population-health` (+ legacy client/action arrays).
 *
 *   npm run db:seed:population
 */
import "dotenv/config";
import { PrismaClient, type Prisma } from "@prisma/client";
import {
  POPULATION_ACTIONS_SEED,
  POPULATION_CLIENTS_SEED,
  POPULATION_HEALTH_SEED,
} from "../src/features/analytics/populationHealthData";

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
    await upsert(org.id, "population-health", POPULATION_HEALTH_SEED);
    await upsert(org.id, "population-clients", POPULATION_CLIENTS_SEED);
    await upsert(org.id, "population-actions", POPULATION_ACTIONS_SEED);
    console.log(
      `✓ ${org.slug} — ${POPULATION_HEALTH_SEED.clients.length} clients, ${POPULATION_HEALTH_SEED.actions.length} actions, ${POPULATION_HEALTH_SEED.clinicians.length} clinicians`
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
