/**
 * Seed Therapist + Admin home supporting data (draft notes, plans, assessment-due, admin modules).
 *   npm run db:seed:therapist-home
 */
import "dotenv/config";
import {
  PrismaClient,
  ProgressNoteWorkflowStatus,
  TreatmentPlanStatus,
  type Organization,
  type Prisma,
} from "@prisma/client";

const prisma = new PrismaClient();
const ORG_SLUG = process.env.SEED_ORG_SLUG?.trim() || "";

const ASSESSMENT_DUE = [
  {
    id: "ad-marcus-phq9",
    clientName: "Marcus T.",
    tool: "PHQ-9",
    dueLabel: "Today",
    overdue: true,
    emailLocal: "marcus.t.risk",
  },
  {
    id: "ad-janelle-gad7",
    clientName: "Janelle W.",
    tool: "GAD-7",
    dueLabel: "Mar 10",
    overdue: false,
    emailLocal: "janelle.w.risk",
  },
  {
    id: "ad-chris-cssrs",
    clientName: "Chris L.",
    tool: "Columbia-SSR",
    dueLabel: "Mar 11",
    overdue: false,
    emailLocal: "chris.l.assess",
  },
  {
    id: "ad-sam-pcl5",
    clientName: "Sam T.",
    tool: "PCL-5",
    dueLabel: "Mar 13",
    overdue: false,
    emailLocal: "sam.t.assess",
  },
];

const PLAN_SPECS = [
  {
    emailLocal: "marcus.t.risk",
    clientName: "Marcus T.",
    title: "MDD",
    codes: ["F33.1"],
    daysUntilReview: 5,
  },
  {
    emailLocal: "janelle.w.risk",
    clientName: "Janelle W.",
    title: "GAD",
    codes: ["F41.1"],
    daysUntilReview: 11,
  },
  {
    emailLocal: "david.k.risk",
    clientName: "David K.",
    title: "PTSD",
    codes: ["F43.1"],
    daysUntilReview: 18,
  },
];

const NOTE_SPECS = [
  {
    emailLocal: "sarah.m.note",
    clientName: "Sarah M.",
    body: "SOAP — Session today at 10:00 AM. Mood improved; continue CBT homework. Unsigned draft.",
    hoursAgo: 4,
  },
  {
    emailLocal: "james.r.note",
    clientName: "James R.",
    body: "DAP — Yesterday session at 2:00 PM. Medication adherence reviewed. Awaiting signature.",
    hoursAgo: 30,
  },
  {
    emailLocal: "priya.l.note",
    clientName: "Priya L.",
    body: "SOAP — Yesterday session at 11:00 AM. Anxiety coping skills practiced. Unsigned.",
    hoursAgo: 28,
  },
];

const ADMIN_AUDIT = [
  {
    id: "audit-live-1",
    actor: "System",
    action: "Staff invite sent",
    detail: "Invite workflow recorded",
    when: "2h ago",
    severity: "info",
  },
  {
    id: "audit-live-2",
    actor: "Clinic Admin",
    action: "Role dashboard updated",
    detail: "Therapist home modules refreshed",
    when: "Yesterday",
    severity: "medium",
  },
  {
    id: "audit-live-3",
    actor: "Security",
    action: "Login success",
    detail: "Staff portal session started",
    when: "Today",
    severity: "low",
  },
];

const ADMIN_INTEGRATIONS = [
  { id: "int-availity", name: "Availity Eligibility", status: "connected", lastSync: "Live" },
  { id: "int-zoom", name: "Zoom Telehealth", status: "connected", lastSync: "Live" },
  { id: "int-smtp", name: "SMTP Email", status: "connected", lastSync: "Configured" },
];

const ADMIN_RULES = [
  {
    id: "rule-risk-high",
    name: "High risk alert",
    trigger: "Unreviewed HIGH severity risk alert",
    action: "Notify assigned clinician + director",
    channel: "In-app + email",
    active: true,
    severity: "critical",
  },
  {
    id: "rule-unsigned-note",
    name: "Unsigned note aging",
    trigger: "Draft progress note older than 24 hours",
    action: "Add to therapist To-Do",
    channel: "In-app",
    active: true,
    severity: "warning",
  },
];

async function ensureClient(
  org: Organization,
  locationId: string | null,
  emailLocal: string,
  name: string,
  assigneeId?: string | null
) {
  const email = `${emailLocal}@${org.slug}.seed.local`;
  const existing = await prisma.client.findFirst({
    where: {
      OR: [
        { email },
        { name, location: { organizationId: org.id } },
      ],
    },
  });
  if (existing) {
    if (assigneeId && existing.assignedToId !== assigneeId) {
      return prisma.client.update({
        where: { id: existing.id },
        data: { assignedToId: assigneeId },
      });
    }
    return existing;
  }

  return prisma.client.create({
    data: {
      name,
      email,
      active: true,
      riskLevel: "MEDIUM",
      locationId: locationId ?? undefined,
      assignedToId: assigneeId ?? undefined,
    },
  });
}

async function upsertModule(orgId: string, module: string, data: unknown) {
  const payload = data as Prisma.InputJsonValue;
  await prisma.clinicModuleState.upsert({
    where: { organizationId_module: { organizationId: orgId, module } },
    create: { organizationId: orgId, module, data: payload },
    update: { data: payload },
  });
}

async function seedOrg(org: Organization) {
  console.log(`\n→ ${org.name} (${org.slug})`);
  const location = await prisma.location.findFirst({
    where: { organizationId: org.id },
    orderBy: { createdAt: "asc" },
  });
  const clinician =
    (await prisma.user.findFirst({
      where: {
        organizationId: org.id,
        role: { in: ["THERAPIST", "CLINICIAN"] },
        status: "ACTIVE",
      },
      orderBy: { createdAt: "asc" },
    })) ||
    (await prisma.user.findFirst({
      where: {
        organizationId: org.id,
        role: { in: ["DIRECTOR", "ADMIN"] },
        status: "ACTIVE",
      },
      orderBy: { createdAt: "asc" },
    }));

  // Draft unsigned notes
  for (const spec of NOTE_SPECS) {
    const client = await ensureClient(
      org,
      location?.id ?? null,
      spec.emailLocal,
      spec.clientName,
      clinician?.id
    );
    const createdAt = new Date(Date.now() - spec.hoursAgo * 3600_000);
    const existing = await prisma.progressNote.findFirst({
      where: {
        clientId: client.id,
        body: { contains: "Unsigned" },
      },
      include: { workflow: true },
    });
    if (existing?.workflow) {
      await prisma.progressNoteWorkflow.update({
        where: { noteId: existing.id },
        data: {
          status: ProgressNoteWorkflowStatus.DRAFT,
          body: spec.body,
          clientName: client.name,
          clinicianId: clinician?.id,
          clinicianName: clinician?.name ?? "Dr. Sarah Smith",
          createdAt,
          updatedAt: createdAt,
        },
      });
    } else {
      const note = await prisma.progressNote.create({
        data: {
          clientId: client.id,
          clinicianId: clinician?.id,
          body: spec.body,
          createdAt,
          updatedAt: createdAt,
        },
      });
      await prisma.progressNoteWorkflow.create({
        data: {
          noteId: note.id,
          status: ProgressNoteWorkflowStatus.DRAFT,
          clientId: client.id,
          clientName: client.name,
          clinicianId: clinician?.id,
          clinicianName: clinician?.name ?? "Dr. Sarah Smith",
          body: spec.body,
          createdAt,
          updatedAt: createdAt,
        },
      });
    }
  }
  console.log("  ✓ draft unsigned notes");

  // Treatment plans due for review
  for (const spec of PLAN_SPECS) {
    const client = await ensureClient(
      org,
      location?.id ?? null,
      spec.emailLocal,
      spec.clientName,
      clinician?.id
    );
    const reviewDueAt = new Date();
    reviewDueAt.setDate(reviewDueAt.getDate() + spec.daysUntilReview);
    reviewDueAt.setHours(12, 0, 0, 0);

    const existing = await prisma.treatmentPlan.findFirst({
      where: { organizationId: org.id, clientId: client.id, title: spec.title },
    });
    if (existing) {
      await prisma.treatmentPlan.update({
        where: { id: existing.id },
        data: {
          status: TreatmentPlanStatus.ACTIVE,
          diagnosisCodes: spec.codes,
          reviewDueAt,
          clinicianId: clinician?.id,
        },
      });
    } else {
      await prisma.treatmentPlan.create({
        data: {
          organizationId: org.id,
          clientId: client.id,
          clinicianId: clinician?.id,
          title: spec.title,
          diagnosisCodes: spec.codes,
          status: TreatmentPlanStatus.ACTIVE,
          reviewDueAt,
        },
      });
    }
  }
  console.log("  ✓ treatment plans due");

  // Assessment due queue (module)
  const dueRows = [];
  for (const row of ASSESSMENT_DUE) {
    const client = await ensureClient(
      org,
      location?.id ?? null,
      row.emailLocal,
      row.clientName,
      clinician?.id
    );
    dueRows.push({
      id: row.id,
      clientId: client.id,
      clientName: shortName(client.name),
      tool: row.tool,
      dueLabel: row.dueLabel,
      overdue: row.overdue,
    });
  }
  await upsertModule(org.id, "assessment-due", dueRows);
  console.log(`  ✓ assessment-due (${dueRows.length})`);

  await upsertModule(org.id, "admin-audit-log", ADMIN_AUDIT);
  await upsertModule(org.id, "admin-integrations", ADMIN_INTEGRATIONS);
  await upsertModule(org.id, "admin-notification-rules", ADMIN_RULES);
  console.log("  ✓ admin modules");
}

function shortName(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

async function main() {
  const orgs = ORG_SLUG
    ? await prisma.organization.findMany({ where: { slug: ORG_SLUG } })
    : await prisma.organization.findMany({ orderBy: { slug: "asc" } });

  if (!orgs.length) throw new Error("No organizations found");

  for (const org of orgs) {
    await seedOrg(org);
  }
  console.log(`\nDone — therapist/admin home data for ${orgs.length} org(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
