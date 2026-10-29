import type { ClaimDenialStatus, PrismaClient } from "@prisma/client";

type DenialManagementSeed = {
  key: string;
  cptCode: string;
  units: number;
  amountCents: number;
  payer: string;
  status: ClaimDenialStatus;
  reasonCode: string;
  reasonText: string;
  daysAgo: number;
};

/**
 * Five denials for /dashboard/billing/denials analytics.
 * Counts: 5 denials, Medicaid 3 / Medicare 1 / BCBS 1, one of each category.
 * Dollars: Open + In Appeal $360, Recovered $220.
 * Workflow: 1 OPEN, 1 APPEALED, 1 WON, 2 LOST → 5 denials, appeal win rate 50% (1 of 2 filed).
 */
const DENIAL_MANAGEMENT_SEEDS: DenialManagementSeed[] = [
  {
    key: "auth",
    cptCode: "90837",
    units: 1,
    amountCents: 18000,
    payer: "Medicaid",
    status: "OPEN",
    reasonCode: "CO-15",
    reasonText: "Prior authorization not on file for this date of service.",
    daysAgo: 6,
  },
  {
    key: "mednec",
    cptCode: "90837",
    units: 1,
    amountCents: 18000,
    payer: "Medicaid",
    status: "APPEALED",
    reasonCode: "CO-50",
    reasonText: "Medical necessity not documented for 60-minute psychotherapy.",
    daysAgo: 11,
  },
  {
    key: "missing",
    cptCode: "90837",
    units: 1,
    amountCents: 32000,
    payer: "Medicaid",
    status: "LOST",
    reasonCode: "CO-16",
    reasonText: "Claim lacks required attachments / incomplete documentation.",
    daysAgo: 8,
  },
  {
    key: "elig",
    cptCode: "90837",
    units: 1,
    amountCents: 22000,
    payer: "Medicare",
    status: "WON",
    reasonCode: "CO-27",
    reasonText: "Eligibility / coverage terminated on date of service. Appeal recovered payment.",
    daysAgo: 18,
  },
  {
    key: "timely",
    cptCode: "90847",
    units: 1,
    amountCents: 16000,
    payer: "BCBS",
    status: "LOST",
    reasonCode: "CO-29",
    reasonText: "The time limit for filing has expired.",
    daysAgo: 4,
  },
];

function denhubClaimId(orgId: string, key: string) {
  return `clmdenhub-${orgId}-${key}`;
}

function denhubDenialId(orgId: string, key: string) {
  return `cdn-hub-${orgId}-${key}`;
}

export async function seedDenialsForOrg(
  prisma: PrismaClient,
  org: { id: string; slug: string },
  clients: Array<{ id: string }>
) {
  if (!clients.length) {
    console.log(`⚠ ${org.slug} — no clients; skipped denials`);
    return 0;
  }

  const claimIds = DENIAL_MANAGEMENT_SEEDS.map((seed) => denhubClaimId(org.id, seed.key));
  await prisma.claim.deleteMany({
    where: { organizationId: org.id, id: { in: claimIds } },
  });

  for (let i = 0; i < DENIAL_MANAGEMENT_SEEDS.length; i++) {
    const seed = DENIAL_MANAGEMENT_SEEDS[i];
    const client = clients[i % clients.length];
    const createdAt = new Date();
    createdAt.setDate(createdAt.getDate() - seed.daysAgo);
    const claimId = denhubClaimId(org.id, seed.key);
    const denialId = denhubDenialId(org.id, seed.key);

    await prisma.claim.create({
      data: {
        id: claimId,
        organizationId: org.id,
        clientId: client.id,
        cptCode: seed.cptCode,
        units: seed.units,
        amountCents: seed.amountCents,
        payer: seed.payer,
        status: "DENIED",
        denialReason: seed.reasonText,
        createdAt,
        updatedAt: createdAt,
        denials: {
          create: {
            id: denialId,
            organizationId: org.id,
            reasonCode: seed.reasonCode,
            reasonText: seed.reasonText,
            status: seed.status,
            createdAt,
            updatedAt: createdAt,
          },
        },
      },
    });
  }

  return DENIAL_MANAGEMENT_SEEDS.length;
}
