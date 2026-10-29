/**
 * Seed Risk Alerts screenshot data into Postgres (all orgs by default).
 *
 *   npm run db:seed:risk-alerts
 *   SEED_ORG_SLUG=demo-clinic npm run db:seed:risk-alerts
 */
import "dotenv/config";
import {
  PrismaClient,
  RiskLevel,
  type Organization,
} from "@prisma/client";

const prisma = new PrismaClient();
const ORG_SLUG = process.env.SEED_ORG_SLUG?.trim() || "";

type SeedAlert = {
  shortName: string;
  emailLocal: string;
  type: "crisis_keywords" | "low_mood" | "high_stress";
  severity: RiskLevel;
  description: string;
  mood: number;
  stress: number;
  source: "check_in" | "journal" | "assessment";
  reviewed: boolean;
  hoursAgo: number;
  reviewNote?: string;
};

const SEED: SeedAlert[] = [
  {
    shortName: "Marcus T.",
    emailLocal: "marcus.t.risk",
    type: "crisis_keywords",
    severity: "HIGH",
    description: "Crisis keyword detected",
    mood: 2,
    stress: 9,
    source: "journal",
    reviewed: false,
    hoursAgo: 2,
  },
  {
    shortName: "Janelle W.",
    emailLocal: "janelle.w.risk",
    type: "low_mood",
    severity: "MEDIUM",
    description: "Low mood 3+ days",
    mood: 4,
    stress: 7,
    source: "check_in",
    reviewed: false,
    hoursAgo: 5,
  },
  {
    shortName: "David K.",
    emailLocal: "david.k.risk",
    type: "high_stress",
    severity: "MEDIUM",
    description: "High stress (9/10)",
    mood: 5,
    stress: 9,
    source: "check_in",
    reviewed: false,
    hoursAgo: 26,
  },
  {
    shortName: "Aisha P.",
    emailLocal: "aisha.p.risk",
    type: "low_mood",
    severity: "LOW",
    description: "Mood dropped from 7 to 4 over the past week",
    mood: 4,
    stress: 5,
    source: "check_in",
    reviewed: true,
    hoursAgo: 48,
    reviewNote: "Checked in with client; mood improving, continue monitoring.",
  },
  {
    shortName: "Robert S.",
    emailLocal: "robert.s.risk",
    type: "high_stress",
    severity: "LOW",
    description: "Stress consistently at 7+ this week",
    mood: 6,
    stress: 7,
    source: "assessment",
    reviewed: true,
    hoursAgo: 72,
    reviewNote: "Coping skills reviewed; follow-up scheduled.",
  },
];

function hoursAgo(h: number) {
  return new Date(Date.now() - h * 60 * 60 * 1000);
}

async function resolveOrgs(): Promise<Organization[]> {
  if (ORG_SLUG) {
    const one = await prisma.organization.findFirst({ where: { slug: ORG_SLUG } });
    if (!one) throw new Error(`Organization not found: ${ORG_SLUG}`);
    return [one];
  }
  return prisma.organization.findMany({ orderBy: { createdAt: "asc" } });
}

async function ensureLocation(orgId: string) {
  let loc = await prisma.location.findFirst({
    where: { organizationId: orgId, active: true },
    orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
  });
  if (!loc) {
    loc = await prisma.location.create({
      data: {
        organizationId: orgId,
        name: "Main Clinic",
        code: "MAIN",
        isPrimary: true,
        active: true,
      },
    });
  }
  return loc;
}

async function seedOrg(org: Organization) {
  console.log(`\nSeeding risk alerts for: ${org.name} (${org.slug})`);
  const location = await ensureLocation(org.id);
  const clinician = await prisma.user.findFirst({
    where: {
      organizationId: org.id,
      status: "ACTIVE",
      role: { in: ["THERAPIST", "CLINICIAN", "DIRECTOR", "ADMIN"] },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  // Prefer therapist for caseload visibility
  const therapist = await prisma.user.findFirst({
    where: {
      organizationId: org.id,
      status: "ACTIVE",
      role: { in: ["THERAPIST", "CLINICIAN"] },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  const assigneeId = therapist?.id || clinician?.id || null;

  // Clean slate for demo KPIs (Unreviewed=3, High=1, Total=5)
  await prisma.riskAlert.deleteMany({
    where: {
      OR: [
        { organizationId: org.id },
        { client: { location: { organizationId: org.id } } },
        { client: { assignedTo: { organizationId: org.id } } },
      ],
    },
  });

  for (const row of SEED) {
    const email = `${row.emailLocal}+${org.slug}@seed.altrixs.local`.toLowerCase();
    let client = await prisma.client.findFirst({ where: { email } });
    if (!client) {
      client = await prisma.client.create({
        data: {
          name: row.shortName,
          email,
          locationId: location.id,
          assignedToId: assigneeId,
          status: "ACTIVE",
          active: true,
          riskLevel: row.severity,
        },
      });
    } else {
      client = await prisma.client.update({
        where: { id: client.id },
        data: {
          name: row.shortName,
          locationId: client.locationId || location.id,
          assignedToId: assigneeId || client.assignedToId,
          riskLevel: row.severity,
          status: "ACTIVE",
          active: true,
        },
      });
    }

    await prisma.riskAlert.create({
      data: {
        organizationId: org.id,
        clientId: client.id,
        clientName: row.shortName,
        clinicianId: assigneeId,
        type: row.type,
        severity: row.severity,
        description: row.description,
        mood: row.mood,
        stress: row.stress,
        source: row.source,
        reviewed: row.reviewed,
        reviewNote: row.reviewNote ?? null,
        reviewedAt: row.reviewed ? hoursAgo(Math.max(0, row.hoursAgo - 2)) : null,
        reviewedById: row.reviewed ? clinician?.id || null : null,
        createdAt: hoursAgo(row.hoursAgo),
      },
    });
    console.log(
      `  ${row.shortName} [${row.severity}/${row.type}] reviewed=${row.reviewed}`
    );
  }
}

async function main() {
  const orgs = await resolveOrgs();
  if (!orgs.length) throw new Error("No organization found");
  for (const org of orgs) {
    await seedOrg(org);
  }
  console.log(`\nDone. Seeded ${SEED.length} alerts × ${orgs.length} org(s).`);
  console.log("Expected KPIs per org: Unreviewed=3, High=1, Total=5");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
