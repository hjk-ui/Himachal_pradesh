/**
 * Seed Peer Support ClinicModuleState modules.
 *
 *   npm run db:seed:peer-support
 */
import "dotenv/config";
import { PrismaClient, type Prisma } from "@prisma/client";
import {
  PEER_CONTACTS_SEED,
  PEER_GOALS_SEED,
  PEER_META_SEED,
  PEER_PLACEMENTS_SEED,
} from "../src/features/compliance/peerSupportData";

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
    await upsert(org.id, "peer-contacts", PEER_CONTACTS_SEED);
    await upsert(org.id, "peer-goals", PEER_GOALS_SEED);
    await upsert(org.id, "peer-placements", PEER_PLACEMENTS_SEED);
    await upsert(org.id, "peer-meta", [PEER_META_SEED]);
    console.log(
      `✓ ${org.slug} — ${PEER_CONTACTS_SEED.length} contacts, ${PEER_GOALS_SEED.length} goals, ${PEER_PLACEMENTS_SEED.length} placements`
    );
  }
  console.log(`\nDone — ${orgs.length} org(s). Open /dashboard/peer-support`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
