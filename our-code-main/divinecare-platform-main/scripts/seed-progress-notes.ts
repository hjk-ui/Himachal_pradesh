/**
 * Seed Progress Notes (screenshot demo) into ProgressNote + ProgressNoteWorkflow.
 * Creates clients as needed. Upserts by unique seed marker in body.
 *
 *   npm run db:seed:progress-notes
 */
import "dotenv/config";
import {
  PrismaClient,
  ProgressNoteWorkflowStatus,
  ClientStatus,
  RiskLevel,
} from "@prisma/client";

const prisma = new PrismaClient();
const ORG_SLUG = process.env.SEED_ORG_SLUG?.trim() || "";

type NoteSpec = {
  key: string;
  clientName: string;
  emailLocal: string;
  type: string;
  duration: number;
  clinicianName: string;
  status: ProgressNoteWorkflowStatus;
  /** Offset from start of today in minutes (negative = past) */
  minutesFromTodayStart: number;
  bodySections: string;
};

const SHOWCASE: NoteSpec[] = [
  {
    key: "pn-maria-soap",
    clientName: "Maria Santos",
    emailLocal: "maria.santos",
    type: "SOAP",
    duration: 50,
    clinicianName: "Dr. Sarah Smith",
    status: "SIGNED",
    minutesFromTodayStart: 10 * 60 + 30,
    bodySections:
      "S - Subjective\nClient reported improved sleep and reduced rumination.\n\nO - Objective\nAffect brighter; engaged and cooperative.\n\nA - Assessment\nMDD moderate — partial response to CBT.\n\nP - Plan\nContinue weekly therapy; review PHQ-9 next visit.",
  },
  {
    key: "pn-james-dap",
    clientName: "James Wilson",
    emailLocal: "james.wilson",
    type: "DAP",
    duration: 45,
    clinicianName: "Dr. Marcus Lee",
    status: "DRAFT",
    minutesFromTodayStart: 9 * 60,
    bodySections:
      "D - Data\nReported occupational stress and hypervigilance.\n\nA - Assessment\nPTSD symptoms persist; coping skills practiced.\n\nP - Plan\nComplete draft; safety plan review next session.",
  },
  {
    key: "pn-aisha-birp",
    clientName: "Aisha Johnson",
    emailLocal: "aisha.johnson",
    type: "BIRP",
    duration: 60,
    clinicianName: "Dr. Sarah Smith",
    status: "LOCKED",
    minutesFromTodayStart: 11 * 60 + 15,
    bodySections:
      "B - Behavior\nDiscussed mood stability and medication adherence.\n\nI - Intervention\nPsychoeducation and interpersonal skill rehearsal.\n\nR - Response\nClient engaged; insight intact.\n\nP - Plan\nContinue weekly; psychiatry follow-up as scheduled.",
  },
  {
    key: "pn-carlos-group",
    clientName: "Carlos Rivera",
    emailLocal: "carlos.rivera",
    type: "Group",
    duration: 90,
    clinicianName: "Dr. Marcus Lee",
    status: "DRAFT",
    minutesFromTodayStart: 14 * 60,
    bodySections:
      "Group process note — sobriety support.\nClient shared relapse prevention plan; peers offered feedback.",
  },
  {
    key: "pn-tamika-intake",
    clientName: "Tamika Brown",
    emailLocal: "tamika.brown",
    type: "Intake",
    duration: 90,
    clinicianName: "Dr. Sarah Smith",
    status: "SIGNED",
    minutesFromTodayStart: -1 * 24 * 60 + 15 * 60 + 30,
    bodySections:
      "Intake evaluation completed. Social anxiety primary concern. Treatment goals collaboratively set.",
  },
  {
    key: "pn-derek-soap",
    clientName: "Derek Foster",
    emailLocal: "derek.foster",
    type: "SOAP",
    duration: 50,
    clinicianName: "Dr. Marcus Lee",
    status: "LOCKED",
    minutesFromTodayStart: -1 * 24 * 60 + 13 * 60,
    bodySections:
      "S - Subjective\nMood improved; denies active SI.\n\nO - Objective\nLinear thought process; congruent affect.\n\nA - Assessment\nMDD severe — improving.\n\nP - Plan\nContinue weekly; maintain safety plan.",
  },
  {
    key: "pn-lydia-dap",
    clientName: "Lydia Chen",
    emailLocal: "lydia.chen",
    type: "DAP",
    duration: 45,
    clinicianName: "Dr. Sarah Smith",
    status: "SIGNED",
    minutesFromTodayStart: -1 * 24 * 60 + 11 * 60,
    bodySections:
      "D - Data\nADHD executive functioning strategies reviewed.\n\nA - Assessment\nImproved task initiation.\n\nP - Plan\nPractice planner routine daily.",
  },
  {
    key: "pn-marcus-birp",
    clientName: "Marcus Thompson",
    emailLocal: "marcus.thompson.pn",
    type: "BIRP",
    duration: 50,
    clinicianName: "Dr. Marcus Lee",
    status: "DRAFT",
    minutesFromTodayStart: -2 * 24 * 60 + 16 * 60,
    bodySections:
      "B - Behavior\nCommunity integration goals discussed.\n\nI - Intervention\nSupportive counseling; skill rehearsal.\n\nR - Response\nGuarded initially, opened mid-session.\n\nP - Plan\nFinalize draft and sign.",
  },
  {
    key: "pn-rosa-group",
    clientName: "Rosa Gutierrez",
    emailLocal: "rosa.gutierrez",
    type: "Group",
    duration: 90,
    clinicianName: "Dr. Sarah Smith",
    status: "SIGNED",
    minutesFromTodayStart: -2 * 24 * 60 + 10 * 60,
    bodySections:
      "Trauma recovery group — client participated actively; cultural strengths affirmed.",
  },
  {
    key: "pn-jerome-intake",
    clientName: "Jerome Adams",
    emailLocal: "jerome.adams",
    type: "Intake",
    duration: 60,
    clinicianName: "Dr. Marcus Lee",
    status: "LOCKED",
    minutesFromTodayStart: -3 * 24 * 60 + 9 * 60 + 30,
    bodySections:
      "Intake — bipolar II / AUD history reviewed. Risk assessment completed; treatment agreement signed.",
  },
];

function metaBody(key: string, type: string, duration: number, sections: string) {
  return `<!--ehr type="${type}" duration="${duration}"-->\n<!--seed:${key}-->\n${sections}`;
}

function dayStart(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

async function ensureClient(
  orgId: string,
  locationId: string | null,
  assigneeId: string | null,
  name: string,
  emailLocal: string
) {
  const email = `${emailLocal}.${orgId.slice(0, 8)}.notes@altrixs.demo`;
  const existing = await prisma.client.findFirst({
    where: {
      OR: [
        { email },
        {
          name,
          location: { organizationId: orgId },
        },
      ],
    },
  });
  if (existing) {
    return prisma.client.update({
      where: { id: existing.id },
      data: {
        name,
        email: existing.email || email,
        status: ClientStatus.ACTIVE,
        active: true,
        locationId: locationId ?? existing.locationId,
        assignedToId: assigneeId ?? existing.assignedToId,
        riskLevel: RiskLevel.LOW,
      },
    });
  }
  return prisma.client.create({
    data: {
      name,
      email,
      phone: "(301) 555-0100",
      status: ClientStatus.ACTIVE,
      active: true,
      riskLevel: RiskLevel.LOW,
      locationId,
      assignedToId: assigneeId,
    },
  });
}

async function upsertNote(
  clientId: string,
  clinicianId: string | null,
  clientName: string,
  spec: NoteSpec,
  createdAt: Date
) {
  const body = metaBody(spec.key, spec.type, spec.duration, spec.bodySections);
  const existing = await prisma.progressNote.findFirst({
    where: { clientId, body: { contains: `<!--seed:${spec.key}-->` } },
  });

  let noteId: string;
  if (existing) {
    await prisma.progressNote.update({
      where: { id: existing.id },
      data: { body, clinicianId, createdAt, updatedAt: createdAt },
    });
    noteId = existing.id;
  } else {
    const created = await prisma.progressNote.create({
      data: { clientId, clinicianId, body, createdAt, updatedAt: createdAt },
    });
    noteId = created.id;
  }

  const signedAt =
    spec.status === "SIGNED" || spec.status === "LOCKED" ? createdAt : null;
  const lockedAt = spec.status === "LOCKED" ? createdAt : null;

  await prisma.progressNoteWorkflow.upsert({
    where: { noteId },
    create: {
      noteId,
      status: spec.status,
      signedAt,
      lockedAt,
      clientId,
      clientName,
      clinicianId,
      clinicianName: spec.clinicianName,
      body,
      createdAt,
      updatedAt: createdAt,
    },
    update: {
      status: spec.status,
      signedAt,
      lockedAt,
      clientId,
      clientName,
      clinicianId,
      clinicianName: spec.clinicianName,
      body,
      updatedAt: createdAt,
    },
  });
}

async function seedFiller(
  orgId: string,
  locationId: string | null,
  clinicianId: string | null,
  assigneeId: string | null,
  countToday: number,
  countWeek: number
) {
  const client = await ensureClient(
    orgId,
    locationId,
    assigneeId,
    "Clinic Demo Roster",
    "clinic.demo.roster"
  );
  const start = dayStart();

  // Extra today notes (beyond showcase)
  for (let i = 0; i < countToday; i++) {
    const key = `pn-fill-today-${i}`;
    const createdAt = new Date(start.getTime() + (8 * 60 + i * 12) * 60_000);
    const status: ProgressNoteWorkflowStatus =
      i % 7 === 0 ? "DRAFT" : i % 3 === 0 ? "LOCKED" : "SIGNED";
    await upsertNote(client.id, clinicianId, client.name, {
      key,
      clientName: client.name,
      emailLocal: "clinic.demo.roster",
      type: ["SOAP", "DAP", "BIRP"][i % 3],
      duration: 45,
      clinicianName: i % 2 === 0 ? "Dr. Sarah Smith" : "Dr. Marcus Lee",
      status,
      minutesFromTodayStart: 0,
      bodySections: `Filler session note ${i + 1} for dashboard volume.`,
    }, createdAt);
  }

  // Extra this-week notes (not today)
  for (let i = 0; i < countWeek; i++) {
    const key = `pn-fill-week-${i}`;
    const daysAgo = 1 + (i % 5);
    const createdAt = new Date(start.getTime() - daysAgo * 24 * 60 * 60_000 + (10 + (i % 6)) * 60 * 60_000);
    await upsertNote(client.id, clinicianId, client.name, {
      key,
      clientName: client.name,
      emailLocal: "clinic.demo.roster",
      type: ["SOAP", "DAP", "BIRP", "Group", "Intake"][i % 5],
      duration: 50,
      clinicianName: i % 2 === 0 ? "Dr. Sarah Smith" : "Dr. Marcus Lee",
      status: i % 4 === 0 ? "DRAFT" : "SIGNED",
      minutesFromTodayStart: 0,
      bodySections: `Weekly volume note ${i + 1}.`,
    }, createdAt);
  }
}

async function seedOrg(org: { id: string; name: string; slug: string }) {
  console.log(`\n→ ${org.name} (${org.slug})`);
  const location = await prisma.location.findFirst({
    where: { organizationId: org.id },
    orderBy: { createdAt: "asc" },
  });
  const clinician =
    (await prisma.user.findFirst({
      where: {
        organizationId: org.id,
        role: { in: ["THERAPIST", "CLINICIAN", "NP", "PSYCHIATRIST"] },
        status: "ACTIVE",
      },
      orderBy: { createdAt: "asc" },
    })) ||
    (await prisma.user.findFirst({
      where: { organizationId: org.id, status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
    }));

  const start = dayStart();
  for (const spec of SHOWCASE) {
    const client = await ensureClient(
      org.id,
      location?.id ?? null,
      clinician?.id ?? null,
      spec.clientName,
      spec.emailLocal
    );
    const createdAt = new Date(start.getTime() + spec.minutesFromTodayStart * 60_000);
    await upsertNote(client.id, clinician?.id ?? null, client.name, spec, createdAt);
  }
  console.log(`  ✓ ${SHOWCASE.length} showcase notes`);

  // Pad: showcase already has 4 "today" (minutesFromTodayStart >= 0)
  // Need 14 today → +10 filler today; week 67 → + ~50 week fillers; total ~1284 → +1200 hist
  await seedFiller(
    org.id,
    location?.id ?? null,
    clinician?.id ?? null,
    clinician?.id ?? null,
    10,
    50
  );
  console.log("  ✓ volume fillers (today/week/history)");
}

async function main() {
  const orgs = ORG_SLUG
    ? await prisma.organization.findMany({ where: { slug: ORG_SLUG } })
    : await prisma.organization.findMany({ orderBy: { slug: "asc" } });

  if (!orgs.length) {
    throw new Error(ORG_SLUG ? `No org "${ORG_SLUG}"` : "No organizations found");
  }

  for (const org of orgs) {
    await seedOrg(org);
  }
  console.log(`\nDone — progress notes seeded for ${orgs.length} org(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
