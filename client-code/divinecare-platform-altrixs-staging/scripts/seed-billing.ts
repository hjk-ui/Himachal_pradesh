/**
 * Seed billing hub: Claim rows (Prisma) + invoices ClinicModuleState.
 *
 *   npm run db:seed:billing
 */
import "dotenv/config";
import { PrismaClient, type ClaimStatus, type Prisma } from "@prisma/client";
import { cptRateCents } from "../src/features/billing/billingHubData";
import { BILLING_INVOICES_SEED } from "../src/features/billing/billingSeeds";
import { seedDenialsForOrg } from "./denial-seed-rows";

const prisma = new PrismaClient();

type SeedClaim = {
  cptCode: string;
  units: number;
  payer: string;
  status: ClaimStatus;
  daysAgo: number;
  denialReason?: string;
};

const CLAIM_SEEDS: SeedClaim[] = [
  { cptCode: "90837", units: 1, payer: "Medicaid", status: "DRAFT", daysAgo: 1 },
  { cptCode: "90834", units: 1, payer: "Medicare", status: "READY", daysAgo: 2 },
  { cptCode: "90837", units: 1, payer: "BCBS", status: "SUBMITTED", daysAgo: 3 },
  { cptCode: "99213", units: 1, payer: "Medicaid", status: "SUBMITTED", daysAgo: 2 },
  { cptCode: "H2017", units: 4, payer: "Medicaid", status: "ACCEPTED", daysAgo: 8 },
  { cptCode: "90847", units: 1, payer: "BCBS", status: "PAID", daysAgo: 12 },
  { cptCode: "90791", units: 1, payer: "Medicare", status: "ACCEPTED", daysAgo: 10 },
  { cptCode: "90837", units: 1, payer: "Medicaid", status: "PAID", daysAgo: 15 },
  {
    cptCode: "90834",
    units: 1,
    payer: "Aetna",
    status: "DENIED",
    daysAgo: 4,
    denialReason: "CO-50 Medical necessity not documented",
  },
];

async function upsertModule(orgId: string, module: string, data: unknown) {
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
    await upsertModule(org.id, "invoices", BILLING_INVOICES_SEED);

    const clients = await prisma.client.findMany({
      where: {
        OR: [{ location: { organizationId: org.id } }, { assignedTo: { organizationId: org.id } }],
      },
      take: 12,
      orderBy: { createdAt: "asc" },
    });

    if (!clients.length) {
      console.log(`⚠ ${org.slug} — no clients; invoices seeded only`);
      continue;
    }

    // Seed claims are note/appt-free; keep denial-hub rows (clmdenhub-*)
    await prisma.claim.deleteMany({
      where: {
        organizationId: org.id,
        progressNoteId: null,
        appointmentId: null,
        NOT: { id: { startsWith: "clmdenhub-" } },
      },
    });

    let created = 0;
    for (let i = 0; i < CLAIM_SEEDS.length; i++) {
      const seed = CLAIM_SEEDS[i];
      const client = clients[i % clients.length];
      const createdAt = new Date();
      createdAt.setDate(createdAt.getDate() - seed.daysAgo);

      await prisma.claim.create({
        data: {
          organizationId: org.id,
          clientId: client.id,
          cptCode: seed.cptCode,
          units: seed.units,
          amountCents: cptRateCents(seed.cptCode) * seed.units,
          payer: seed.payer,
          status: seed.status,
          denialReason: seed.denialReason ?? null,
          createdAt,
          updatedAt: createdAt,
        },
      });
      created += 1;
    }
    const denials = await seedDenialsForOrg(prisma, org, clients);
    console.log(
      `✓ ${org.slug} — ${created} hub claims, ${denials} denials, ${BILLING_INVOICES_SEED.length} invoices`
    );
  }

  console.log(`\nDone — ${orgs.length} org(s). Open /dashboard/billing`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
