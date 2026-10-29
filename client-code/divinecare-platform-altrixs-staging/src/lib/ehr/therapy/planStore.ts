/**
 * Server side of the therapist workflow: treatment plan gate, license level, treatment plan
 * template drafts, signatures (clinician → supervisor when pre-licensed → patient via the
 * portal) and the intake → plan pre-fill. Every query is scoped to the organization, and staff
 * reads use the same client access rules as the rest of the chart (caseload roles see only
 * their caseload).
 */
import { Prisma, type Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere, clientOrgFilter } from '@/lib/clients/orgScope';
import { getModuleData, saveModuleData } from '@/lib/modules/manage';
import { loadPracticeSettings } from '@/lib/practice/store';
import { addCalendarDays, clinicDate } from '@/lib/workflows/dates';
import { ageOn, isoDate } from '@/lib/ehr/psychMedMgmt';
import { normalizeNoteType } from '@/lib/ehr/noteTemplates';
import { resolveNoteMeta } from '@/lib/clients/notes';
import { cosignQueueScope, decideCosignScope, hasCosignAuthority } from '@/lib/notes/transitions';
import { isClientOnCaseload, loadSuperviseeIds } from '@/lib/notes/cosignScope';
import { clientPhiBlock } from '@/lib/privacy/lockedRows';
import { verifiedMedicalDirector } from '@/lib/auth/medicalDirector';
import { parsePlanSource, type ImportedPlanSource } from '@/lib/migration/valantTreatmentPlans';
import {
  chartDiagnosesForPlan,
  isTreatmentPlanDocument,
  rewriteDiagnoses,
  suggestPlanGoalsFromText,
  type ChartDiagnosis,
  type GoalSuggestions,
} from '@/lib/ehr/importedPlans';
import {
  DEFAULT_THERAPY_WORKFLOW_SETTINGS,
  noteRequiresTreatmentPlan,
  asPatientSignatureStatus,
  defaultReviewDays,
  reviewDaysNoteText,
  isValantClient,
  parseTherapyWorkflowSettings,
  patientSignatureTransition,
  planActivity,
  resolveLicenseLevel,
  supervisorSignatureRequired,
  treatmentPlanGate,
  type LicenseLevel,
  type PlanGateResult,
  type PlanSignatureState,
  type TherapyWorkflowSettings,
} from '@/lib/ehr/therapy/rules';
import {
  TREATMENT_PLAN_TEMPLATE_ID,
  TREATMENT_PLAN_TEMPLATE_VERSION,
  initialPlanValues,
  planFieldsFromValues,
  planGoals,
  prefillFromIntakeBody,
  renderTreatmentPlanText,
  sanitizePlanValues,
  templateValuesFromGoalsJson,
  treatmentPlanBlockers,
  type IntakePrefill,
} from '@/lib/ehr/therapy/planTemplate';
import type { Values } from '@/lib/ehr/therapy/engine';
import { SUD_INTAKE, THERAPY_INTAKE, THERAPY_PROGRESS, TS } from '@/lib/ehr/therapy/sections';
import { structuredNoteSections } from '@/lib/ehr/noteTemplates';
import {
  goalProgressHistory,
  libraryEditViolation,
  planProblems,
  walkNodes,
  type GoalProgressEntry,
  type PlanProgress,
} from '@/lib/ehr/therapy/planHierarchy';
import {
  attestationFor,
  buildPlanDocument,
  buildSignatureBlocks,
  parseOtherSignatures,
  parsePlanDocument,
  planInsurances,
  renderPlanDocumentText,
  type OtherSignature,
  type PersonSignerRole,
  type PlanDocument,
  type SignatureBlock,
} from '@/lib/ehr/therapy/planDocument';
import { libraryText, loadLibraries } from '@/lib/ehr/therapy/libraryStore';
import { planReviewReminder, type ReviewReminder } from '@/lib/ehr/therapy/rules';
import { clientReviewDays } from '@/lib/ehr/therapy/reviewInterval';
import { valantPatientName } from '@/lib/clients/legalName';

export type StaffActor = { organizationId: string; actorUserId: string; actorRole: Role };
type Fail = { ok: false; status: number; error: string };

const SETTINGS_MODULE = 'therapy-workflow';

// ─── Settings ───────────────────────────────────────────────────────────────

export async function getTherapyWorkflowSettings(organizationId: string): Promise<TherapyWorkflowSettings> {
  try {
    return parseTherapyWorkflowSettings(await getModuleData(organizationId, SETTINGS_MODULE));
  } catch {
    return { ...DEFAULT_THERAPY_WORKFLOW_SETTINGS };
  }
}

export async function saveTherapyWorkflowSettings(organizationId: string, input: Partial<TherapyWorkflowSettings>) {
  const current = await getTherapyWorkflowSettings(organizationId);
  const next = parseTherapyWorkflowSettings({ ...current, ...input });
  await saveModuleData(organizationId, SETTINGS_MODULE, next);
  return next;
}

// ─── License level ──────────────────────────────────────────────────────────

export async function loadLicenseLevel(organizationId: string, userId: string): Promise<{ level: LicenseLevel; source: string }> {
  const [user, onTrack] = await Promise.all([
    prisma.user.findFirst({
      where: { id: userId },
      select: {
        licenseLevel: true,
        staffCredentials: {
          where: { credentialType: { in: ['LICENSE', 'CERTIFICATION', 'SUPERVISION'] }, status: { not: 'EXPIRED' } },
          select: { title: true },
        },
      },
    }),
    prisma.supervisionTrack
      .findFirst({ where: { organizationId, superviseeId: userId }, select: { id: true } })
      .then(Boolean)
      .catch(() => false),
  ]);
  return resolveLicenseLevel({
    explicit: user?.licenseLevel ?? null,
    credentialTitles: (user?.staffCredentials || []).map((c) => c.title),
    onSupervisionTrack: onTrack,
  });
}

async function isDesignatedSupervisor(organizationId: string, supervisorId: string, superviseeId: string | null): Promise<boolean> {
  if (!superviseeId) return false;
  try {
    return Boolean(await prisma.supervisionTrack.findFirst({ where: { organizationId, supervisorId, superviseeId }, select: { id: true } }));
  } catch {
    return false;
  }
}

async function displayName(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
  return u?.name?.trim() || u?.email || 'Staff member';
}

// ─── Plan gate ──────────────────────────────────────────────────────────────

const planGateSelect = {
  id: true,
  title: true,
  status: true,
  reviewDueAt: true,
  clinicianSignedAt: true,
  supervisorRequired: true,
  supervisorSignedAt: true,
  patientSignatureStatus: true,
  goals: true,
  createdAt: true,
} satisfies Prisma.TreatmentPlanSelect;

type GateRow = Prisma.TreatmentPlanGetPayload<{ select: typeof planGateSelect }>;

function toSignatureState(p: GateRow): PlanSignatureState {
  return {
    id: p.id,
    title: p.title,
    status: p.status,
    reviewDueAt: p.reviewDueAt,
    clinicianSignedAt: p.clinicianSignedAt,
    supervisorRequired: p.supervisorRequired,
    supervisorSignedAt: p.supervisorSignedAt,
    patientSignatureStatus: p.patientSignatureStatus,
    imported: Boolean(parsePlanSource(p.goals)),
  };
}

async function clientPlans(organizationId: string, clientId: string): Promise<GateRow[]> {
  return prisma.treatmentPlan.findMany({
    where: { organizationId, clientId, status: { not: 'CLOSED' } },
    select: planGateSelect,
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
}

/**
 * Server check used when a note is signed. Org-scoped only (the caller already verified the
 * note and client belong to the actor's organization and caseload).
 */
export async function checkTreatmentPlanGate(input: {
  organizationId: string;
  clientId: string;
  noteType: string | null;
  cptCode: string | null;
}): Promise<PlanGateResult> {
  const noteType = input.noteType ? normalizeNoteType(input.noteType) : null;
  // Notes that never need a plan (intake, crisis, med management, …) do not touch the plan tables
  if (!noteRequiresTreatmentPlan({ noteType, cptCode: input.cptCode })) {
    return { ok: true, required: false, planId: null, message: 'No treatment plan needed for this note.' };
  }
  const settings = await getTherapyWorkflowSettings(input.organizationId);
  if (!settings.requirePlanForProgressNotes) {
    return { ok: true, required: false, planId: null, message: 'Treatment plan requirement is switched off for this practice.' };
  }
  const [plans, valantClient] = await Promise.all([
    clientPlans(input.organizationId, input.clientId),
    isValantClientId(input.organizationId, input.clientId),
  ]);
  return treatmentPlanGate({
    noteType,
    cptCode: input.cptCode,
    plans: plans.map(toSignatureState),
    today: clinicDate(),
    settings,
    valantClient,
  });
}

/** Go-live transition eligibility: the client's care started in Valant (Client.sourcePlatform). */
async function isValantClientId(organizationId: string, clientId: string): Promise<boolean> {
  const client = await prisma.client.findFirst({
    where: { id: clientId, ...clientOrgFilter(organizationId) },
    select: { sourcePlatform: true },
  });
  return isValantClient(client);
}

// ─── Go-live transition: notes signed with the plan pending ─────────────────

export type PlanPendingClient = {
  clientId: string;
  clientName: string;
  /** Notes signed under the transition for this client */
  noteCount: number;
  lastSignedAt: string | null;
  /** Last day of the transition stamped on the latest note */
  until: string;
  authorNames: string[];
};

/**
 * Clients with a note signed under the go-live transition ("Treatment plan pending") who still
 * have no active plan. Uses the same client access rules as the chart; `authorId` narrows to
 * one clinician's notes (their Inbox).
 */
export async function listPlanPendingClients(actor: StaffActor, opts: { authorId?: string } = {}): Promise<PlanPendingClient[]> {
  const rows = await prisma.progressNoteWorkflow.findMany({
    where: {
      planPendingUntil: { not: null },
      status: { in: ['SIGNED', 'LOCKED'] },
      ...(opts.authorId ? { OR: [{ signedById: opts.authorId }, { clinicianId: opts.authorId }] } : {}),
      note: { client: clientAccessWhere(actor) },
    },
    select: {
      clientId: true,
      signedAt: true,
      planPendingUntil: true,
      signedByName: true,
      clinicianName: true,
      note: { select: { client: { select: { name: true } } } },
    },
    orderBy: { signedAt: 'desc' },
    take: 2000,
  });
  if (!rows.length) return [];
  const byClient = new Map<string, PlanPendingClient>();
  for (const r of rows) {
    const entry = byClient.get(r.clientId);
    const author = r.signedByName || r.clinicianName;
    if (entry) {
      entry.noteCount += 1;
      if (author && !entry.authorNames.includes(author)) entry.authorNames.push(author);
      continue;
    }
    byClient.set(r.clientId, {
      clientId: r.clientId,
      clientName: r.note.client.name,
      noteCount: 1,
      lastSignedAt: r.signedAt?.toISOString() ?? null,
      until: r.planPendingUntil!.toISOString().slice(0, 10),
      authorNames: author ? [author] : [],
    });
  }
  // Drop clients who now have an active plan (the plan was written)
  const settings = await getTherapyWorkflowSettings(actor.organizationId);
  const today = clinicDate();
  const plans = await prisma.treatmentPlan.findMany({
    where: { organizationId: actor.organizationId, clientId: { in: [...byClient.keys()] }, status: { not: 'CLOSED' } },
    select: { ...planGateSelect, clientId: true },
  });
  for (const p of plans) {
    if (planActivity(toSignatureState(p), { today, requirePatientSignature: settings.requirePatientSignature }).active) byClient.delete(p.clientId);
  }
  return [...byClient.values()].sort((a, b) => a.until.localeCompare(b.until) || a.clientName.localeCompare(b.clientName));
}

export type PlanStatusSummary = {
  id: string;
  title: string;
  status: string;
  planKind: string;
  reviewDueAt: string | null;
  clinicianSignedAt: string | null;
  clinicianSignedByName: string | null;
  supervisorRequired: boolean;
  supervisorSignedAt: string | null;
  supervisorSignedByName: string | null;
  patientSignatureStatus: string;
  patientSentAt: string | null;
  patientSignedAt: string | null;
  patientSignedName: string | null;
  patientDeclinedAt: string | null;
  patientDeclineReason: string | null;
  patientVerbalBy: string | null;
  activity: ReturnType<typeof planActivity>;
  hasTemplate: boolean;
  goals: { id: string; text: string; objectives: string[]; progress?: PlanProgress; history?: GoalProgressEntry[] }[];
};

const statusSelect = {
  ...planGateSelect,
  planKind: true,
  clinicianSignedById: true,
  clinicianSignedByName: true,
  supervisorSignedByName: true,
  patientSentAt: true,
  patientSignedAt: true,
  patientSignedName: true,
  patientDeclinedAt: true,
  patientDeclineReason: true,
  patientVerbalBy: true,
  clinicianId: true,
  clientId: true,
} satisfies Prisma.TreatmentPlanSelect;

type StatusRow = Prisma.TreatmentPlanGetPayload<{ select: typeof statusSelect }>;

export function goalsSummary(goals: unknown): { id: string; text: string; objectives: string[]; progress?: PlanProgress }[] {
  const values = templateValuesFromGoalsJson(goals);
  if (values) {
    return planGoals(values)
      .filter((g) => g.goal)
      .map((g) => ({ id: g.id, text: g.goal, objectives: g.objectives.filter((o) => o.text).map((o) => o.text), progress: g.progress || undefined }));
  }
  const items = goals && typeof goals === 'object' && !Array.isArray(goals) ? (goals as { items?: unknown }).items : null;
  return (Array.isArray(items) ? items : [])
    .filter((g): g is Record<string, unknown> => Boolean(g) && typeof g === 'object' && typeof (g as { text?: unknown }).text === 'string')
    .map((g, i) => ({
      id: typeof g.id === 'string' && g.id ? g.id : `G${i + 1}`,
      text: String(g.text),
      objectives: Array.isArray(g.objectives) ? g.objectives.filter((o): o is string => typeof o === 'string') : [],
    }))
    .filter((g) => g.text.trim());
}

function summarize(p: StatusRow, settings: TherapyWorkflowSettings, today: string): PlanStatusSummary {
  const iso = (d: Date | null) => d?.toISOString() ?? null;
  return {
    id: p.id,
    title: p.title,
    status: p.status,
    planKind: p.planKind,
    reviewDueAt: iso(p.reviewDueAt),
    clinicianSignedAt: iso(p.clinicianSignedAt),
    clinicianSignedByName: p.clinicianSignedByName,
    supervisorRequired: p.supervisorRequired,
    supervisorSignedAt: iso(p.supervisorSignedAt),
    supervisorSignedByName: p.supervisorSignedByName,
    patientSignatureStatus: asPatientSignatureStatus(p.patientSignatureStatus),
    patientSentAt: iso(p.patientSentAt),
    patientSignedAt: iso(p.patientSignedAt),
    patientSignedName: p.patientSignedName,
    patientDeclinedAt: iso(p.patientDeclinedAt),
    patientDeclineReason: p.patientDeclineReason,
    patientVerbalBy: p.patientVerbalBy,
    activity: planActivity(toSignatureState(p), { today, requirePatientSignature: settings.requirePatientSignature }),
    hasTemplate: Boolean(templateValuesFromGoalsJson(p.goals)),
    goals: goalsSummary(p.goals),
  };
}

/** Treatment plan status for one client (progress note editor, chart, plan page). */
export async function loadClientPlanStatus(actor: StaffActor, clientId: string, opts: { noteType?: string | null; cptCode?: string | null } = {}) {
  const client = await prisma.client.findFirst({ where: { id: clientId, ...clientAccessWhere(actor) }, select: { id: true, sourcePlatform: true } });
  if (!client) return { ok: false as const, status: 404, error: 'Client not found' };
  const settings = await getTherapyWorkflowSettings(actor.organizationId);
  const today = clinicDate();
  const rows = await prisma.treatmentPlan.findMany({
    where: { organizationId: actor.organizationId, clientId: client.id, status: { not: 'CLOSED' } },
    select: statusSelect,
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  const plans = rows.map((r) => summarize(r, settings, today));
  const gate = treatmentPlanGate({
    noteType: opts.noteType ?? 'Therapy Progress',
    cptCode: opts.cptCode ?? null,
    plans: rows.map(toSignatureState),
    today,
    settings,
    valantClient: isValantClient(client),
  });
  const active = plans.find((p) => p.activity.active) ?? null;
  if (active && active.goals.length) {
    const since = rows.find((r) => r.id === active.id)?.clinicianSignedAt ?? null;
    const history = await loadGoalProgressHistory(client.id, active.goals, since).catch(() => ({}) as Record<string, GoalProgressEntry[]>);
    active.goals = active.goals.map((g) => ({ ...g, history: history[g.id] ?? [] }));
  }
  return { ok: true as const, settings, gate, active, plans };
}

/**
 * Goal progress ratings from the client's signed Therapy Progress notes (newest first), matched
 * to the plan's goals by goal text. `since` limits to notes after the plan was signed.
 */
async function loadGoalProgressHistory(clientId: string, goals: { id: string; text: string }[], since: Date | null): Promise<Record<string, GoalProgressEntry[]>> {
  const notes = await prisma.progressNote.findMany({
    where: { clientId, workflow: { status: { in: ['SIGNED', 'LOCKED'] } }, ...(since ? { createdAt: { gte: new Date(since.getTime() - 86_400_000) } } : {}) },
    include: { workflow: { select: { status: true } } },
    orderBy: { createdAt: 'desc' },
    take: 60,
  });
  const parsed: { noteId: string; date: string; goalsText: string }[] = [];
  for (const n of notes) {
    const meta = resolveNoteMeta(n);
    if (normalizeNoteType(meta.noteType || '') !== THERAPY_PROGRESS) continue;
    const text = structuredNoteSections(THERAPY_PROGRESS, meta.displayBody)
      .filter((x) => x.title === TS.planGoals)
      .map((x) => x.text)
      .join('\n');
    if (text) parsed.push({ noteId: n.id, date: meta.dateOfService || n.createdAt.toISOString().slice(0, 10), goalsText: text });
  }
  return goalProgressHistory(goals, parsed);
}

// ─── Intake → plan pre-fill ─────────────────────────────────────────────────

const INTAKE_TYPES = new Set<string>([THERAPY_INTAKE, SUD_INTAKE]);

/** Most recent signed therapist intake (or the given note) as plan pre-fill; null when none. */
async function findIntakePrefill(clientId: string, noteId: string | null): Promise<IntakePrefill | null> {
  const notes = await prisma.progressNote.findMany({
    where: { clientId, ...(noteId ? { id: noteId } : {}) },
    include: { workflow: { select: { status: true } } },
    orderBy: { createdAt: 'desc' },
    take: noteId ? 1 : 40,
  });
  for (const n of notes) {
    const meta = resolveNoteMeta(n);
    const type = normalizeNoteType(meta.noteType || '');
    if (!INTAKE_TYPES.has(type)) continue;
    if (!n.workflow || n.workflow.status === 'DRAFT') continue;
    return prefillFromIntakeBody({
      noteId: n.id,
      noteType: type as typeof THERAPY_INTAKE,
      date: meta.dateOfService || n.createdAt.toISOString().slice(0, 10),
      body: meta.displayBody,
    });
  }
  return null;
}

// ─── Imported Valant plans: chart diagnoses, filed plan documents, rewrite ──

export type ValantPlanDocument = { id: string; name: string; filedAt: string | null; url: string | null; hasText: boolean };

/** The client's diagnoses from the chart (client record + active problem list). */
async function loadChartDiagnoses(clientId: string): Promise<ChartDiagnosis[]> {
  const [client, problems] = await Promise.all([
    prisma.client.findUnique({ where: { id: clientId }, select: { primaryDiagnosis: true, primaryDiagnosisCode: true, secondaryDiagnoses: true } }),
    prisma.medicalProblem
      .findMany({
        where: { clientId, status: { equals: 'active', mode: 'insensitive' } },
        select: { icd10Code: true, name: true, status: true },
        orderBy: { createdAt: 'asc' },
        take: 30,
      })
      .catch(() => []),
  ]);
  if (!client) return [];
  return chartDiagnosesForPlan(client, problems);
}

function intakeTitle(fields: unknown): string | null {
  const list = Array.isArray(fields) ? (fields as { label?: unknown; value?: unknown }[]) : [];
  const hit = list.find((f) => f && f.label === 'Title' && typeof f.value === 'string');
  return hit ? String(hit.value) : null;
}

/**
 * Treatment plan documents filed to this chart through Smart Doc Intake (e.g. the Valant plan
 * PDFs). The caller has already checked the client is in the actor's organization and caseload.
 */
async function loadValantPlanDocuments(organizationId: string, clientId: string): Promise<ValantPlanDocument[]> {
  const docs = await prisma.documentIntake.findMany({
    where: { suggestedClientId: clientId, status: 'filed', OR: [{ organizationId }, { organizationId: null }] },
    select: { id: true, documentType: true, fileName: true, extractedFields: true, filedAt: true, createdAt: true, s3RawKey: true },
    orderBy: { filedAt: 'desc' },
    take: 100,
  });
  const plans = docs.filter((d) => isTreatmentPlanDocument({ documentType: d.documentType, title: intakeTitle(d.extractedFields), fileName: d.fileName }));
  if (!plans.length) return [];
  const withText = new Set(
    (
      await prisma.documentIntake.findMany({
        where: { id: { in: plans.map((d) => d.id) }, extractedText: { not: null } },
        select: { id: true },
      })
    ).map((d) => d.id)
  );
  return plans.map((d) => ({
    id: d.id,
    name: intakeTitle(d.extractedFields) || d.fileName || d.documentType,
    filedAt: (d.filedAt ?? d.createdAt).toISOString().slice(0, 10),
    url: d.s3RawKey && d.s3RawKey !== 'pending' && d.fileName ? `/api/files/intake-docs/${d.s3RawKey}` : null,
    hasText: withText.has(d.id),
  }));
}

/** An open (not closed) plan written in Altrixs that replaces this imported plan. */
async function findRewriteDraft(organizationId: string, clientId: string, importedPlanId: string): Promise<string | null> {
  const row = await prisma.treatmentPlan.findFirst({
    where: { organizationId, clientId, supersedesId: importedPlanId, status: { not: 'CLOSED' } },
    select: { id: true },
    orderBy: { createdAt: 'desc' },
  });
  return row?.id ?? null;
}

export type ImportedPlanContext = { chartDiagnoses: ChartDiagnosis[]; documents: ValantPlanDocument[]; rewriteDraftId: string | null };

/** Chart diagnoses, filed Valant plan documents and any rewrite draft, for a plan imported from Valant. */
export async function loadImportedPlanContext(actor: StaffActor, planId: string): Promise<{ ok: true; clientId: string; context: ImportedPlanContext } | Fail> {
  const plan = await prisma.treatmentPlan.findFirst({
    where: { id: planId, organizationId: actor.organizationId, client: clientAccessWhere(actor) },
    select: { id: true, clientId: true, goals: true },
  });
  if (!plan) return { ok: false, status: 404, error: 'Treatment plan not found' };
  if (!parsePlanSource(plan.goals)) return { ok: false, status: 409, error: 'This plan was not imported from Valant.' };
  const [chartDiagnoses, documents, rewriteDraftId] = await Promise.all([
    loadChartDiagnoses(plan.clientId),
    loadValantPlanDocuments(actor.organizationId, plan.clientId),
    findRewriteDraft(actor.organizationId, plan.clientId, plan.id),
  ]);
  return { ok: true, clientId: plan.clientId, context: { chartDiagnoses, documents, rewriteDraftId } };
}

/**
 * Goal / objective / intervention suggestions read from a filed Valant plan document's OCR text.
 * Suggestions only (with the quoted source lines); nothing is saved.
 */
export async function loadDocumentGoalSuggestions(
  actor: StaffActor,
  input: { clientId: string; documentId: string }
): Promise<{ ok: true; document: { id: string; name: string }; suggestions: GoalSuggestions } | Fail> {
  const client = await prisma.client.findFirst({ where: { id: input.clientId, ...clientAccessWhere(actor) }, select: { id: true } });
  if (!client) return { ok: false, status: 404, error: 'Client not found' };
  const doc = await prisma.documentIntake.findFirst({
    where: { id: input.documentId, suggestedClientId: client.id, status: 'filed', OR: [{ organizationId: actor.organizationId }, { organizationId: null }] },
    select: { id: true, documentType: true, fileName: true, extractedFields: true, extractedText: true },
  });
  if (!doc) return { ok: false, status: 404, error: 'Document not found on this chart' };
  const title = intakeTitle(doc.extractedFields);
  if (!isTreatmentPlanDocument({ documentType: doc.documentType, title, fileName: doc.fileName })) {
    return { ok: false, status: 409, error: 'This document is not filed as a treatment plan.' };
  }
  if (!doc.extractedText?.trim()) {
    return { ok: false, status: 409, error: 'No text has been read from this document yet (OCR not run, or the scan is unreadable).' };
  }
  return { ok: true, document: { id: doc.id, name: title || doc.fileName || doc.documentType }, suggestions: suggestPlanGoalsFromText(doc.extractedText) };
}

export type RewriteContext = {
  importedPlanId: string;
  source: ImportedPlanSource;
  reviewDueAt: string | null;
  status: string;
  chartDiagnoses: ChartDiagnosis[];
  documents: ValantPlanDocument[];
};

export type PlanEditorContext = {
  client: { id: string; name: string; displayName: string; dateOfBirth: string | null; age: number | null; minor: boolean };
  /** Library editing rules (practice settings) */
  libraryRules: { libraryEditBeforeActive: boolean; libraryEditAfterActive: boolean };
  /** Review: goal ratings from signed progress notes on the plan being reviewed, by goal id */
  progressHistory: Record<string, GoalProgressEntry[]>;
  clinicianName: string | null;
  licenseLevel: LicenseLevel;
  defaultReviewDate: string;
  maxReviewDate: string;
  reviewDaysNote: string;
  intake: IntakePrefill | null;
  activePlan: { id: string; title: string } | null;
  /** Draft being edited, or starting values for a new plan */
  plan: { id: string | null; status: string; supersedesId: string | null; sourceNoteId: string | null; values: Values; signed: boolean };
  /** Writing this plan in Altrixs to replace a plan imported from Valant */
  rewrite: RewriteContext | null;
};

/**
 * Everything the Treatment Plan editor needs: the client, the default review date, and either
 * the draft being edited or starting values (from the signed intake for an initial plan, from
 * the active plan for a review).
 */
export async function loadPlanEditorContext(
  actor: StaffActor,
  input: { clientId: string; planId?: string | null; kind?: 'Initial' | 'Review'; fromNoteId?: string | null; rewriteOf?: string | null }
): Promise<{ ok: true; context: PlanEditorContext } | Fail> {
  const client = await prisma.client.findFirst({
    where: { id: input.clientId, ...clientAccessWhere(actor) },
    select: { id: true, name: true, dateOfBirth: true, mrn: true, legalFirstName: true, middleInitial: true, legalLastName: true, preferredName: true, nameSuffix: true },
  });
  if (!client) return { ok: false, status: 404, error: 'Client not found' };
  const today = clinicDate();
  const dob = client.dateOfBirth ? client.dateOfBirth.toISOString() : null;
  const age = ageOn(dob, today);
  const workflow = await getTherapyWorkflowSettings(actor.organizationId);
  const [practice, license, me] = await Promise.all([
    loadPracticeSettings(actor.organizationId).catch(() => null),
    loadLicenseLevel(actor.organizationId, actor.actorUserId),
    prisma.user.findUnique({ where: { id: actor.actorUserId }, select: { name: true } }),
  ]);
  const days = defaultReviewDays(age, practice?.treatmentPlanReviewDays ?? null);
  const defaultReviewDate = addCalendarDays(today, days);
  const status = await loadClientPlanStatus(actor, client.id);
  const activePlan = status.ok && status.active ? { id: status.active.id, title: status.active.title } : null;

  const intake = await findIntakePrefill(client.id, input.fromNoteId ?? null);

  // Rewrite of an imported Valant plan: from ?rewriteOf=, or a draft that already supersedes one
  const loadRewrite = async (importedId: string): Promise<RewriteContext | null> => {
    const imported = await prisma.treatmentPlan.findFirst({
      where: { id: importedId, organizationId: actor.organizationId, clientId: client.id },
      select: { id: true, goals: true, reviewDueAt: true, status: true },
    });
    const source = imported ? parsePlanSource(imported.goals) : null;
    if (!imported || !source) return null;
    const [chartDiagnoses, documents] = await Promise.all([loadChartDiagnoses(client.id), loadValantPlanDocuments(actor.organizationId, client.id)]);
    return { importedPlanId: imported.id, source, reviewDueAt: imported.reviewDueAt?.toISOString() ?? null, status: imported.status, chartDiagnoses, documents };
  };
  let rewrite: RewriteContext | null = null;

  let plan: PlanEditorContext['plan'];
  if (input.planId) {
    const row = await prisma.treatmentPlan.findFirst({
      where: { id: input.planId, organizationId: actor.organizationId, clientId: client.id },
      select: { id: true, status: true, goals: true, supersedesId: true, sourceNoteId: true, clinicianSignedAt: true },
    });
    if (!row) return { ok: false, status: 404, error: 'Treatment plan not found' };
    const values = templateValuesFromGoalsJson(row.goals);
    if (!values) return { ok: false, status: 409, error: 'This plan was not made with the Treatment Plan template. Edit it on the Treatment Plans page.' };
    plan = { id: row.id, status: row.status, supersedesId: row.supersedesId, sourceNoteId: row.sourceNoteId, values, signed: Boolean(row.clinicianSignedAt) };
    if (row.supersedesId) rewrite = await loadRewrite(row.supersedesId);
  } else if (input.rewriteOf) {
    rewrite = await loadRewrite(input.rewriteOf);
    if (!rewrite) return { ok: false, status: 404, error: 'Imported Valant plan not found for this client' };
    if (rewrite.status === 'CLOSED') return { ok: false, status: 409, error: 'This Valant plan is already closed (replaced by a plan written in Altrixs).' };
    const existingDraft = await findRewriteDraft(actor.organizationId, client.id, rewrite.importedPlanId);
    // A rewrite already started: open it instead of starting a second one
    if (existingDraft) return loadPlanEditorContext(actor, { clientId: client.id, planId: existingDraft });
    // New Altrixs plan pre-filled from the signed intake and the chart's diagnoses. Valant's goals
    // are not in the export: suggestions from a filed plan document are offered separately.
    const values = initialPlanValues({ kind: 'Initial', intake, priorValues: null, reviewDate: defaultReviewDate, startDate: today });
    values.diagnoses = rewriteDiagnoses(intake?.diagnoses ?? [], rewrite.chartDiagnoses);
    plan = { id: null, status: 'DRAFT', supersedesId: rewrite.importedPlanId, sourceNoteId: intake?.noteId ?? null, values, signed: false };
  } else {
    const kind = input.kind === 'Review' ? 'Review' : 'Initial';
    let priorValues: Values | null = null;
    if (kind === 'Review' && activePlan) {
      const prior = await prisma.treatmentPlan.findFirst({ where: { id: activePlan.id, organizationId: actor.organizationId }, select: { goals: true } });
      priorValues = templateValuesFromGoalsJson(prior?.goals);
    }
    plan = {
      id: null,
      status: 'DRAFT',
      supersedesId: kind === 'Review' ? activePlan?.id ?? null : null,
      sourceNoteId: kind === 'Initial' ? intake?.noteId ?? null : null,
      values: initialPlanValues({ kind, intake: kind === 'Initial' ? intake : null, priorValues, reviewDate: defaultReviewDate, startDate: today }),
      signed: false,
    };
  }
  // Review: what progress notes recorded on each goal of the plan being reviewed
  let progressHistory: Record<string, GoalProgressEntry[]> = {};
  if (plan.supersedesId && !rewrite && status.ok) {
    const reviewed = status.plans.find((p) => p.id === plan.supersedesId);
    if (reviewed?.goals.length) {
      const signedAt = reviewed.clinicianSignedAt ? new Date(reviewed.clinicianSignedAt) : null;
      progressHistory = await loadGoalProgressHistory(client.id, reviewed.goals, signedAt).catch(() => ({}));
    }
  }
  return {
    ok: true,
    context: {
      client: {
        id: client.id,
        name: client.name,
        displayName: valantPatientName({ ...client, patientId: client.mrn }),
        dateOfBirth: dob ? isoDate(dob) : null,
        age,
        minor: age != null && age < 18,
      },
      libraryRules: { libraryEditBeforeActive: workflow.libraryEditBeforeActive, libraryEditAfterActive: workflow.libraryEditAfterActive },
      progressHistory,
      clinicianName: me?.name ?? null,
      licenseLevel: license.level,
      defaultReviewDate,
      // Latest allowed = the same rule as the default (adults <= 180 per Practice Settings, under 18 <= 90)
      maxReviewDate: addCalendarDays(today, days),
      reviewDaysNote: reviewDaysNoteText(days, age, practice?.treatmentPlanReviewDays ?? null),
      intake,
      activePlan,
      plan,
      rewrite,
    },
  };
}

// ─── Draft save ─────────────────────────────────────────────────────────────

function planTitle(kind: 'INITIAL' | 'REVIEW', date: string) {
  return `${kind === 'REVIEW' ? 'Treatment Plan Review' : 'Treatment Plan'} — ${date}`;
}

function reviewDateOk(value: string | null, today: string, maxDays: number): { ok: true; date: Date } | { ok: false; error: string } {
  if (!value) return { ok: false, error: 'Set the next plan review date.' };
  if (value < today || value > addCalendarDays(today, maxDays)) {
    return { ok: false, error: `Set the review date between today and ${maxDays} days from today.` };
  }
  return { ok: true, date: new Date(`${value}T12:00:00Z`) };
}

/** Create or update a template plan draft. Signed plans are never changed here. */
export async function saveTemplatePlanDraft(
  actor: StaffActor,
  input: { clientId: string; planId?: string | null; values: unknown; supersedesId?: string | null; sourceNoteId?: string | null }
): Promise<{ ok: true; planId: string } | Fail> {
  const client = await prisma.client.findFirst({ where: { id: input.clientId, ...clientAccessWhere(actor) }, select: { id: true } });
  if (!client) return { ok: false, status: 404, error: 'Client not found' };
  const values = sanitizePlanValues(input.values);
  const fields = planFieldsFromValues(values);
  const today = clinicDate();
  const libraryError = await checkLibraryRules(actor, values, input.planId ?? null, input.supersedesId ?? null);
  if (libraryError) return { ok: false, status: 400, error: libraryError };
  const interval = await clientReviewDays(actor.organizationId, client.id, today);
  const review = fields.reviewDate ? reviewDateOk(fields.reviewDate, today, interval.days) : null;
  if (review && review.ok === false) return { ok: false, status: 400, error: review.error };
  const goalsJson = {
    secondaryDx: fields.secondaryDx ?? undefined,
    clientSigned: false,
    clinicalDetails: fields.clinicalDetails,
    items: fields.goals,
    template: { id: TREATMENT_PLAN_TEMPLATE_ID, version: TREATMENT_PLAN_TEMPLATE_VERSION, values },
  } as Prisma.InputJsonValue;
  const data = {
    title: planTitle(fields.planKind, today),
    planKind: fields.planKind,
    diagnosisCodes: fields.diagnosisCodes,
    presentingProblems: fields.presentingProblems,
    strengths: fields.strengths,
    reviewDueAt: review && review.ok ? review.date : null,
    goals: goalsJson,
  };
  if (input.planId) {
    const existing = await prisma.treatmentPlan.findFirst({
      where: { id: input.planId, organizationId: actor.organizationId, clientId: client.id },
      select: { id: true, clinicianSignedAt: true, status: true },
    });
    if (!existing) return { ok: false, status: 404, error: 'Treatment plan not found' };
    if (existing.clinicianSignedAt || existing.status !== 'DRAFT') {
      return { ok: false, status: 409, error: 'This plan is signed. Reopen it to edit (signatures are cleared) or start a Treatment Plan Review.' };
    }
    await prisma.treatmentPlan.update({ where: { id: existing.id }, data });
    return { ok: true, planId: existing.id };
  }
  let supersedesId: string | null = null;
  if (input.supersedesId) {
    const prior = await prisma.treatmentPlan.findFirst({
      where: { id: input.supersedesId, organizationId: actor.organizationId, clientId: client.id },
      select: { id: true },
    });
    supersedesId = prior?.id ?? null;
  }
  let sourceNoteId: string | null = null;
  if (input.sourceNoteId) {
    const note = await prisma.progressNote.findFirst({ where: { id: input.sourceNoteId, clientId: client.id }, select: { id: true } });
    sourceNoteId = note?.id ?? null;
  }
  const row = await prisma.treatmentPlan.create({
    data: {
      ...data,
      organizationId: actor.organizationId,
      clientId: client.id,
      clinicianId: actor.actorUserId,
      status: 'DRAFT',
      supersedesId,
      sourceNoteId,
    },
    select: { id: true },
  });
  return { ok: true, planId: row.id };
}

/**
 * Library editing rules (Practice settings): locked library items keep their library text
 * (added on this draft) or the text of the plan they were copied from (plan review).
 */
async function checkLibraryRules(actor: StaffActor, values: Values, planId: string | null, supersedesIdInput: string | null): Promise<string | null> {
  const settings = await getTherapyWorkflowSettings(actor.organizationId);
  if (settings.libraryEditBeforeActive && settings.libraryEditAfterActive) return null;
  const problems = planProblems(values);
  if (!walkNodes(problems).some((n) => n.node.libraryId)) return null;
  let supersedesId = supersedesIdInput;
  if (planId) {
    const row = await prisma.treatmentPlan.findFirst({ where: { id: planId, organizationId: actor.organizationId }, select: { supersedesId: true } });
    supersedesId = row?.supersedesId ?? supersedesId;
  }
  const prior = supersedesId
    ? await prisma.treatmentPlan.findFirst({ where: { id: supersedesId, organizationId: actor.organizationId }, select: { goals: true } })
    : null;
  const priorValues = prior ? templateValuesFromGoalsJson(prior.goals) : null;
  const priorText = new Map(priorValues ? walkNodes(planProblems(priorValues)).map((n) => [n.node.id, n.node.text] as const) : []);
  const libs = await loadLibraries(actor.organizationId, actor.actorUserId);
  return libraryEditViolation(problems, settings, {
    library: (source, id) => libraryText(libs, source, id),
    prior: (id) => priorText.get(id) ?? null,
  });
}

// ─── Plan document (print view, portal) ─────────────────────────────────────

/** Template values for a plan written on the Treatment Plans page (no template), for the document. */
function legacyDocumentValues(plan: { diagnosisCodes?: string[]; reviewDueAt: Date | null; presentingProblems?: string | null; strengths?: string | null; goals: unknown; planKind?: string }): Values {
  const items = legacyItems(plan.goals);
  return {
    planKind: plan.planKind === 'REVIEW' ? 'Review' : 'Initial',
    diagnoses: (plan.diagnosisCodes || []).map((code, i) => ({ code, description: '', isPrimary: i === 0 })),
    presentingNeeds: plan.presentingProblems || '',
    tpStrengths: plan.strengths || '',
    reviewDate: plan.reviewDueAt ? plan.reviewDueAt.toISOString().slice(0, 10) : '',
    tpGoals: items.map((g, i) => ({
      id: `G${i + 1}`,
      goal: g.text,
      objectives: g.objectives.map((o) => {
        const m = o.match(/^(.*?)(?: \(target (\d{4}-\d{2}-\d{2})\))?$/);
        return { text: (m?.[1] ?? o).trim(), targetDate: m?.[2] ?? '' };
      }),
      interventions: g.interventions.map((detail) => ({ type: '', detail, frequency: '', responsible: '' })),
    })),
  };
}

async function documentInputs(organizationId: string, clientId: string) {
  const [client, coverages, practice] = await Promise.all([
    prisma.client.findUnique({
      where: { id: clientId },
      select: {
        name: true,
        legalFirstName: true,
        middleInitial: true,
        legalLastName: true,
        preferredName: true,
        nameSuffix: true,
        mrn: true,
        dateOfBirth: true,
        addressLine1: true,
        addressLine2: true,
        city: true,
        state: true,
        postalCode: true,
        phone: true,
        insurancePayer: true,
        insuranceMemberId: true,
        insuranceGroupNumber: true,
      },
    }),
    prisma.clientInsuranceCoverage
      .findMany({ where: { organizationId, clientId, active: true }, select: { rank: true, payerName: true, memberId: true, groupNumber: true, active: true } })
      .catch(() => []),
    loadPracticeSettings(organizationId).catch(() => null),
  ]);
  return { client, coverages, practice };
}

/** Build the plan document from the plan's current values (draft view, and the document frozen at signing). */
async function buildDocumentForPlan(
  organizationId: string,
  plan: { id: string; clientId: string; goals: unknown; diagnosisCodes?: string[]; reviewDueAt: Date | null; presentingProblems?: string | null; strengths?: string | null; planKind?: string; clinicianName: string | null },
  today: string,
  now: Date
): Promise<PlanDocument | null> {
  const { client, coverages, practice } = await documentInputs(organizationId, plan.clientId);
  if (!client) return null;
  const values = templateValuesFromGoalsJson(plan.goals) ?? legacyDocumentValues(plan);
  const dob = client.dateOfBirth ? client.dateOfBirth.toISOString() : null;
  const age = ageOn(dob, today);
  return buildPlanDocument({
    planId: plan.id,
    values,
    ctx: { minor: age != null && age < 18, telehealth: false },
    client: { ...client, dateOfBirth: dob ? isoDate(dob) : null },
    providerName: plan.clinicianName,
    practice: { name: practice?.dbaName || practice?.legalName || null, logoUrl: practice?.logoUrl ?? null },
    insurances: planInsurances(coverages, client),
    today,
    now,
  });
}

export type PlanDocumentView = {
  planId: string;
  clientId: string;
  title: string;
  status: string;
  /** Frozen at signing; a draft shows the current values */
  frozen: boolean;
  document: PlanDocument | null;
  /** Plans signed before the structured document: the signed text */
  signedText: string | null;
  signatures: SignatureBlock[];
};

const documentSelect = {
  id: true,
  clientId: true,
  title: true,
  status: true,
  goals: true,
  diagnosisCodes: true,
  reviewDueAt: true,
  presentingProblems: true,
  strengths: true,
  planKind: true,
  signedDocument: true,
  signedSnapshot: true,
  otherSignatures: true,
  clinicianSignedAt: true,
  clinicianSignedByName: true,
  supervisorRequired: true,
  supervisorSignedAt: true,
  supervisorSignedByName: true,
  patientSignatureStatus: true,
  patientSentAt: true,
  patientSignedAt: true,
  patientSignedName: true,
  patientDeclinedAt: true,
  patientDeclineReason: true,
  patientVerbalBy: true,
  clinician: { select: { name: true } },
} satisfies Prisma.TreatmentPlanSelect;

type DocumentRow = Prisma.TreatmentPlanGetPayload<{ select: typeof documentSelect }>;

async function documentView(organizationId: string, row: DocumentRow): Promise<PlanDocumentView> {
  const frozen = parsePlanDocument(row.signedDocument);
  const signed = Boolean(row.clinicianSignedAt);
  const live = !frozen && !signed ? await buildDocumentForPlan(organizationId, { ...row, clinicianName: row.clinician?.name ?? null }, clinicDate(), new Date()) : null;
  return {
    planId: row.id,
    clientId: row.clientId,
    title: row.title,
    status: row.status,
    frozen: Boolean(frozen),
    document: frozen ?? live,
    signedText: !frozen && signed ? row.signedSnapshot : null,
    signatures: buildSignatureBlocks(row, parseOtherSignatures(row.otherSignatures)),
  };
}

/** Plan document for staff (print / PDF view). Same client access rules as the chart. */
export async function loadPlanDocument(actor: StaffActor, planId: string): Promise<{ ok: true; view: PlanDocumentView } | Fail> {
  const row = await prisma.treatmentPlan.findFirst({
    where: { id: planId, organizationId: actor.organizationId, client: clientAccessWhere(actor) },
    select: documentSelect,
  });
  if (!row) return { ok: false, status: 404, error: 'Treatment plan not found' };
  if (parsePlanSource(row.goals)) return { ok: false, status: 409, error: 'This plan was imported from Valant; its document is the filed Valant plan (see the chart).' };
  return { ok: true, view: await documentView(actor.organizationId, row) };
}

// ─── Review reminders (Inbox) ───────────────────────────────────────────────

export type PlanReviewReminderItem = {
  planId: string;
  clientId: string;
  clientName: string;
  title: string;
  /** owner = the plan's clinician; supervisor = the author's licensure supervisor */
  audience: 'owner' | 'supervisor';
  reminder: ReviewReminder;
};

/**
 * Plans whose review is due within the reminder window (Valant: 7 days before, to the plan owner;
 * a supervisor reminder only when the practice sets one). Active / needs-review plans only, within
 * the actor's client access; imported Valant plans are listed for rewrite elsewhere.
 */
export async function listPlanReviewReminders(actor: StaffActor, opts: { today?: string } = {}): Promise<PlanReviewReminderItem[]> {
  const settings = await getTherapyWorkflowSettings(actor.organizationId);
  const today = opts.today ?? clinicDate();
  const maxDays = Math.max(settings.reviewReminderDays, settings.supervisorReminderDays ?? 0);
  const horizon = new Date(`${addCalendarDays(today, maxDays)}T23:59:59Z`);
  const supervisees =
    settings.supervisorReminderDays != null
      ? await prisma.supervisionTrack
          .findMany({ where: { organizationId: actor.organizationId, supervisorId: actor.actorUserId }, select: { superviseeId: true } })
          .then((r) => r.map((t) => t.superviseeId))
          .catch(() => [] as string[])
      : [];
  const rows = await prisma.treatmentPlan.findMany({
    where: {
      organizationId: actor.organizationId,
      status: { in: ['ACTIVE', 'NEEDS_REVIEW'] },
      reviewDueAt: { not: null, lte: horizon },
      clinicianSignedAt: { not: null },
      OR: [{ clinicianId: actor.actorUserId }, ...(supervisees.length ? [{ clinicianId: { in: supervisees } }] : [])],
      client: clientAccessWhere(actor),
    },
    select: { id: true, clientId: true, title: true, reviewDueAt: true, clinicianId: true, goals: true, client: { select: { name: true } } },
    orderBy: { reviewDueAt: 'asc' },
    take: 200,
  });
  // A review already started (draft superseding the plan) still shows: the review is not signed yet
  const out: PlanReviewReminderItem[] = [];
  for (const r of rows) {
    if (parsePlanSource(r.goals)) continue;
    const audience = r.clinicianId === actor.actorUserId ? 'owner' : 'supervisor';
    const days = audience === 'owner' ? settings.reviewReminderDays : settings.supervisorReminderDays;
    const reminder = planReviewReminder(r.reviewDueAt, today, days);
    if (reminder) out.push({ planId: r.id, clientId: r.clientId, clientName: r.client.name, title: r.title, audience, reminder });
  }
  return out;
}

// ─── Signatures ─────────────────────────────────────────────────────────────

const signSelect = {
  ...statusSelect,
  organizationId: true,
  supersedesId: true,
  diagnosisCodes: true,
  presentingProblems: true,
  strengths: true,
  signedSnapshot: true,
  otherSignatures: true,
  supervisorSignedById: true,
  updatedAt: true,
  client: { select: { id: true, name: true, dateOfBirth: true } },
  clinician: { select: { name: true } },
} satisfies Prisma.TreatmentPlanSelect;

type LegacyPlanInput = {
  title: string;
  planKind?: string;
  diagnosisCodes?: string[];
  presentingProblems?: string | null;
  strengths?: string | null;
  reviewDueAt: Date | null;
  goals: unknown;
};

function legacyItems(goals: unknown): { text: string; targetDate: string; objectives: string[]; interventions: string[] }[] {
  const items = goals && typeof goals === 'object' && !Array.isArray(goals) ? (goals as { items?: unknown }).items : null;
  return (Array.isArray(items) ? items : [])
    .filter((g): g is Record<string, unknown> => Boolean(g) && typeof g === 'object')
    .map((g) => ({
      text: typeof g.text === 'string' ? g.text.trim() : '',
      targetDate: typeof g.targetDate === 'string' ? g.targetDate.trim() : '',
      objectives: Array.isArray(g.objectives) ? g.objectives.filter((o): o is string => typeof o === 'string' && o.trim() !== '') : [],
      interventions: Array.isArray(g.interventions) ? g.interventions.filter((o): o is string => typeof o === 'string' && o.trim() !== '') : [],
    }))
    .filter((g) => g.text);
}

/** A plan from the Treatment Plans page can be signed once it has a goal with an objective and an intervention. */
export function legacyPlanBlocker(plan: LegacyPlanInput): string | null {
  const items = legacyItems(plan.goals);
  if (!items.length) return 'Add at least one goal before signing.';
  const i = items.findIndex((g) => !g.objectives.length || !g.interventions.length);
  if (i !== -1) return `Goal ${i + 1}: add at least one objective and one intervention before signing.`;
  return null;
}

/** Signed text of a plan written on the Treatment Plans page (no template values). */
export function renderLegacyPlanText(plan: LegacyPlanInput, header: { clientName: string; dateOfBirth: string | null; age: number | null; planDate: string; clinicianName: string | null }): string {
  const lines = [
    plan.title,
    `Client: ${header.clientName}${header.dateOfBirth ? ` (DOB ${header.dateOfBirth}${header.age != null ? `, age ${header.age}` : ''})` : ''}`,
    `Plan date: ${header.planDate}`,
    `Clinician: ${header.clinicianName || 'Not on file'}`,
    '',
    `Diagnoses: ${(plan.diagnosisCodes || []).join(', ') || 'None listed'}`,
  ];
  if (plan.presentingProblems?.trim()) lines.push(`Presenting needs / problems: ${plan.presentingProblems.trim()}`);
  if (plan.strengths?.trim()) lines.push(`Strengths: ${plan.strengths.trim()}`);
  lines.push('', 'Goals & Objectives');
  legacyItems(plan.goals).forEach((g, i) => {
    lines.push(`Goal ${i + 1}: ${g.text}${g.targetDate ? ` (target ${g.targetDate})` : ''}`);
    g.objectives.forEach((o, j) => lines.push(`  Objective ${i + 1}.${j + 1}: ${o}`));
    g.interventions.forEach((iv) => lines.push(`  Intervention: ${iv}`));
  });
  lines.push('', `Next plan review date: ${plan.reviewDueAt ? plan.reviewDueAt.toISOString().slice(0, 10) : 'Not set'}`);
  return lines.join('\n');
}

async function findScopedPlan(actor: StaffActor, planId: string) {
  return prisma.treatmentPlan.findFirst({
    where: { id: planId, organizationId: actor.organizationId, client: clientAccessWhere(actor) },
    select: signSelect,
  });
}

/**
 * Co-sign lookup: the same scope as the co-sign queue (listPlansAwaitingCosign / cosignScope.ts),
 * not the caseload. A supervisor co-signs a supervisee's plan for a client who is not on the
 * supervisor's own caseload. Org-scoped here; the cosign case then requires co-sign authority
 * (designated supervisor, leadership / medical director, or caseload co-sign with the client on
 * the caseload) and the Part 2 / VIP check, and answers 404 when none applies.
 */
async function findCosignPlan(actor: StaffActor, planId: string) {
  return prisma.treatmentPlan.findFirst({
    where: { id: planId, organizationId: actor.organizationId, client: clientOrgFilter(actor.organizationId) },
    select: signSelect,
  });
}

/** Close the plan a review replaces, once the review is active. */
async function closeSuperseded(tx: Prisma.TransactionClient, plan: { supersedesId: string | null; organizationId: string; clientId: string }) {
  if (!plan.supersedesId) return;
  await tx.treatmentPlan.updateMany({
    where: { id: plan.supersedesId, organizationId: plan.organizationId, clientId: plan.clientId, status: { not: 'CLOSED' } },
    data: { status: 'CLOSED' },
  });
}

export type SignatureAction =
  | { type: 'sign'; attested: boolean }
  | { type: 'cosign'; comment: string | null }
  | { type: 'send' }
  | { type: 'verbal'; obtainedBy: string }
  /** Patient / guardian / guarantor / other signer signing in office (typed name + relationship) */
  | { type: 'inOffice'; role: PersonSignerRole; typedName: string; relationship: string | null; attested: boolean }
  /** Another provider on the care team signs the plan in Altrixs */
  | { type: 'providerSign'; attested: boolean }
  | { type: 'reopen' };

export type SignatureResult = { ok: true; plan: PlanStatusSummary; portalAccount: boolean; clientId: string } | Fail;

/**
 * Clinician sign (author only) → status ACTIVE, snapshot rendered on the server, sent to the
 * patient's portal; supervisor co-sign (designated licensure supervisor or co-sign authority)
 * when the author is pre-licensed; re-send; telehealth verbal consent; reopen (clears every
 * signature and returns the plan to draft).
 */
export async function applyPlanSignatureAction(actor: StaffActor, planId: string, action: SignatureAction): Promise<SignatureResult> {
  // Co-sign uses the co-sign queue scope (supervisees too); every other action is caseload-scoped
  const plan = action.type === 'cosign' ? await findCosignPlan(actor, planId) : await findScopedPlan(actor, planId);
  if (!plan) return { ok: false, status: 404, error: 'Treatment plan not found' };
  const now = new Date();
  const today = clinicDate(now);
  const settings = await getTherapyWorkflowSettings(actor.organizationId);
  const isAuthor = plan.clinicianId === actor.actorUserId;
  const elevated = ['ADMIN', 'PRACTICE_DIRECTOR', 'DIRECTOR'].includes(String(actor.actorRole));
  const patientStatus = asPatientSignatureStatus(plan.patientSignatureStatus);
  let data: Prisma.TreatmentPlanUpdateInput = {};
  let activates = false;

  switch (action.type) {
    case 'sign': {
      if (!isAuthor && !(plan.clinicianId == null && elevated)) {
        return { ok: false, status: 403, error: 'Only the plan’s clinician can sign it. Supervisors co-sign after the clinician signs.' };
      }
      if (plan.clinicianSignedAt) return { ok: false, status: 409, error: 'This plan is already signed.' };
      if (action.attested !== true) return { ok: false, status: 400, error: 'Confirm the attestation to sign.' };
      const values = templateValuesFromGoalsJson(plan.goals);
      const dob = plan.client.dateOfBirth ? plan.client.dateOfBirth.toISOString() : null;
      const age = ageOn(dob, today);
      const ctx = { minor: age != null && age < 18, telehealth: false };
      if (values) {
        const [blocker] = treatmentPlanBlockers(values, ctx);
        if (blocker) return { ok: false, status: 400, error: blocker.message };
      } else {
        // Plan written on the Treatment Plans page (no template): needs at least one goal
        const blocker = legacyPlanBlocker(plan);
        if (blocker) return { ok: false, status: 400, error: blocker };
      }
      if (!plan.reviewDueAt) return { ok: false, status: 400, error: 'Set the next plan review date.' };
      const license = await loadLicenseLevel(actor.organizationId, actor.actorUserId);
      const supervisorRequired = supervisorSignatureRequired(license.level);
      const signerName = await displayName(actor.actorUserId);
      const header = {
        clientName: plan.client.name,
        dateOfBirth: dob ? isoDate(dob) : null,
        age,
        planDate: today,
        clinicianName: plan.clinician?.name ?? signerName,
      };
      const document = await buildDocumentForPlan(actor.organizationId, { ...plan, clinicianName: header.clinicianName }, today, now);
      const snapshot = document ? renderPlanDocumentText(document) : values ? renderTreatmentPlanText(values, ctx, header) : renderLegacyPlanText(plan, header);
      data = {
        status: 'ACTIVE',
        signedSnapshot: `${snapshot}\n\nSigned by ${signerName} on ${now.toISOString()}${supervisorRequired ? ' (pre-licensed: supervisor signature required)' : ''}.`,
        signedDocument: document ? (document as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        clinicianSignedAt: now,
        clinicianSignedById: actor.actorUserId,
        clinicianSignedByName: signerName,
        supervisorRequired,
        // Lisa: the clinician signs and the plan is sent to the patient through the portal
        patientSignatureStatus: 'AWAITING',
        patientSentAt: now,
      };
      activates = !supervisorRequired;
      break;
    }
    case 'cosign': {
      // Authority first (same scope as the co-sign queue): the plan was looked up org-wide, so a
      // reviewer with no co-sign basis for it must not learn anything about it (404).
      const designated = await isDesignatedSupervisor(actor.organizationId, actor.actorUserId, plan.clinicianSignedById ?? plan.clinicianId);
      // Plan co-sign is only ever for a pre-licensed author (supervisorRequired)
      const medicalDirector = verifiedMedicalDirector({ userId: actor.actorUserId, role: actor.actorRole, organizationId: actor.organizationId });
      const clientOnCaseload = await isClientOnCaseload(actor, plan.client.id);
      const decision = decideCosignScope({ role: actor.actorRole, medicalDirector, preLicensedAuthor: true, isDesignatedSupervisor: designated, clientOnCaseload });
      if (!decision.allowed) {
        if (!clientOnCaseload) return { ok: false, status: 404, error: 'Treatment plan not found' };
        return { ok: false, status: 403, error: 'Only the clinician’s supervisor (HR › Supervision), a psychiatrist with this client on their caseload, or a clinical director can co-sign.' };
      }
      if (isAuthor || plan.clinicianSignedById === actor.actorUserId) return { ok: false, status: 403, error: 'You cannot co-sign your own plan.' };
      // 42 CFR Part 2 / VIP: co-signing needs the same PHI access as opening the chart
      const block = await clientPhiBlock({ organizationId: actor.organizationId, userId: actor.actorUserId, role: actor.actorRole }, plan.client.id, `/api/ehr/treatment-plans/${plan.id}/signatures`);
      if (block) return { ok: false, status: 403, error: block.body.error };
      if (!plan.clinicianSignedAt) return { ok: false, status: 409, error: 'The clinician has not signed this plan yet.' };
      if (!plan.supervisorRequired) return { ok: false, status: 409, error: 'This plan does not need a supervisor signature (author is licensed).' };
      if (plan.supervisorSignedAt) return { ok: false, status: 409, error: `Already signed by ${plan.supervisorSignedByName || 'a supervisor'}.` };
      data = {
        supervisorSignedAt: now,
        supervisorSignedById: actor.actorUserId,
        supervisorSignedByName: await displayName(actor.actorUserId),
        supervisorComment: action.comment?.trim().slice(0, 2000) || null,
      };
      activates = true;
      break;
    }
    case 'send':
    case 'verbal': {
      if (!isAuthor && !elevated) return { ok: false, status: 403, error: 'Only the plan’s clinician can do this.' };
      const t = patientSignatureTransition(
        patientStatus,
        action.type === 'send' ? { type: 'send' } : { type: 'verbal', obtainedBy: action.obtainedBy },
        { clinicianSigned: Boolean(plan.clinicianSignedAt) }
      );
      if (t.ok === false) return { ok: false, status: 409, error: t.error };
      data =
        action.type === 'send'
          ? { patientSignatureStatus: t.next, patientSentAt: now, patientDeclinedAt: null, patientDeclineReason: null }
          : { patientSignatureStatus: t.next, patientVerbalBy: action.obtainedBy.trim().slice(0, 200), patientSignedAt: now };
      break;
    }
    case 'inOffice':
    case 'providerSign': {
      if (!plan.clinicianSignedAt) return { ok: false, status: 409, error: 'The clinician signs the plan first; other signers sign the signed plan.' };
      if (plan.status === 'CLOSED') return { ok: false, status: 409, error: 'This plan is closed.' };
      if (action.attested !== true) return { ok: false, status: 400, error: 'Confirm the attestation to sign.' };
      const others = parseOtherSignatures(plan.otherSignatures);
      const staffName = await displayName(actor.actorUserId);
      let entry: OtherSignature;
      if (action.type === 'providerSign') {
        if (isAuthor || plan.clinicianSignedById === actor.actorUserId) return { ok: false, status: 409, error: 'You signed this plan as its owner.' };
        if (plan.supervisorSignedById === actor.actorUserId) return { ok: false, status: 409, error: 'You signed this plan as the supervisor.' };
        if (others.some((o) => o.role === 'Other provider' && o.name === staffName)) return { ok: false, status: 409, error: 'You already signed this plan.' };
        entry = { id: `S${now.getTime().toString(36)}`, role: 'Other provider', name: staffName, relationship: null, method: 'in-app', signedAt: now.toISOString(), recordedBy: null, attestation: attestationFor('Other provider') };
      } else {
        if (!isAuthor && !elevated) return { ok: false, status: 403, error: 'Only the plan’s clinician (or a director) records an in-office signature.' };
        const typed = action.typedName.trim().slice(0, 120);
        if (typed.length < 2) return { ok: false, status: 400, error: 'Type the signer’s full name.' };
        const relationship = action.relationship?.trim().slice(0, 60) || null;
        if (action.role !== 'Patient' && !relationship) return { ok: false, status: 400, error: 'Enter the signer’s relationship to the patient.' };
        entry = { id: `S${now.getTime().toString(36)}`, role: action.role, name: typed, relationship, method: 'in-office', signedAt: now.toISOString(), recordedBy: staffName, attestation: attestationFor(action.role) };
        if (action.role === 'Patient') {
          if (patientStatus === 'SIGNED' || patientStatus === 'VERBAL') return { ok: false, status: 409, error: 'The patient has already signed this plan.' };
          data = { patientSignatureStatus: 'SIGNED', patientSignedAt: now, patientSignedName: relationship && relationship !== 'Self' ? `${typed} (${relationship})` : typed, patientDeclinedAt: null, patientDeclineReason: null };
        }
      }
      data = { ...data, otherSignatures: [...others, entry] as unknown as Prisma.InputJsonValue };
      break;
    }
    case 'reopen': {
      if (!isAuthor && !elevated) return { ok: false, status: 403, error: 'Only the plan’s clinician or a director can reopen it.' };
      data = {
        status: 'DRAFT',
        signedSnapshot: null,
        signedDocument: Prisma.DbNull,
        otherSignatures: Prisma.DbNull,
        clinicianSignedAt: null,
        clinicianSignedById: null,
        clinicianSignedByName: null,
        supervisorRequired: false,
        supervisorSignedAt: null,
        supervisorSignedById: null,
        supervisorSignedByName: null,
        supervisorComment: null,
        patientSignatureStatus: 'NOT_SENT',
        patientSentAt: null,
        patientSignedAt: null,
        patientSignedName: null,
        patientDeclinedAt: null,
        patientDeclineReason: null,
        patientVerbalBy: null,
      };
      break;
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    // Conditional on the signature state read above: two signers racing cannot both apply
    const guard: Prisma.TreatmentPlanWhereInput =
      action.type === 'sign'
        ? { clinicianSignedAt: null }
        : action.type === 'cosign'
          ? { supervisorSignedAt: null, clinicianSignedAt: { not: null } }
          : action.type === 'inOffice' || action.type === 'providerSign'
            ? { patientSignatureStatus: plan.patientSignatureStatus, updatedAt: plan.updatedAt }
            : { patientSignatureStatus: plan.patientSignatureStatus };
    const res = await tx.treatmentPlan.updateMany({ where: { id: plan.id, ...guard }, data: data as Prisma.TreatmentPlanUpdateManyMutationInput });
    if (res.count === 0) return null;
    if (activates) await closeSuperseded(tx, plan);
    return tx.treatmentPlan.findUnique({ where: { id: plan.id }, select: statusSelect });
  });
  if (!updated) return { ok: false, status: 409, error: 'This plan was just changed by someone else. Reload it.' };
  const portal = await prisma.patientAccount.findUnique({ where: { clientId: plan.client.id }, select: { status: true } }).catch(() => null);
  return { ok: true, plan: summarize(updated, settings, today), portalAccount: Boolean(portal), clientId: plan.client.id };
}

/**
 * Plans awaiting this actor's co-signature, same rule as the note co-sign queue: org-wide for
 * leadership / a behavioral-health Medical Director; a Psychiatrist's supervisees + clients on
 * their caseload; otherwise designated supervisees only. Part 2 masking is applied by the route.
 */
export async function listPlansAwaitingCosign(actor: StaffActor) {
  let authorFilter: Prisma.TreatmentPlanWhereInput = {};
  const medicalDirector = verifiedMedicalDirector({ userId: actor.actorUserId, role: actor.actorRole, organizationId: actor.organizationId });
  // Plans are always by pre-licensed authors: a primary care medical director is not their supervisor
  const scope = hasCosignAuthority(actor.actorRole, { medicalDirector, preLicensedAuthor: true }) ? 'org' : cosignQueueScope(actor.actorRole);
  if (scope !== 'org') {
    const superviseeIds = await loadSuperviseeIds(actor.organizationId, actor.actorUserId);
    const or: Prisma.TreatmentPlanWhereInput[] = [];
    if (superviseeIds.length) or.push({ clinicianSignedById: { in: superviseeIds } });
    if (scope === 'supervisees_and_caseload') or.push({ client: clientAccessWhere(actor) });
    if (!or.length) return [];
    authorFilter = { OR: or };
  }
  const rows = await prisma.treatmentPlan.findMany({
    where: {
      organizationId: actor.organizationId,
      supervisorRequired: true,
      supervisorSignedAt: null,
      clinicianSignedAt: { not: null },
      status: { not: 'CLOSED' },
      clinicianSignedById: { not: actor.actorUserId },
      ...authorFilter,
    },
    select: { id: true, title: true, clientId: true, client: { select: { name: true } }, clinicianSignedByName: true, clinicianSignedAt: true },
    orderBy: { clinicianSignedAt: 'asc' },
    take: 100,
  });
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    clientId: r.clientId,
    clientName: r.client.name,
    authorName: r.clinicianSignedByName,
    signedAt: r.clinicianSignedAt?.toISOString() ?? null,
  }));
}

// ─── Patient portal ─────────────────────────────────────────────────────────

type PatientCtx = { clientId: string; organizationId: string };

const patientSelect = {
  id: true,
  title: true,
  planKind: true,
  signedSnapshot: true,
  signedDocument: true,
  otherSignatures: true,
  clinicianSignedById: true,
  supervisorRequired: true,
  supervisorSignedAt: true,
  supervisorSignedByName: true,
  patientVerbalBy: true,
  clinicianSignedAt: true,
  clinicianSignedByName: true,
  patientSignatureStatus: true,
  patientSentAt: true,
  patientSignedAt: true,
  patientSignedName: true,
  patientDeclinedAt: true,
  patientDeclineReason: true,
} satisfies Prisma.TreatmentPlanSelect;

type PatientRow = Prisma.TreatmentPlanGetPayload<{ select: typeof patientSelect }>;

function patientDoc(r: PatientRow, withText: boolean) {
  return {
    id: r.id,
    kind: 'treatment-plan' as const,
    title: r.title,
    status: asPatientSignatureStatus(r.patientSignatureStatus),
    sentAt: r.patientSentAt?.toISOString() ?? null,
    clinicianSignedAt: r.clinicianSignedAt?.toISOString() ?? null,
    clinicianName: r.clinicianSignedByName,
    signedAt: r.patientSignedAt?.toISOString() ?? null,
    signedName: r.patientSignedName,
    declinedAt: r.patientDeclinedAt?.toISOString() ?? null,
    declineReason: r.patientDeclineReason,
    ...(withText
      ? {
          text: r.signedSnapshot || '',
          // Structured document as signed (header, problems → interventions); null for older plans
          document: parsePlanDocument(r.signedDocument),
          signatures: buildSignatureBlocks(r, parseOtherSignatures(r.otherSignatures)),
        }
      : {}),
  };
}

const patientVisible = (ctx: PatientCtx): Prisma.TreatmentPlanWhereInput => ({
  clientId: ctx.clientId,
  organizationId: ctx.organizationId,
  signedSnapshot: { not: null },
  patientSignatureStatus: { in: ['AWAITING', 'SIGNED', 'DECLINED'] },
});

export async function listPatientDocuments(ctx: PatientCtx) {
  const rows = await prisma.treatmentPlan.findMany({ where: patientVisible(ctx), select: patientSelect, orderBy: { patientSentAt: 'desc' }, take: 50 });
  return rows.map((r) => patientDoc(r, false));
}

export async function getPatientDocument(ctx: PatientCtx, id: string) {
  const row = await prisma.treatmentPlan.findFirst({ where: { id, ...patientVisible(ctx) }, select: patientSelect });
  return row ? patientDoc(row, true) : null;
}

/** Portal "signing as" choice → document signer role */
export function portalSignerRole(relationship: string): PersonSignerRole {
  if (relationship === 'Parent' || relationship === 'Legal guardian') return 'Guardian';
  if (relationship === 'Guarantor') return 'Guarantor';
  if (relationship === 'Self') return 'Patient';
  return 'Other signer';
}

export async function patientRespond(
  ctx: PatientCtx,
  id: string,
  input:
    | { decision: 'sign'; typedName: string; signerRelationship: string }
    | { decision: 'decline'; reason: string }
    /** A further signer (guardian, guarantor) on a plan already signed in the portal */
    | { decision: 'cosign'; typedName: string; signerRelationship: string }
): Promise<{ ok: true; document: ReturnType<typeof patientDoc> } | Fail> {
  const row = await prisma.treatmentPlan.findFirst({ where: { id, ...patientVisible(ctx) }, select: { ...patientSelect, clinicianSignedAt: true, updatedAt: true } });
  if (!row) return { ok: false, status: 404, error: 'Document not found' };
  if (input.decision === 'cosign') {
    const current = asPatientSignatureStatus(row.patientSignatureStatus);
    if (current !== 'SIGNED' && current !== 'VERBAL') return { ok: false, status: 409, error: 'The plan is signed by the patient (or parent / guardian) first.' };
    const typed = input.typedName.trim().slice(0, 120);
    if (typed.length < 2) return { ok: false, status: 400, error: 'Type your full name to sign.' };
    const role = portalSignerRole(input.signerRelationship);
    if (role === 'Patient') return { ok: false, status: 409, error: 'The patient has already signed this plan.' };
    const others = parseOtherSignatures(row.otherSignatures);
    if (others.some((o) => o.role === role && o.name.toLowerCase() === typed.toLowerCase())) return { ok: false, status: 409, error: 'You already signed this plan.' };
    const now = new Date();
    const entry: OtherSignature = { id: `S${now.getTime().toString(36)}`, role, name: typed, relationship: input.signerRelationship.slice(0, 60), method: 'portal', signedAt: now.toISOString(), recordedBy: null, attestation: attestationFor(role) };
    const res = await prisma.treatmentPlan.updateMany({ where: { id: row.id, updatedAt: row.updatedAt }, data: { otherSignatures: [...others, entry] as unknown as Prisma.InputJsonValue } });
    if (res.count === 0) return { ok: false, status: 409, error: 'This document was just updated. Reload it.' };
    const fresh = await prisma.treatmentPlan.findUnique({ where: { id: row.id }, select: patientSelect });
    return { ok: true, document: patientDoc(fresh!, true) };
  }
  const current = asPatientSignatureStatus(row.patientSignatureStatus);
  const t = patientSignatureTransition(
    current,
    input.decision === 'sign' ? { type: 'sign', typedName: input.typedName } : { type: 'decline', reason: input.reason },
    { clinicianSigned: Boolean(row.clinicianSignedAt) }
  );
  if (t.ok === false) return { ok: false, status: 409, error: t.error };
  const now = new Date();
  const relation = input.decision === 'sign' && input.signerRelationship.trim() && input.signerRelationship !== 'Self' ? ` (${input.signerRelationship.trim().slice(0, 60)})` : '';
  const data: Prisma.TreatmentPlanUpdateManyMutationInput =
    input.decision === 'sign'
      ? { patientSignatureStatus: t.next, patientSignedAt: now, patientSignedName: `${input.typedName.trim().slice(0, 120)}${relation}` }
      : { patientSignatureStatus: t.next, patientDeclinedAt: now, patientDeclineReason: input.reason.trim().slice(0, 1000) };
  const res = await prisma.treatmentPlan.updateMany({ where: { id: row.id, patientSignatureStatus: 'AWAITING' }, data });
  if (res.count === 0) return { ok: false, status: 409, error: 'This document was just updated. Reload it.' };
  const fresh = await prisma.treatmentPlan.findUnique({ where: { id: row.id }, select: patientSelect });
  return { ok: true, document: patientDoc(fresh!, true) };
}

// ─── HR: license level ──────────────────────────────────────────────────────

const CLINICAL_AUTHOR_ROLES = ['THERAPIST', 'CLINICIAN', 'PSYCHIATRIST', 'NP', 'CASE_MANAGER', 'PRP_SPECIALIST', 'PEER_SUPPORT', 'PRACTICE_DIRECTOR', 'DIRECTOR'] as const;

/** Clinical staff with their license level (HR setting, or what it is derived from). */
export async function listLicenseLevels(organizationId: string) {
  const users = await prisma.user.findMany({
    where: { organizationId, role: { in: [...CLINICAL_AUTHOR_ROLES] as Role[] } },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      licenseLevel: true,
      staffCredentials: {
        where: { credentialType: { in: ['LICENSE', 'CERTIFICATION', 'SUPERVISION'] }, status: { not: 'EXPIRED' } },
        select: { title: true },
      },
    },
    orderBy: { name: 'asc' },
    take: 500,
  });
  const tracks = await prisma.supervisionTrack
    .findMany({ where: { organizationId }, select: { superviseeId: true, licenseTrack: true } })
    .catch(() => [] as { superviseeId: string; licenseTrack: string }[]);
  const onTrack = new Map(tracks.map((t) => [t.superviseeId, t.licenseTrack]));
  return users.map((u) => {
    const resolved = resolveLicenseLevel({
      explicit: u.licenseLevel,
      credentialTitles: u.staffCredentials.map((c) => c.title),
      onSupervisionTrack: onTrack.has(u.id),
    });
    return {
      userId: u.id,
      name: u.name || u.email,
      role: u.role,
      explicit: u.licenseLevel === 'LICENSED' || u.licenseLevel === 'PRE_LICENSED' ? u.licenseLevel : null,
      level: resolved.level,
      source: resolved.source,
      credentials: u.staffCredentials.map((c) => c.title),
      licenseTrack: onTrack.get(u.id) ?? null,
    };
  });
}

export async function setLicenseLevel(organizationId: string, userId: string, level: LicenseLevel | null) {
  const res = await prisma.user.updateMany({ where: { id: userId, organizationId }, data: { licenseLevel: level } });
  return res.count > 0;
}
