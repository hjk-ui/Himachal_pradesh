/**
 * Seed Digital Intake Manager demo invites (former static SEED) into Postgres
 * so /dashboard/clients/intake is not empty for logged-in clinic users.
 *
 *   npm run db:seed:intake
 *   SEED_ORG_SLUG=demo-clinic npm run db:seed:intake
 *
 * Default: every organization (same pattern as waitlist seed).
 */
import "dotenv/config";
import { randomBytes } from "crypto";
import {
  PrismaClient,
  IntakeInviteStatus,
  type Organization,
  type Prisma,
} from "@prisma/client";

const prisma = new PrismaClient();
const ORG_SLUG = process.env.SEED_ORG_SLUG?.trim() || "";
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

type SeedRow = {
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  firstAppointment: string; // YYYY-MM-DD
  status: IntakeInviteStatus;
  sentCount: number;
  /** Days ago the invite was (last) sent — drives "Sent N days ago" via updatedAt */
  sentDaysAgo: number;
  completedAt?: string; // ISO date
  tokenSuffix: string;
};

const SEED: SeedRow[] = [
  {
    clientName: "Monique Fields",
    clientEmail: "m.fields@outlook.com",
    clientPhone: "(410) 555-0774",
    firstAppointment: "2026-07-05",
    status: "PENDING",
    sentCount: 1,
    sentDaysAgo: 2,
    tokenSuffix: "abc123",
  },
  {
    clientName: "Aaliyah Foreman",
    clientEmail: "aaliyah.f@gmail.com",
    clientPhone: "(443) 555-0391",
    firstAppointment: "2026-07-01",
    status: "COMPLETED",
    sentCount: 1,
    sentDaysAgo: 30,
    completedAt: "2026-06-26T18:00:00.000Z",
    tokenSuffix: "def456",
  },
  {
    clientName: "Jerome Carter",
    clientEmail: "jcarter@email.com",
    clientPhone: "(240) 555-0882",
    firstAppointment: "2026-07-01",
    status: "EXPIRED",
    sentCount: 2,
    sentDaysAgo: 10,
    tokenSuffix: "ghi789",
  },
  {
    clientName: "Brianna Wells",
    clientEmail: "brianna.w@yahoo.com",
    clientPhone: "(301) 555-0234",
    firstAppointment: "2026-07-08",
    status: "PENDING",
    sentCount: 1,
    sentDaysAgo: 1,
    tokenSuffix: "jkl012",
  },
];

const AALIYAH_FORM: Prisma.InputJsonValue = {
  demographics: {
    firstName: "Aaliyah",
    lastName: "Foreman",
    dateOfBirth: "1994-03-12",
    pronouns: "she/her",
    addressLine1: "814 Liberty Ave",
    city: "Baltimore",
    state: "MD",
    postalCode: "21217",
    phone: "(443) 555-0391",
    email: "aaliyah.f@gmail.com",
    emergencyContactName: "Marcus Foreman",
    emergencyContactRelationship: "Brother",
    emergencyContactPhone: "(443) 555-0199",
  },
  insurance: {
    primaryPayer: "BCBS",
    memberId: "XMD998221",
    groupNumber: "GRP-4401",
    subscriberName: "Aaliyah Foreman",
    subscriberDob: "1994-03-12",
    subscriberRelationship: "Self",
  },
  medicalHistory: {
    medications: "Sertraline 50mg daily",
    allergies: "NKDA",
    previousTreatment: "Outpatient counseling 2023",
    pcpName: "Dr. Kim",
    pcpPhone: "(410) 555-0100",
    reasonForSeeking: "Anxiety and sleep disruption after job change",
    substanceUse: "Denies",
  },
  consents: {
    hipaa: true,
    treatment: true,
    telehealth: true,
    financial: true,
  },
  signature: {
    fullName: "Aaliyah Foreman",
    signedAt: "2026-06-26T18:00:00.000Z",
  },
};

function daysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

function parseAppt(ymd: string) {
  const d = new Date(`${ymd}T12:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function resolveOrgs(): Promise<Organization[]> {
  if (ORG_SLUG) {
    const one = await prisma.organization.findFirst({ where: { slug: ORG_SLUG } });
    if (!one) throw new Error(`Organization not found: ${ORG_SLUG}`);
    return [one];
  }
  return prisma.organization.findMany({ orderBy: { createdAt: "asc" } });
}

function tokenFor(orgSlug: string, suffix: string) {
  // Unique globally; stable per org so Preview URLs stay predictable in demos
  const base = `seed-${orgSlug}-${suffix}`.replace(/[^a-zA-Z0-9_-]/g, "-");
  return base.length >= 16 ? base : `${base}-${randomBytes(8).toString("hex")}`;
}

async function seedOrg(org: Organization) {
  console.log(`\nSeeding intake for org: ${org.name} (${org.slug})`);
  let created = 0;
  let skipped = 0;

  for (const row of SEED) {
    const email = row.clientEmail.toLowerCase();
    const existing = await prisma.intakeInvite.findFirst({
      where: { organizationId: org.id, clientEmail: email },
    });
    if (existing) {
      console.log(`  skip (exists): ${row.clientName}`);
      skipped += 1;
      continue;
    }

    const sentAt = daysAgo(row.sentDaysAgo);
    const expiresAt =
      row.status === "EXPIRED"
        ? daysAgo(3)
        : row.status === "COMPLETED"
          ? new Date(sentAt.getTime() + TTL_MS)
          : new Date(Date.now() + TTL_MS);

    await prisma.intakeInvite.create({
      data: {
        organizationId: org.id,
        token: tokenFor(org.slug, row.tokenSuffix),
        clientName: row.clientName,
        clientEmail: email,
        clientPhone: row.clientPhone,
        firstAppointment: parseAppt(row.firstAppointment),
        status: row.status,
        sentCount: row.sentCount,
        expiresAt,
        completedAt: row.completedAt ? new Date(row.completedAt) : null,
        formData: row.status === "COMPLETED" ? AALIYAH_FORM : undefined,
        createdAt: sentAt,
        updatedAt: sentAt,
      },
    });
    created += 1;
    console.log(`  created: ${row.clientName} [${row.status}]`);
  }

  return { created, skipped };
}

async function main() {
  const orgs = await resolveOrgs();
  if (!orgs.length) throw new Error("No organization found.");

  let created = 0;
  let skipped = 0;
  for (const org of orgs) {
    const r = await seedOrg(org);
    created += r.created;
    skipped += r.skipped;
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
