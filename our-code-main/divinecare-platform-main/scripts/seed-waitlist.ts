/**
 * Seed the previous Waitlist Manager demo entries into the real DB
 * so /dashboard/clients/waitlist is not empty for logged-in clinic users.
 *
 *   npm run db:seed:waitlist
 *   SEED_ORG_SLUG=demo-clinic npm run db:seed:waitlist   # one org only
 *
 * Default: seeds every organization (demo users often sit on demo-clinic /
 * role-demo-clinic, not altrixs).
 */
import "dotenv/config";
import {
  PrismaClient,
  WaitlistStatus,
  WaitlistUrgency,
  type Organization,
} from "@prisma/client";

const prisma = new PrismaClient();
const ORG_SLUG = process.env.SEED_ORG_SLUG?.trim() || "";

type SeedRow = {
  name: string;
  email?: string;
  phone: string;
  specialty: string;
  urgency: WaitlistUrgency;
  status: WaitlistStatus;
  insurancePayer: string;
  referralSource: string;
  notes: string;
  daysWaiting: number;
  /** Prefer matching clinician by name substring */
  clinicianNameHint?: string;
};

const SEED: SeedRow[] = [
  {
    name: "Brittany Simmons",
    phone: "(301) 555-0142",
    specialty: "CBT",
    urgency: "ROUTINE",
    status: "WAITING",
    insurancePayer: "Medicaid",
    referralSource: "Self-referral",
    notes: "Anxiety + depression. Prefers female therapist. Evenings only.",
    daysWaiting: 22,
  },
  {
    name: "DeShawn Morton",
    phone: "(301) 555-0198",
    specialty: "Trauma",
    urgency: "URGENT",
    status: "WAITING",
    insurancePayer: "Medicare",
    referralSource: "Primary Care",
    notes: "Recent trauma, needs appointment within 2 weeks.",
    daysWaiting: 14,
  },
  {
    name: "Aaliyah Cross",
    phone: "(240) 555-0111",
    specialty: "DBT",
    urgency: "URGENT",
    status: "MATCHED",
    insurancePayer: "BCBS",
    referralSource: "Hospital Discharge",
    notes: "",
    daysWaiting: 12,
    clinicianNameHint: "Renee",
  },
  {
    name: "Raymond Hicks",
    phone: "(301) 555-0177",
    specialty: "Substance Use",
    urgency: "ROUTINE",
    status: "WAITING",
    insurancePayer: "Uninsured",
    referralSource: "Self-referral",
    notes: "Sliding scale requested.",
    daysWaiting: 10,
  },
  {
    name: "Monique Fields",
    phone: "(410) 555-0133",
    specialty: "Family Therapy",
    urgency: "ROUTINE",
    status: "SCHEDULED",
    insurancePayer: "Medicaid",
    referralSource: "Community Outreach",
    notes: "",
    daysWaiting: 27,
    clinicianNameHint: "Marcus",
  },
  {
    name: "Terrence Boyd",
    phone: "(301) 555-0166",
    specialty: "Anger Management",
    urgency: "URGENT",
    status: "WAITING",
    insurancePayer: "Aetna",
    referralSource: "Court-Ordered",
    notes: "Court-mandated treatment.",
    daysWaiting: 7,
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

function daysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

async function seedOrg(org: Organization) {
  console.log(`\nSeeding waitlist for org: ${org.name} (${org.slug})`);

  const staff = await prisma.user.findMany({
    where: {
      organizationId: org.id,
      status: "ACTIVE",
      role: { in: ["CLINICIAN", "THERAPIST", "DIRECTOR", "ADMIN"] },
    },
    select: { id: true, name: true, email: true },
  });

  const pickClinician = (hint?: string) => {
    if (!staff.length) return null;
    if (hint) {
      const hit = staff.find(
        (u) =>
          (u.name || "").toLowerCase().includes(hint.toLowerCase()) ||
          u.email.toLowerCase().includes(hint.toLowerCase())
      );
      if (hit) return hit;
    }
    return staff[0] ?? null;
  };

  let created = 0;
  let skipped = 0;

  for (const row of SEED) {
    const existing = await prisma.waitlistEntry.findFirst({
      where: {
        organizationId: org.id,
        name: row.name,
        phone: row.phone,
      },
    });
    if (existing) {
      console.log(`  skip (exists): ${row.name}`);
      skipped += 1;
      continue;
    }

    const clin =
      row.status === "MATCHED" || row.status === "SCHEDULED"
        ? pickClinician(row.clinicianNameHint)
        : null;

    const createdAt = daysAgo(row.daysWaiting);
    await prisma.waitlistEntry.create({
      data: {
        organizationId: org.id,
        name: row.name,
        email: row.email ?? null,
        phone: row.phone,
        specialty: row.specialty,
        urgency: row.urgency,
        status: row.status,
        insurancePayer: row.insurancePayer,
        referralSource: row.referralSource,
        notes: row.notes || null,
        clinicianId: clin?.id ?? null,
        matchedAt:
          row.status === "MATCHED" || row.status === "SCHEDULED"
            ? daysAgo(Math.max(0, row.daysWaiting - 2))
            : null,
        convertedAt: row.status === "SCHEDULED" ? daysAgo(1) : null,
        createdAt,
        updatedAt: new Date(),
      },
    });
    created += 1;
    console.log(
      `  created: ${row.name} [${row.status}]${clin ? ` → ${clin.name || clin.email}` : ""}`
    );
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
