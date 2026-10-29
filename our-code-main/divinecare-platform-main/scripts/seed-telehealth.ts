/**
 * Seed Telehealth sessions + settings.
 *   npm run db:seed:telehealth
 */
import "dotenv/config";
import {
  PrismaClient,
  RiskLevel,
  TelehealthPlatform,
  TelehealthSessionStatus,
  type Organization,
} from "@prisma/client";

const prisma = new PrismaClient();
const ORG_SLUG = process.env.SEED_ORG_SLUG?.trim() || "";

type SeedSession = {
  clientName: string;
  emailLocal: string;
  clinicianName: string;
  type: string;
  dayOffset: number;
  startTime: string;
  durationMin: number;
  status: TelehealthSessionStatus;
  platform: TelehealthPlatform;
  roomId: string;
  risk: RiskLevel;
  rating?: number;
  notesSummary?: string;
};

const SEED: SeedSession[] = [
  {
    clientName: "Marcus Johnson",
    emailLocal: "marcus.johnson.th",
    clinicianName: "Dr. Sarah Smith",
    type: "Individual Therapy",
    dayOffset: 0,
    startTime: "10:00",
    durationMin: 60,
    status: "IN_PROGRESS",
    platform: "ZOOM",
    roomId: "dcl-marcus-001",
    risk: "HIGH",
  },
  {
    clientName: "Destiny Williams",
    emailLocal: "destiny.williams.th",
    clinicianName: "Dr. Sarah Smith",
    type: "Individual Therapy",
    dayOffset: 0,
    startTime: "11:30",
    durationMin: 45,
    status: "UPCOMING",
    platform: "ZOOM",
    roomId: "dcl-destiny-002",
    risk: "MEDIUM",
  },
  {
    clientName: "Johnson Family",
    emailLocal: "johnson.family.th",
    clinicianName: "Marcus Johnson",
    type: "Family Therapy",
    dayOffset: 0,
    startTime: "13:00",
    durationMin: 60,
    status: "UPCOMING",
    platform: "DOXY",
    roomId: "dcl-johnson-fam",
    risk: "LOW",
  },
  {
    clientName: "Andre Mitchell",
    emailLocal: "andre.mitchell.th",
    clinicianName: "Dr. Priya Nair",
    type: "Medication Review",
    dayOffset: 0,
    startTime: "15:30",
    durationMin: 30,
    status: "UPCOMING",
    platform: "ZOOM",
    roomId: "dcl-andre-004",
    risk: "LOW",
  },
  {
    clientName: "Rosa Gutierrez",
    emailLocal: "rosa.gutierrez.th",
    clinicianName: "Dr. Sarah Smith",
    type: "Individual Therapy",
    dayOffset: 1,
    startTime: "09:00",
    durationMin: 50,
    status: "UPCOMING",
    platform: "ZOOM",
    roomId: "dcl-rosa-u1",
    risk: "LOW",
  },
  {
    clientName: "Janelle Williams",
    emailLocal: "janelle.williams.th",
    clinicianName: "Marcus Johnson",
    type: "Individual Therapy",
    dayOffset: 2,
    startTime: "14:00",
    durationMin: 50,
    status: "UPCOMING",
    platform: "DOXY",
    roomId: "dcl-janelle-u2",
    risk: "LOW",
  },
  {
    clientName: "David Kim",
    emailLocal: "david.kim.th",
    clinicianName: "Dr. Sarah Smith",
    type: "Initial Assessment",
    dayOffset: 3,
    startTime: "10:30",
    durationMin: 60,
    status: "UPCOMING",
    platform: "ZOOM",
    roomId: "dcl-david-u3",
    risk: "MEDIUM",
  },
  {
    clientName: "Priya Lakshmi",
    emailLocal: "priya.lakshmi.th",
    clinicianName: "Marcus Johnson",
    type: "Individual Therapy",
    dayOffset: 4,
    startTime: "11:00",
    durationMin: 50,
    status: "UPCOMING",
    platform: "ZOOM",
    roomId: "dcl-priya-u4",
    risk: "LOW",
  },
  {
    clientName: "Sarah Martinez",
    emailLocal: "sarah.martinez.th",
    clinicianName: "Dr. Sarah Smith",
    type: "Telehealth Check-in",
    dayOffset: 5,
    startTime: "16:00",
    durationMin: 30,
    status: "UPCOMING",
    platform: "DOXY",
    roomId: "dcl-sarah-u5",
    risk: "LOW",
  },
  {
    clientName: "James Robinson",
    emailLocal: "james.robinson.th",
    clinicianName: "Dr. Priya Nair",
    type: "Medication Review",
    dayOffset: -2,
    startTime: "09:30",
    durationMin: 30,
    status: "COMPLETED",
    platform: "ZOOM",
    roomId: "dcl-james-h1",
    risk: "LOW",
    rating: 5,
    notesSummary: "Meds tolerated well; continue current dose.",
  },
  {
    clientName: "Marcus Thompson",
    emailLocal: "marcus.thompson.th",
    clinicianName: "Dr. Sarah Smith",
    type: "Crisis Follow-up",
    dayOffset: -3,
    startTime: "13:00",
    durationMin: 45,
    status: "COMPLETED",
    platform: "ZOOM",
    roomId: "dcl-marcus-h2",
    risk: "HIGH",
    rating: 4,
    notesSummary: "Safety plan reviewed; follow-up scheduled.",
  },
  {
    clientName: "Destiny Williams",
    emailLocal: "destiny.williams.hist",
    clinicianName: "Dr. Sarah Smith",
    type: "Individual Therapy",
    dayOffset: -5,
    startTime: "11:00",
    durationMin: 50,
    status: "COMPLETED",
    platform: "DOXY",
    roomId: "dcl-destiny-h3",
    risk: "MEDIUM",
    rating: 4.5,
    notesSummary: "CBT homework assigned; mood improved vs last week.",
  },
];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function atDay(offset: number) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d;
}

function joinUrl(platform: TelehealthPlatform, roomId: string) {
  if (platform === "DOXY") return `https://doxy.me/${roomId}`;
  return `https://zoom.us/j/${roomId.replace(/\D/g, "").padEnd(10, "0").slice(0, 10)}`;
}

async function resolveOrgs(): Promise<Organization[]> {
  if (ORG_SLUG) {
    const one = await prisma.organization.findFirst({ where: { slug: ORG_SLUG } });
    if (!one) throw new Error(`Org not found: ${ORG_SLUG}`);
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

async function ensureClinician(orgId: string, name: string) {
  let user = await prisma.user.findFirst({
    where: {
      organizationId: orgId,
      name: { contains: name.replace(/^Dr\.\s*/i, "").split(" ")[0], mode: "insensitive" },
    },
  });
  if (!user) {
    user = await prisma.user.findFirst({
      where: {
        organizationId: orgId,
        status: "ACTIVE",
        role: { in: ["THERAPIST", "CLINICIAN", "ADMIN", "DIRECTOR", "NP"] },
      },
    });
  }
  if (!user) {
    const email = `${name.toLowerCase().replace(/[^a-z0-9]+/g, ".")}+${orgId.slice(-6)}@seed.altrixs.local`;
    user = await prisma.user.create({
      data: {
        email,
        name,
        role: "THERAPIST",
        roles: ["THERAPIST"],
        status: "ACTIVE",
        organizationId: orgId,
      },
    });
  }
  return user;
}

async function ensureClient(
  orgId: string,
  locationId: string,
  name: string,
  emailLocal: string,
  risk: RiskLevel,
  clinicianId: string | null
) {
  const email = `${emailLocal}+${orgId.slice(-6)}@seed.altrixs.local`.toLowerCase();
  let client = await prisma.client.findFirst({ where: { email } });
  if (!client) {
    client = await prisma.client.findFirst({
      where: {
        name: { equals: name, mode: "insensitive" },
        location: { organizationId: orgId },
      },
    });
  }
  if (!client) {
    client = await prisma.client.create({
      data: {
        name,
        email,
        locationId,
        assignedToId: clinicianId,
        status: "ACTIVE",
        active: true,
        riskLevel: risk,
      },
    });
  } else {
    client = await prisma.client.update({
      where: { id: client.id },
      data: {
        name,
        locationId: client.locationId || locationId,
        assignedToId: client.assignedToId || clinicianId,
        riskLevel: risk,
        status: "ACTIVE",
        active: true,
        email: client.email || email,
      },
    });
  }
  return client;
}

async function seedOrg(org: Organization) {
  console.log(`\nSeeding telehealth for: ${org.name} (${org.slug})`);
  const location = await ensureLocation(org.id);

  await prisma.telehealthSession.deleteMany({ where: { organizationId: org.id } });
  await prisma.telehealthSettings.upsert({
    where: { organizationId: org.id },
    create: {
      organizationId: org.id,
      defaultPlatform: "ZOOM",
      reminderMinutes: 15,
      recordingMode: "off",
      autoSendLinkMinutes: 60,
      waitingRoom: true,
      platformsJson: { zoom: true, doxy: true, google: false, teams: false },
    },
    update: {
      defaultPlatform: "ZOOM",
      reminderMinutes: 15,
      recordingMode: "off",
      autoSendLinkMinutes: 60,
      waitingRoom: true,
      platformsJson: { zoom: true, doxy: true, google: false, teams: false },
    },
  });

  for (const row of SEED) {
    const clin = await ensureClinician(org.id, row.clinicianName);
    const client = await ensureClient(
      org.id,
      location.id,
      row.clientName,
      row.emailLocal,
      row.risk,
      clin.id
    );
    const sessionDate = atDay(row.dayOffset);
    await prisma.telehealthSession.create({
      data: {
        organizationId: org.id,
        clientId: client.id,
        clientName: row.clientName,
        clinicianId: clin.id,
        clinicianName: row.clinicianName,
        type: row.type,
        sessionDate,
        startTime: row.startTime,
        durationMin: row.durationMin,
        status: row.status,
        platform: row.platform,
        roomId: `${row.roomId}-${org.slug}`,
        joinUrl: joinUrl(row.platform, `${row.roomId}-${org.slug}`),
        riskLevel: row.risk,
        rating: row.rating ?? null,
        notesSummary: row.notesSummary ?? null,
      },
    });
    console.log(
      `  ${row.clientName} ${row.startTime} d${row.dayOffset} ${row.status}/${row.platform}`
    );
  }
}

async function main() {
  const orgs = await resolveOrgs();
  for (const org of orgs) await seedOrg(org);
  console.log(`\nDone. ${SEED.length} sessions × ${orgs.length} org(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
