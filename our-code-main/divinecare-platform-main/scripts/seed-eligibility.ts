/**
 * Seed EligibilityCheck + PriorAuth rows (screenshot demo) for every org.
 * Idempotent via rawRequest / notes seed markers.
 *
 *   npm run db:seed:eligibility
 */
import "dotenv/config";
import {
  PrismaClient,
  EligibilityCheckStatus,
  PriorAuthStatus,
  ClientStatus,
  RiskLevel,
  type Prisma,
} from "@prisma/client";

const prisma = new PrismaClient();

type Benefits = {
  deductible: number;
  deductibleMet: number;
  copay: number;
  oopMax: number;
  oopMet: number;
  coveredServices: string[];
};

type EligSpec = {
  key: string;
  clientName: string;
  emailLocal: string;
  payerName: string;
  memberId: string;
  groupNum?: string;
  status: EligibilityCheckStatus;
  /** YYYY-MM-DD — use "today" for current day */
  checkedAt: string;
  benefits: Benefits;
};

type AuthSpec = {
  key: string;
  clientName: string;
  emailLocal: string;
  payer: string;
  authNumber: string | null;
  cptCodes: string[];
  unitsApproved: number;
  unitsUsed: number;
  status: PriorAuthStatus;
  startDate: string;
  endDate: string;
  notes: string;
};

function day(iso: string) {
  if (iso === "today") {
    const d = new Date();
    return new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0)
    );
  }
  return new Date(`${iso}T12:00:00.000Z`);
}

const BH_SERVICES = [
  "90834 Psychotherapy",
  "90837 Psychotherapy 60min",
  "90791 Psychiatric Diagnostic",
];

const ELIG_SPECS: EligSpec[] = [
  {
    key: "elig-maria-beacon",
    clientName: "Maria Santos",
    emailLocal: "maria.santos",
    payerName: "Beacon Health Options",
    memberId: "BH0123456",
    groupNum: "GRP-4401",
    status: "ELIGIBLE",
    checkedAt: "2026-03-07",
    benefits: {
      deductible: 1500,
      deductibleMet: 1200,
      copay: 20,
      oopMax: 5000,
      oopMet: 2800,
      coveredServices: BH_SERVICES,
    },
  },
  {
    key: "elig-james-medicaid",
    clientName: "James Wilson",
    emailLocal: "james.wilson",
    payerName: "Medicaid (MD)",
    memberId: "MD-987654321",
    status: "ELIGIBLE",
    checkedAt: "2026-03-06",
    benefits: {
      deductible: 0,
      deductibleMet: 0,
      copay: 0,
      oopMax: 0,
      oopMet: 0,
      coveredServices: ["90834 Psychotherapy", "H0031 Mental Health Assessment"],
    },
  },
  {
    key: "elig-aisha-bcbs",
    clientName: "Aisha Johnson",
    emailLocal: "aisha.johnson",
    payerName: "BCBS Maryland",
    memberId: "BCBS-445566",
    groupNum: "BCBS-MD-12",
    status: "ELIGIBLE",
    checkedAt: "2026-03-05",
    benefits: {
      deductible: 2000,
      deductibleMet: 2000,
      copay: 30,
      oopMax: 6000,
      oopMet: 3200,
      coveredServices: BH_SERVICES,
    },
  },
  {
    key: "elig-carlos-medicaid",
    clientName: "Carlos Rivera",
    emailLocal: "carlos.rivera",
    payerName: "Medicaid (MD)",
    memberId: "MD-112233445",
    status: "ELIGIBLE",
    checkedAt: "2026-03-07",
    benefits: {
      deductible: 0,
      deductibleMet: 0,
      copay: 0,
      oopMax: 0,
      oopMet: 0,
      coveredServices: ["90834 Psychotherapy", "90853 Group Therapy"],
    },
  },
  {
    key: "elig-tamika-aetna",
    clientName: "Tamika Brown",
    emailLocal: "tamika.brown",
    payerName: "Aetna Behavioral Health",
    memberId: "AET-778899",
    groupNum: "AET-BH-88",
    status: "PENDING",
    checkedAt: "2026-03-07",
    benefits: {
      deductible: 1000,
      deductibleMet: 0,
      copay: 25,
      oopMax: 4000,
      oopMet: 150,
      coveredServices: [],
    },
  },
  {
    key: "elig-derek-cigna",
    clientName: "Derek Foster",
    emailLocal: "derek.foster",
    payerName: "Cigna",
    memberId: "CIG-554433",
    status: "ELIGIBLE",
    checkedAt: "today",
    benefits: {
      deductible: 1000,
      deductibleMet: 400,
      copay: 40,
      oopMax: 4500,
      oopMet: 900,
      coveredServices: BH_SERVICES,
    },
  },
  {
    key: "elig-lydia-united",
    clientName: "Lydia Chen",
    emailLocal: "lydia.chen",
    payerName: "UnitedHealth",
    memberId: "UHC-991122",
    status: "ELIGIBLE",
    checkedAt: "today",
    benefits: {
      deductible: 500,
      deductibleMet: 500,
      copay: 15,
      oopMax: 3500,
      oopMet: 1100,
      coveredServices: BH_SERVICES,
    },
  },
  {
    key: "elig-marcus-magellan",
    clientName: "Marcus Webb",
    emailLocal: "marcus.webb",
    payerName: "Magellan Health",
    memberId: "MAG-334455",
    status: "PENDING",
    checkedAt: "today",
    benefits: {
      deductible: 750,
      deductibleMet: 100,
      copay: 35,
      oopMax: 5000,
      oopMet: 200,
      coveredServices: [],
    },
  },
  {
    key: "elig-nina-medicare",
    clientName: "Nina Patel",
    emailLocal: "nina.patel",
    payerName: "Medicare Part B",
    memberId: "MED-B-7788",
    status: "ERROR",
    checkedAt: "today",
    benefits: {
      deductible: 0,
      deductibleMet: 0,
      copay: 0,
      oopMax: 0,
      oopMet: 0,
      coveredServices: [],
    },
  },
  {
    key: "elig-owen-beacon-fail",
    clientName: "Owen Brooks",
    emailLocal: "owen.brooks",
    payerName: "Beacon Health Options",
    memberId: "BH-INVALID",
    status: "ERROR",
    checkedAt: "2026-03-04",
    benefits: {
      deductible: 0,
      deductibleMet: 0,
      copay: 0,
      oopMax: 0,
      oopMet: 0,
      coveredServices: [],
    },
  },
];

const AUTH_SPECS: AuthSpec[] = [
  {
    key: "pa-maria-90837",
    clientName: "Maria Santos",
    emailLocal: "maria.santos",
    payer: "Beacon Health Options",
    authNumber: "AUTH-BH-2026-0142",
    cptCodes: ["90837"],
    unitsApproved: 24,
    unitsUsed: 8,
    status: "APPROVED",
    startDate: "2026-01-01",
    endDate: "2026-06-30",
    notes: "Individual psychotherapy 60 min",
  },
  {
    key: "pa-james-h0031",
    clientName: "James Wilson",
    emailLocal: "james.wilson",
    payer: "Medicaid (MD)",
    authNumber: "MD-PA-88901",
    cptCodes: ["H0031", "90834"],
    unitsApproved: 12,
    unitsUsed: 4,
    status: "APPROVED",
    startDate: "2026-02-01",
    endDate: "2026-08-01",
    notes: "Mental health assessment + therapy",
  },
  {
    key: "pa-tamika-90834",
    clientName: "Tamika Brown",
    emailLocal: "tamika.brown",
    payer: "Aetna Behavioral Health",
    authNumber: null,
    cptCodes: ["90834"],
    unitsApproved: 16,
    unitsUsed: 0,
    status: "SUBMITTED",
    startDate: "2026-03-01",
    endDate: "2026-09-01",
    notes: "Pending payer review",
  },
  {
    key: "pa-aisha-denied",
    clientName: "Aisha Johnson",
    emailLocal: "aisha.johnson",
    payer: "BCBS Maryland",
    authNumber: "BCBS-DEN-441",
    cptCodes: ["90853"],
    unitsApproved: 0,
    unitsUsed: 0,
    status: "DENIED",
    startDate: "2026-02-15",
    endDate: "2026-02-15",
    notes: "Group therapy — medical necessity not met",
  },
  {
    key: "pa-marcus-prp",
    clientName: "Marcus Johnson",
    emailLocal: "marcus.johnson",
    payer: "Medicaid (MD)",
    authNumber: "MD-2026-88421",
    cptCodes: ["H2017"],
    unitsApproved: 120,
    unitsUsed: 108,
    status: "APPROVED",
    startDate: "2026-01-01",
    endDate: "2026-09-03",
    notes: "PRP Services",
  },
  {
    key: "pa-destiny-therapy",
    clientName: "Destiny Williams",
    emailLocal: "destiny.williams",
    payer: "BCBS Maryland",
    authNumber: "BCBS-PA-55210",
    cptCodes: ["90837"],
    unitsApproved: 24,
    unitsUsed: 18,
    status: "APPROVED",
    startDate: "2026-02-01",
    endDate: "2026-10-15",
    notes: "Individual Therapy",
  },
];

async function ensureClient(
  orgId: string,
  locationId: string | null,
  assigneeId: string | null,
  name: string,
  emailLocal: string,
  insurance?: { payer: string; memberId: string; groupNum?: string }
) {
  const email = `${emailLocal}.${orgId.slice(0, 8)}.elig@altrixs.demo`;
  const existing = await prisma.client.findFirst({
    where: {
      OR: [
        { email },
        { name, location: { organizationId: orgId } },
        { name, assignedTo: { organizationId: orgId } },
      ],
    },
  });
  const insuranceData = insurance
    ? {
        insurancePayer: insurance.payer,
        insuranceMemberId: insurance.memberId,
        insuranceGroupNumber: insurance.groupNum ?? null,
      }
    : {};

  if (existing) {
    return prisma.client.update({
      where: { id: existing.id },
      data: {
        name,
        status: ClientStatus.ACTIVE,
        active: true,
        locationId: locationId ?? existing.locationId,
        assignedToId: assigneeId ?? existing.assignedToId,
        ...insuranceData,
      },
    });
  }
  return prisma.client.create({
    data: {
      name,
      email,
      phone: "(301) 555-0155",
      status: ClientStatus.ACTIVE,
      active: true,
      riskLevel: RiskLevel.LOW,
      locationId,
      assignedToId: assigneeId,
      state: "MD",
      ...insuranceData,
    },
  });
}

async function upsertEligibility(
  orgId: string,
  clientId: string,
  checkedById: string | null,
  spec: EligSpec
) {
  const marker = `seed:${spec.key}`;
  const existing = await prisma.eligibilityCheck.findFirst({
    where: {
      organizationId: orgId,
      clientId,
      rawRequest: { path: ["seedKey"], equals: marker },
    },
  });

  const checkedAt = day(spec.checkedAt);
  const data = {
    organizationId: orgId,
    clientId,
    payerName: spec.payerName,
    memberId: spec.memberId,
    dos: checkedAt,
    status: spec.status,
    checkedAt,
    checkedById,
    rawRequest: {
      seedKey: marker,
      transaction: "coverages",
      mode: "seed",
      groupNum: spec.groupNum ?? null,
    } as Prisma.InputJsonValue,
    rawResponse: {
      benefits: spec.benefits,
      ...(spec.status === "ERROR"
        ? { error: "Payer connectivity timeout (seed demo)" }
        : {}),
    } as Prisma.InputJsonValue,
  };

  if (existing) {
    await prisma.eligibilityCheck.update({ where: { id: existing.id }, data });
  } else {
    await prisma.eligibilityCheck.create({ data });
  }
}

async function upsertPriorAuth(
  orgId: string,
  clientId: string,
  createdById: string | null,
  spec: AuthSpec
) {
  const marker = `seed:${spec.key}`;
  const existing = await prisma.priorAuth.findFirst({
    where: {
      organizationId: orgId,
      clientId,
      notes: { contains: marker },
    },
  });

  const data = {
    organizationId: orgId,
    clientId,
    payer: spec.payer,
    authNumber: spec.authNumber,
    cptCodes: spec.cptCodes,
    unitsApproved: spec.unitsApproved,
    unitsUsed: spec.unitsUsed,
    status: spec.status,
    startDate: day(spec.startDate),
    endDate: day(spec.endDate),
    notes: `${spec.notes} [${marker}]`,
    createdById,
  };

  if (existing) {
    await prisma.priorAuth.update({ where: { id: existing.id }, data });
  } else {
    await prisma.priorAuth.create({ data });
  }
}

async function seedOrg(org: { id: string; name: string; slug: string }) {
  console.log(`\n→ ${org.name} (${org.slug})`);
  const location = await prisma.location.findFirst({
    where: { organizationId: org.id },
    orderBy: { createdAt: "asc" },
  });
  const staff = await prisma.user.findFirst({
    where: { organizationId: org.id, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
  });

  const clientCache = new Map<string, string>();

  async function clientIdFor(
    name: string,
    emailLocal: string,
    insurance?: { payer: string; memberId: string; groupNum?: string }
  ) {
    const cacheKey = `${name}|${emailLocal}`;
    const hit = clientCache.get(cacheKey);
    if (hit) return hit;
    const client = await ensureClient(
      org.id,
      location?.id ?? null,
      staff?.id ?? null,
      name,
      emailLocal,
      insurance
    );
    clientCache.set(cacheKey, client.id);
    return client.id;
  }

  let eligN = 0;
  for (const spec of ELIG_SPECS) {
    const clientId = await clientIdFor(spec.clientName, spec.emailLocal, {
      payer: spec.payerName,
      memberId: spec.memberId,
      groupNum: spec.groupNum,
    });
    await upsertEligibility(org.id, clientId, staff?.id ?? null, spec);
    eligN += 1;
  }

  let authN = 0;
  for (const spec of AUTH_SPECS) {
    const clientId = await clientIdFor(spec.clientName, spec.emailLocal);
    await upsertPriorAuth(org.id, clientId, staff?.id ?? null, spec);
    authN += 1;
  }

  console.log(`  ✓ ${eligN} eligibility checks, ${authN} prior auths`);
}

async function main() {
  const slug = process.env.SEED_ORG_SLUG?.trim();
  const orgs = slug
    ? await prisma.organization.findMany({ where: { slug } })
    : await prisma.organization.findMany({ orderBy: { slug: "asc" } });
  if (!orgs.length) throw new Error("No organizations found");
  for (const org of orgs) await seedOrg(org);
  console.log(`\nDone — eligibility seeded for ${orgs.length} org(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
