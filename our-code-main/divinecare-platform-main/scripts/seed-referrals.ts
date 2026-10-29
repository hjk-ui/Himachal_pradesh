/**
 * Seed Referral Tracking demo rows so /dashboard/community/referrals reads the DB.
 *
 *   npm run db:seed:referrals
 *   SEED_ORG_SLUG=demo-clinic npm run db:seed:referrals
 *
 * Default: every organization. Idempotent per (org, patientName, referralDate).
 */
import "dotenv/config";
import {
  PrismaClient,
  type Organization,
  type ReferralDirection,
  type ReferralStatus,
} from "@prisma/client";

const prisma = new PrismaClient();
const ORG_SLUG = process.env.SEED_ORG_SLUG?.trim() || "";

type SeedRow = {
  patientName: string;
  direction: ReferralDirection;
  sourceType: string;
  sourceName: string;
  referralDate: string;
  status: ReferralStatus;
  convertDays?: number;
  notes: string;
};

/** Matches Referral Management screenshot roster + 2 outgoing / remaining incoming. */
const SEED: SeedRow[] = [
  {
    patientName: "Marcus Johnson",
    direction: "incoming",
    sourceType: "primary_care",
    sourceName: "Dr. Pamela Rhodes, MD",
    referralDate: "2026-01-08",
    status: "converted",
    convertDays: 12,
    notes: "PCP referral for depression and anxiety. Converted after intake and first therapy session.",
  },
  {
    patientName: "Destiny Williams",
    direction: "incoming",
    sourceType: "community_event",
    sourceName: "Spring Health Fair — Baltimore",
    referralDate: "2026-03-12",
    status: "converted",
    convertDays: 11,
    notes: "Screened at the spring health fair. Strong engagement; started PHP step-down to outpatient.",
  },
  {
    patientName: "Andre Mitchell",
    direction: "incoming",
    sourceType: "hospital",
    sourceName: "UMMC Inpatient Psych",
    referralDate: "2026-04-01",
    status: "converted",
    convertDays: 13,
    notes: "Hospital discharge after inpatient psych stay. Aftercare scheduled within two weeks.",
  },
  {
    patientName: "Keisha Brown",
    direction: "incoming",
    sourceType: "word_of_mouth",
    sourceName: "Current client referral",
    referralDate: "2026-04-15",
    status: "converted",
    convertDays: 12,
    notes: "Referred by a current client. Prefers evening telehealth.",
  },
  {
    patientName: "Tyrone Davis",
    direction: "incoming",
    sourceType: "court",
    sourceName: "Baltimore City District Court",
    referralDate: "2026-05-10",
    status: "converted",
    convertDays: 12,
    notes: "Court-ordered outpatient treatment. Compliance letters requested monthly.",
  },
  {
    patientName: "Brittany Simmons",
    direction: "incoming",
    sourceType: "social_media",
    sourceName: "Instagram @altrixs.care campaign",
    referralDate: "2026-06-15",
    status: "pending",
    notes: "Responded to a social ad for adult ADHD evaluation. Awaiting insurance card and intake packet.",
  },
  {
    patientName: "Jamal Harris",
    direction: "incoming",
    sourceType: "primary_care",
    sourceName: "Dr. Anita Cole, MD — Chase Brexton",
    referralDate: "2026-06-20",
    status: "accepted",
    notes: "PCP warm handoff for trauma-focused therapy. Assigned; first appointment not yet completed.",
  },
  {
    patientName: "Imani Brooks",
    direction: "incoming",
    sourceType: "court",
    sourceName: "Baltimore County Circuit Court",
    referralDate: "2026-06-25",
    status: "pending",
    notes: "New court-ordered referral. Need to confirm guardian contact and mandated session frequency.",
  },
  {
    patientName: "Lamar Washington",
    direction: "outgoing",
    sourceType: "hospital",
    sourceName: "Sheppard Pratt — IOP",
    referralDate: "2026-07-08",
    status: "converted",
    convertDays: 12,
    notes: "Stepped up to IOP. Receiving clinic confirmed first attendance.",
  },
  {
    patientName: "Aisha Coleman",
    direction: "outgoing",
    sourceType: "other_provider",
    sourceName: "Hopkins Child Psychiatry",
    referralDate: "2026-07-18",
    status: "accepted",
    notes: "Pediatric specialty consult. Records packet sent; awaiting first appointment confirmation.",
  },
];

async function resolveOrgs(): Promise<Organization[]> {
  if (ORG_SLUG) {
    const one = await prisma.organization.findFirst({ where: { slug: ORG_SLUG } });
    if (!one) throw new Error(`Organization not found: ${ORG_SLUG}`);
    return [one];
  }
  return prisma.organization.findMany({ orderBy: { createdAt: "asc" } });
}

function atNoonUtc(isoDate: string) {
  return new Date(`${isoDate}T12:00:00.000Z`);
}

function plusDays(isoDate: string, days: number) {
  const d = atNoonUtc(isoDate);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

async function seedOrg(org: Organization) {
  console.log(`\nSeeding referrals for org: ${org.name} (${org.slug})`);
  let created = 0;
  let skipped = 0;

  for (const row of SEED) {
    const referralDate = atNoonUtc(row.referralDate);
    const existing = await prisma.communityReferral.findFirst({
      where: {
        organizationId: org.id,
        patientName: row.patientName,
        referralDate,
      },
    });
    if (existing) {
      console.log(`  skip (exists): ${row.patientName}`);
      skipped += 1;
      continue;
    }

    await prisma.communityReferral.create({
      data: {
        organizationId: org.id,
        direction: row.direction,
        patientName: row.patientName,
        sourceType: row.sourceType,
        sourceName: row.sourceName,
        referralDate,
        status: row.status,
        convertedAt:
          row.status === "converted" ? plusDays(row.referralDate, row.convertDays ?? 12) : null,
        notes: row.notes,
      },
    });
    created += 1;
    console.log(`  created: ${row.patientName} [${row.direction} / ${row.status}]`);
  }

  return { created, skipped };
}

async function main() {
  const orgs = await resolveOrgs();
  if (!orgs.length) {
    throw new Error("No organization found. Create a clinic first.");
  }

  let created = 0;
  let skipped = 0;
  for (const org of orgs) {
    const result = await seedOrg(org);
    created += result.created;
    skipped += result.skipped;
  }

  console.log(`\nDone. orgs=${orgs.length} created=${created} skipped=${skipped}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
