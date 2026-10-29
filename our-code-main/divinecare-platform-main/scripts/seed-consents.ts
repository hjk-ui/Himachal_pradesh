/**
 * Seed ConsentForm rows (screenshot demo) for every org.
 * Creates/links clients by name. Idempotent via notes marker.
 *
 *   npx tsx scripts/seed-consents.ts
 */
import "dotenv/config";
import {
  PrismaClient,
  ConsentFormStatus,
  ClientStatus,
  RiskLevel,
} from "@prisma/client";

const prisma = new PrismaClient();

type Spec = {
  key: string;
  clientName: string;
  emailLocal: string;
  type: string;
  method: string;
  status: ConsentFormStatus;
  sentAt: string;
  signedAt?: string;
  expiresAt?: string | null;
};

const SPECS: Spec[] = [
  {
    key: "cns-maria-treat",
    clientName: "Maria Santos",
    emailLocal: "maria.santos",
    type: "Consent to Treat",
    method: "In-Person",
    status: "SIGNED",
    sentAt: "2025-12-01",
    signedAt: "2025-12-01",
    expiresAt: "2026-12-01",
  },
  {
    key: "cns-maria-hipaa",
    clientName: "Maria Santos",
    emailLocal: "maria.santos",
    type: "HIPAA Notice",
    method: "In-Person",
    status: "SIGNED",
    sentAt: "2025-12-01",
    signedAt: "2025-12-01",
    expiresAt: "2026-12-01",
  },
  {
    key: "cns-maria-tele",
    clientName: "Maria Santos",
    emailLocal: "maria.santos",
    type: "Telehealth Consent",
    method: "DocuSign",
    status: "SIGNED",
    sentAt: "2026-01-15",
    signedAt: "2026-01-15",
    expiresAt: "2026-07-15",
  },
  {
    key: "cns-james-treat",
    clientName: "James Wilson",
    emailLocal: "james.wilson",
    type: "Consent to Treat",
    method: "In-Person",
    status: "SIGNED",
    sentAt: "2025-11-10",
    signedAt: "2025-11-10",
    expiresAt: "2026-11-10",
  },
  {
    key: "cns-james-hipaa",
    clientName: "James Wilson",
    emailLocal: "james.wilson",
    type: "HIPAA Notice",
    method: "In-Person",
    status: "SIGNED",
    sentAt: "2025-11-10",
    signedAt: "2025-11-10",
    expiresAt: "2026-11-10",
  },
  {
    key: "cns-james-roi",
    clientName: "James Wilson",
    emailLocal: "james.wilson",
    type: "Release of Information",
    method: "Email",
    status: "PENDING",
    sentAt: "2026-02-01",
  },
  {
    key: "cns-aisha-treat",
    clientName: "Aisha Johnson",
    emailLocal: "aisha.johnson",
    type: "Consent to Treat",
    method: "DocuSign",
    status: "SIGNED",
    sentAt: "2025-09-01",
    signedAt: "2025-09-02",
    expiresAt: "2026-03-20",
  },
  {
    key: "cns-carlos-hipaa",
    clientName: "Carlos Rivera",
    emailLocal: "carlos.rivera",
    type: "HIPAA Notice",
    method: "In-Person",
    status: "SIGNED",
    sentAt: "2026-01-08",
    signedAt: "2026-01-08",
    expiresAt: "2027-01-08",
  },
  {
    key: "cns-derek-tele",
    clientName: "Derek Foster",
    emailLocal: "derek.foster",
    type: "Telehealth Consent",
    method: "Patient Portal",
    status: "PENDING",
    sentAt: "2026-08-10",
  },
  {
    key: "cns-lydia-photo",
    clientName: "Lydia Chen",
    emailLocal: "lydia.chen",
    type: "Photography/Media",
    method: "Email",
    status: "SIGNED",
    sentAt: "2026-02-20",
    signedAt: "2026-02-21",
    expiresAt: null,
  },
];

function day(iso: string) {
  return new Date(`${iso}T12:00:00.000Z`);
}

async function ensureClient(
  orgId: string,
  locationId: string | null,
  assigneeId: string | null,
  name: string,
  emailLocal: string
) {
  const email = `${emailLocal}.${orgId.slice(0, 8)}.consent@altrixs.demo`;
  const existing = await prisma.client.findFirst({
    where: {
      OR: [
        { email },
        { name, location: { organizationId: orgId } },
        { name, assignedTo: { organizationId: orgId } },
      ],
    },
  });
  if (existing) {
    return prisma.client.update({
      where: { id: existing.id },
      data: {
        name,
        status: ClientStatus.ACTIVE,
        active: true,
        locationId: locationId ?? existing.locationId,
        assignedToId: assigneeId ?? existing.assignedToId,
      },
    });
  }
  return prisma.client.create({
    data: {
      name,
      email,
      phone: "(301) 555-0140",
      status: ClientStatus.ACTIVE,
      active: true,
      riskLevel: RiskLevel.LOW,
      locationId,
      assignedToId: assigneeId,
    },
  });
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

  let n = 0;
  for (const spec of SPECS) {
    const client = await ensureClient(
      org.id,
      location?.id ?? null,
      staff?.id ?? null,
      spec.clientName,
      spec.emailLocal
    );
    const marker = `seed:${spec.key}`;
    const existing = await prisma.consentForm.findFirst({
      where: {
        organizationId: org.id,
        clientId: client.id,
        type: spec.type,
        notes: { contains: marker },
      },
    });

    const data = {
      organizationId: org.id,
      clientId: client.id,
      type: spec.type,
      status: spec.status,
      method: spec.method,
      sentAt: day(spec.sentAt),
      signedAt: spec.signedAt ? day(spec.signedAt) : null,
      expiresAt:
        spec.expiresAt === null
          ? null
          : spec.expiresAt
            ? day(spec.expiresAt)
            : null,
      signedByName: spec.status === "SIGNED" ? spec.clientName : null,
      notes: marker,
      createdById: staff?.id ?? null,
    };

    if (existing) {
      await prisma.consentForm.update({ where: { id: existing.id }, data });
    } else {
      await prisma.consentForm.create({ data });
    }
    n += 1;
  }
  console.log(`  ✓ ${n} consent forms`);
}

async function main() {
  const slug = process.env.SEED_ORG_SLUG?.trim();
  const orgs = slug
    ? await prisma.organization.findMany({ where: { slug } })
    : await prisma.organization.findMany({ orderBy: { slug: "asc" } });
  if (!orgs.length) throw new Error("No organizations found");
  for (const org of orgs) await seedOrg(org);
  console.log(`\nDone — consents seeded for ${orgs.length} org(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
