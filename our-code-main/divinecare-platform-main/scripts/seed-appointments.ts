/**
 * Seed Schedule / Appointments screenshot data (today + upcoming) into Postgres.
 *
 *   npm run db:seed:appointments
 *   SEED_ORG_SLUG=demo-clinic npm run db:seed:appointments
 */
import "dotenv/config";
import {
  AppointmentNoteStatus,
  AppointmentStatus,
  PrismaClient,
  type Organization,
} from "@prisma/client";

const prisma = new PrismaClient();
const ORG_SLUG = process.env.SEED_ORG_SLUG?.trim() || "";
const SEED_TAG = "[seed-schedule]";

type SeedAppt = {
  clientName: string;
  clientEmailLocal: string;
  clinicianName: string;
  type: string;
  /** minutes from local midnight */
  startMin: number;
  endMin: number;
  dayOffset: number;
  isVirtual: boolean;
  status: AppointmentStatus;
  noteStatus: AppointmentNoteStatus;
};

const SEED: SeedAppt[] = [
  {
    clientName: "Marcus T.",
    clientEmailLocal: "marcus.thompson.appt",
    clinicianName: "Dr. Sarah Smith",
    type: "Crisis Follow-up",
    startMin: 9 * 60,
    endMin: 10 * 60,
    dayOffset: 0,
    isVirtual: true,
    status: "COMPLETED",
    noteStatus: "SIGNED",
  },
  {
    clientName: "Sarah M.",
    clientEmailLocal: "sarah.martinez.appt",
    clinicianName: "Dr. Sarah Smith",
    type: "Individual Therapy",
    startMin: 10 * 60,
    endMin: 11 * 60,
    dayOffset: 0,
    isVirtual: false,
    status: "COMPLETED",
    noteStatus: "AI_DRAFT",
  },
  {
    clientName: "James R.",
    clientEmailLocal: "james.robinson.appt",
    clinicianName: "Dr. Sarah Smith",
    type: "Medication Review",
    startMin: 11 * 60 + 30,
    endMin: 12 * 60 + 15,
    dayOffset: 0,
    isVirtual: true,
    status: "IN_SESSION",
    noteStatus: "NOT_STARTED",
  },
  {
    clientName: "Priya L.",
    clientEmailLocal: "priya.lakshmi.appt",
    clinicianName: "Dr. Sarah Smith",
    type: "Individual Therapy",
    startMin: 14 * 60,
    endMin: 15 * 60,
    dayOffset: 0,
    isVirtual: false,
    status: "CHECKED_IN",
    noteStatus: "NOT_STARTED",
  },
  {
    clientName: "David K.",
    clientEmailLocal: "david.kim.appt",
    clinicianName: "Dr. Sarah Smith",
    type: "Initial Assessment",
    startMin: 15 * 60 + 30,
    endMin: 16 * 60 + 30,
    dayOffset: 0,
    isVirtual: false,
    status: "SCHEDULED",
    noteStatus: "NOT_STARTED",
  },
  {
    clientName: "Rosa G.",
    clientEmailLocal: "rosa.gutierrez.appt",
    clinicianName: "Dr. Sarah Smith",
    type: "Group Therapy",
    startMin: 16 * 60 + 45,
    endMin: 17 * 60 + 45,
    dayOffset: 0,
    isVirtual: false,
    status: "SCHEDULED",
    noteStatus: "NOT_STARTED",
  },
  {
    clientName: "Jerome A.",
    clientEmailLocal: "jerome.adams.appt",
    clinicianName: "Dr. Sarah Smith",
    type: "Individual Therapy",
    startMin: 10 * 60,
    endMin: 11 * 60,
    dayOffset: 2,
    isVirtual: false,
    status: "SCHEDULED",
    noteStatus: "NOT_STARTED",
  },
  {
    clientName: "Sarah M.",
    clientEmailLocal: "sarah.martinez.appt",
    clinicianName: "Dr. Sarah Smith",
    type: "Telehealth Check-in",
    startMin: 14 * 60,
    endMin: 14 * 60 + 30,
    dayOffset: 5,
    isVirtual: true,
    status: "SCHEDULED",
    noteStatus: "NOT_STARTED",
  },
];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function localYmd(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function atLocal(dayOffset: number, minutes: number) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + dayOffset);
  d.setMinutes(minutes);
  return d;
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

async function ensureClinician(
  orgId: string,
  displayName: string,
  emailLocal: string
) {
  // Prefer an existing THERAPIST/CLINICIAN so caseload dashboards show the board
  let user = await prisma.user.findFirst({
    where: {
      organizationId: orgId,
      status: "ACTIVE",
      role: { in: ["THERAPIST", "CLINICIAN"] },
    },
    orderBy: { createdAt: "asc" },
  });
  if (user) return user;

  const email = `${emailLocal}+${orgId.slice(-6)}@seed.altrixs.local`.toLowerCase();
  user = await prisma.user.findFirst({
    where: {
      organizationId: orgId,
      OR: [
        { email },
        { name: { equals: displayName, mode: "insensitive" } },
      ],
    },
  });
  if (!user) {
    user = await prisma.user.findFirst({
      where: {
        organizationId: orgId,
        status: "ACTIVE",
        role: { in: ["DIRECTOR", "ADMIN", "NP", "PSYCHIATRIST"] },
      },
    });
  }
  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        name: displayName,
        role: "THERAPIST",
        roles: ["THERAPIST"],
        status: "ACTIVE",
        organizationId: orgId,
      },
    });
  } else if (!user.name) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: { name: displayName },
    });
  }
  return user;
}

async function ensureClient(
  orgId: string,
  locationId: string,
  name: string,
  emailLocal: string,
  assigneeId: string | null
) {
  const email = `${emailLocal}+${orgId.slice(-6)}@seed.altrixs.local`.toLowerCase();
  let client = await prisma.client.findFirst({ where: { email } });
  if (!client) {
    client = await prisma.client.findFirst({
      where: {
        name: { equals: name, mode: "insensitive" },
        OR: [
          { location: { organizationId: orgId } },
          { assignedTo: { organizationId: orgId } },
        ],
      },
    });
  }
  if (!client) {
    client = await prisma.client.create({
      data: {
        name,
        email,
        locationId,
        assignedToId: assigneeId,
        status: "ACTIVE",
        active: true,
      },
    });
  } else {
    client = await prisma.client.update({
      where: { id: client.id },
      data: {
        name,
        locationId: client.locationId || locationId,
        assignedToId: client.assignedToId || assigneeId,
        status: "ACTIVE",
        active: true,
        email: client.email || email,
      },
    });
  }
  return client;
}

async function seedOrg(org: Organization) {
  console.log(`\nSeeding appointments for: ${org.name} (${org.slug})`);
  const location = await ensureLocation(org.id);

  // Remove prior seed-tagged appointments for this org (and same-day collision window)
  const windowStart = atLocal(0, 0);
  const windowEnd = atLocal(14, 23 * 60 + 59);
  await prisma.appointment.deleteMany({
    where: {
      AND: [
        {
          OR: [
            { organizationId: org.id },
            { client: { location: { organizationId: org.id } } },
            { clinician: { organizationId: org.id } },
          ],
        },
        {
          OR: [
            { notes: { contains: SEED_TAG } },
            { startsAt: { gte: windowStart, lte: windowEnd } },
          ],
        },
      ],
    },
  });

  const clinicianCache = new Map<string, Awaited<ReturnType<typeof ensureClinician>>>();

  for (const row of SEED) {
    let clinician = clinicianCache.get(row.clinicianName);
    if (!clinician) {
      const local = row.clinicianName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ".")
        .replace(/^\.+|\.+$/g, "");
      clinician = await ensureClinician(org.id, row.clinicianName, local);
      clinicianCache.set(row.clinicianName, clinician);
    }

    const client = await ensureClient(
      org.id,
      location.id,
      row.clientName,
      row.clientEmailLocal,
      clinician.id
    );

    const startsAt = atLocal(row.dayOffset, row.startMin);
    const endsAt = atLocal(row.dayOffset, row.endMin);

    await prisma.appointment.create({
      data: {
        organizationId: org.id,
        clientId: client.id,
        clientName: row.clientName,
        clinicianId: clinician.id,
        clinicianName: row.clinicianName,
        type: row.type,
        startsAt,
        endsAt,
        status: row.status,
        noteStatus: row.noteStatus,
        isVirtual: row.isVirtual,
        notes: SEED_TAG,
      },
    });

    console.log(
      `  ${localYmd(startsAt)} ${row.clientName} · ${row.type} · ${row.status}/${row.noteStatus}`
    );
  }
}

async function main() {
  const orgs = await resolveOrgs();
  if (!orgs.length) throw new Error("No organization found");
  for (const org of orgs) await seedOrg(org);
  console.log(`\nDone. Seeded ${SEED.length} appointments × ${orgs.length} org(s).`);
    console.log(
      "Expected Today KPIs: 6 sessions · 2 scheduled remaining · Seen/In Session/Checked In board"
    );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
