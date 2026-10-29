/**
 * Progress notes worklist ("My notes" queue), modeled on TherapyNotes To-Do / Valant
 * documentation queue / SimplePractice "Notes" filters:
 *
 *   missing   Notes to write: my past visits (last 30 days) with no note yet
 *   drafts    My unsigned notes that still have something to complete
 *   ready     Awaiting my signature: my unsigned notes with nothing blocking signature
 *   cosign    Awaiting co-sign: notes waiting for MY co-signature (supervisors), and my signed
 *             notes waiting for a supervisor
 *   returned  My notes a supervisor returned for correction (fix with an addendum)
 *   signed    My signed / locked notes
 *   all       Every note I can see (org + caseload scope) — directors / admins
 *   escalated Overdue > 7 days (supervisor view): unsigned notes more than 7 days past due,
 *             routed to the author's supervisor (SupervisionTrack), else to the clinical
 *             director / practice director / admin. Shown only to those recipients.
 *
 * Scope is always clientAccessWhere (org + caseload). Lists carry no note text (minimum
 * necessary); the note opens through the audited note view.
 */
import { Prisma, type Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere, clientOrgFilter } from '@/lib/clients/orgScope';
import { isElevatedNoteActor, resolveNoteMeta } from '@/lib/clients/notes';
import { canUndoDismiss, NOT_DISMISSED } from '@/lib/notes/dismiss';
import { normalizeNoteType } from '@/lib/ehr/noteTemplates';
import { structuredSignBlockers } from '@/lib/ehr/structuredNotes';
import { findUnfilledBlanks } from '@/lib/ehr/smartPhrases';
import { countAiDraftMarkers } from '@/lib/ai/noteDraftFormats';
import { listCosignQueue } from '@/lib/notes/workflow-store';
import { cosignQueueScope } from '@/lib/notes/transitions';
import { serializeServiceDetail } from '@/lib/notes/serviceDetail';
import { loadNotePolicy } from '@/lib/notes/policy';
import { NOT_IMPORTED_HISTORY } from '@/lib/appointments/importedHistory';
import { formatElementsGate, type FormatElementsGate } from '@/lib/notes/formatElements';
import {
  billingElementIssues,
  DUE_SOON_HOURS,
  ESCALATION_LEADERSHIP_ROLES,
  ESCALATION_OVERDUE_DAYS,
  firstSignBlocker,
  isStaleDraft,
  LATE_REASON_MIN_CHARS,
  selectEscalatedOverdue,
  noteTimeliness,
  noteTypeIssues,
  type TimelinessState,
} from '@/lib/notes/standard';
import { toPracticeWallTime } from '@/lib/time/practiceTime';

export const WORKLIST_TABS = ['missing', 'drafts', 'ready', 'cosign', 'returned', 'signed', 'all', 'escalated'] as const;
export type WorklistTab = (typeof WORKLIST_TABS)[number];

/** Program / service line, derived from the note type (there is no per-note program column). */
export const NOTE_PROGRAMS: Record<string, readonly string[]> = {
  therapy: ['Therapy Intake', 'Therapy Progress', 'SOAP', 'DAP', 'BIRP', 'GIRP', 'PIE', 'PIRP', 'CBT', 'DBT', 'MFT', 'EMDR', 'Intake', 'Discharge', 'Collateral', 'Telephone', 'No-Show'],
  psychiatry: ['Psych Eval', 'Med Mgmt', 'Psych Med Mgmt', 'Child Psych Initial Intake', 'Child Psych Intake', 'Adult Psych Intake', 'Adult Psych Re-Eval'],
  sud: ['SUD', 'Substance Abuse Intake'],
  group: ['Group'],
  crisis: ['Crisis'],
  prp: ['PRP'],
  peer_support: ['Peer Support'],
};

export type WorklistFilters = {
  clientId?: string | null;
  from?: string | null;
  to?: string | null;
  noteType?: string | null;
  clinicianId?: string | null;
  locationId?: string | null;
  program?: string | null;
  status?: 'Draft' | 'Signed' | 'Locked' | null;
  /** none = no claim yet; otherwise a ClaimStatus */
  billing?: string | null;
  part2?: 'yes' | 'no' | null;
  search?: string | null;
  /** All notes tab only: also list dismissed notes (read-only; leadership: all, others: their own) */
  includeDismissed?: boolean;
};

export type WorklistSort = 'dos_desc' | 'dos_asc' | 'client' | 'oldest_due';

export type WorklistRow = {
  kind: 'note' | 'missing';
  noteId: string | null;
  appointmentId: string | null;
  clientId: string;
  clientName: string;
  clientImage: string | null;
  dateOfService: string | null;
  noteType: string | null;
  cptCode: string | null;
  durationMinutes: number | null;
  status: 'Draft' | 'Signed' | 'Locked' | 'Missing';
  clinicianId: string | null;
  clinicianName: string | null;
  locationName: string | null;
  daysSinceService: number | null;
  timeliness: TimelinessState;
  dueAt: string | null;
  lateEntryLabel: string | null;
  billingStatus: string | null;
  claimId: string | null;
  part2: boolean;
  aiDrafted: boolean;
  telehealth: boolean;
  /** Drafts: first thing still blocking signature */
  nextStep: string | null;
  /** My unsigned note with nothing blocking signature (not a group-session note): inline Sign */
  readyToSign: boolean;
  stale: boolean;
  cosignRequired: boolean;
  cosignedAt: string | null;
  /** cosign tab: 'reviewer' = waiting for my co-signature; 'author' = mine, waiting for a supervisor */
  cosignRole: 'reviewer' | 'author' | null;
  returnedComment: string | null;
  returnedBy: string | null;
  returnedAt: string | null;
  appointmentStartsAt: string | null;
  /** Dismissed unsigned note (All notes + "Include dismissed" only): read-only */
  dismissedAt: string | null;
  dismissedByName: string | null;
  dismissReason: string | null;
  canUndoDismiss: boolean;
};

export type WorklistResult = {
  tab: WorklistTab;
  rows: WorklistRow[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<WorklistTab, number>;
  overdue: number;
  /** My unsigned notes due within DUE_SOON_HOURS */
  dueSoon: number;
  /** Supervisor view: the viewer receives overdue > 7 days escalations (supervisor of someone, or leadership) */
  escalation: { visible: boolean; overdueDays: number };
  policy: {
    deadlineHours: number;
    dueSoonHours: number;
    staleDraftDays: number;
    cloneWarnPercent: number;
    requireDiagnosisToSign: boolean;
    timeZone: string;
    cosignRequiredRoles: string[];
  };
  facets: {
    clinicians: { id: string; name: string }[];
    locations: { id: string; name: string }[];
    programs: string[];
  };
  canReviewCosign: boolean;
};

const DAY = 86_400_000;

function dateOnly(s: string | null | undefined): string | null {
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/** Prisma filter for the shared filters (all tabs). */
export function worklistFilterWhere(f: WorklistFilters): Prisma.ProgressNoteWhereInput[] {
  const and: Prisma.ProgressNoteWhereInput[] = [];
  if (f.clientId) and.push({ clientId: f.clientId });
  const from = dateOnly(f.from);
  const to = dateOnly(f.to);
  if (from || to) {
    and.push({
      dateOfService: {
        ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
        ...(to ? { lte: new Date(`${to}T00:00:00.000Z`) } : {}),
      },
    });
  }
  if (f.noteType) and.push({ noteType: { equals: f.noteType, mode: 'insensitive' } });
  if (f.program && NOTE_PROGRAMS[f.program]) and.push({ noteType: { in: [...NOTE_PROGRAMS[f.program]] } });
  if (f.clinicianId) and.push({ clinicianId: f.clinicianId });
  if (f.locationId) and.push({ client: { locationId: f.locationId } });
  if (f.part2 === 'yes') and.push({ part2: true });
  if (f.part2 === 'no') and.push({ part2: false });
  if (f.status === 'Draft') and.push({ OR: [{ workflow: { is: null } }, { workflow: { is: { status: 'DRAFT' } } }] });
  if (f.status === 'Signed') and.push({ workflow: { is: { status: 'SIGNED' } } });
  if (f.status === 'Locked') and.push({ workflow: { is: { status: 'LOCKED' } } });
  if (f.billing === 'none') and.push({ claims: { none: {} } });
  else if (f.billing && ['DRAFT', 'READY', 'SUBMITTED', 'ACCEPTED', 'DENIED', 'PAID'].includes(f.billing)) {
    and.push({ claims: { some: { status: f.billing as Prisma.EnumClaimStatusFilter['equals'] } } });
  }
  const q = (f.search || '').trim();
  if (q) {
    and.push({
      OR: [
        { client: { name: { contains: q, mode: 'insensitive' } } },
        { client: { mrn: { contains: q, mode: 'insensitive' } } },
        { clinician: { name: { contains: q, mode: 'insensitive' } } },
      ],
    });
  }
  return and;
}

const UNSIGNED: Prisma.ProgressNoteWhereInput = { OR: [{ workflow: { is: null } }, { workflow: { is: { status: 'DRAFT' } } }] };
const SIGNED: Prisma.ProgressNoteWhereInput = { workflow: { is: { status: { in: ['SIGNED', 'LOCKED'] } } } };

const noteSelect = {
  id: true,
  body: true,
  noteType: true,
  dateOfService: true,
  durationMinutes: true,
  cptCode: true,
  placeOfService: true,
  telehealth: true,
  audioOnly: true,
  part2: true,
  aiDrafted: true,
  appointmentId: true,
  clinicianId: true,
  createdAt: true,
  updatedAt: true,
  dismissedAt: true,
  dismissedByName: true,
  dismissReason: true,
  client: { select: { id: true, name: true, image: true, location: { select: { name: true } } } },
  clinician: { select: { name: true, email: true, credentials: true } },
  appointment: { select: { patientLocationState: true, startsAt: true } },
  workflow: { select: { status: true, signedAt: true, cosignRequired: true, cosignedAt: true, clinicianName: true } },
  claims: { select: { id: true, status: true }, take: 1 },
} satisfies Prisma.ProgressNoteSelect;

type NoteRecord = Prisma.ProgressNoteGetPayload<{ select: typeof noteSelect }>;

/**
 * First thing still blocking signature of an unsigned note, or null when it is ready to sign
 * (structured template rules, [___] blanks, AI DRAFT markers, then the billing / note-type
 * elements of the documentation standard). Same rule as the "Awaiting my signature" queue, so an
 * inline Sign (worklist, inbox, Today) is offered only when the full sign path would accept it.
 * Group-session notes skip the billing checks: the group session signs them.
 */
export function noteSignNextStep(
  n: NoteRecord,
  ctx: { detail: ReturnType<typeof serializeServiceDetail> | null; requireDiagnosisToSign: boolean; groupNote: boolean; formatElements?: FormatElementsGate }
): string | null {
  const meta = resolveNoteMeta(n);
  const [structured] = structuredSignBlockers({ noteType: meta.noteType || '', body: meta.displayBody, cptCode: meta.cptCode, durationMinutes: meta.durationMinutes });
  if (structured) return structured.message;
  const blanks = findUnfilledBlanks(meta.displayBody);
  if (blanks) return `Fill ${blanks} blank${blanks === 1 ? '' : 's'} ([___]).`;
  const markers = countAiDraftMarkers(meta.displayBody);
  if (markers) return `Review and Accept ${markers} AI section${markers === 1 ? '' : 's'}.`;
  if (ctx.groupNote) return null;
  return firstSignBlocker([
    ...billingElementIssues({
      noteType: meta.noteType,
      body: meta.displayBody,
      cptCode: meta.cptCode,
      dateOfService: meta.dateOfService,
      durationMinutes: meta.durationMinutes,
      telehealth: meta.telehealth || n.audioOnly,
      audioOnly: n.audioOnly,
      placeOfService: meta.placeOfService,
      detail: ctx.detail,
      appointmentPatientState: n.appointment?.patientLocationState ?? null,
      renderingCredentials: n.clinician?.credentials ?? null,
      requireDiagnosisToSign: ctx.requireDiagnosisToSign,
      clientId: n.client.id,
    }),
    ...noteTypeIssues({ noteType: meta.noteType, body: meta.displayBody, part2: meta.part2, formatElements: ctx.formatElements }),
  ]);
}

export type NoteSignReadiness = {
  noteId: string;
  clientId: string;
  /** Unsigned, mine, not dismissed, not a group-session note, nothing blocking */
  ready: boolean;
  /** Why it is not ready (first blocker, or why it cannot be signed from here) */
  nextStep: string | null;
  /** Signing now is past the practice deadline: a late-entry reason is required */
  lateEntryRequired: boolean;
  lateReasonMinChars: number;
  /** Where to finish the note (editor, or the group session page) */
  openHref: string;
};

/**
 * Inline-sign check for one note (inbox / Today "Sign"). The caller has already checked that the
 * viewer can open the note (requireAccessibleNote). One note, its service details and the policy;
 * no note text leaves the server.
 */
export async function loadNoteSignReadiness(input: {
  organizationId: string;
  actorUserId: string;
  noteId: string;
  now?: Date;
}): Promise<NoteSignReadiness | null> {
  const now = input.now ?? new Date();
  const n = await prisma.progressNote.findFirst({ where: { id: input.noteId, client: clientOrgFilter(input.organizationId) }, select: noteSelect });
  if (!n) return null;
  const [policy, detailRow, group] = await Promise.all([
    loadNotePolicy(input.organizationId),
    prisma.progressNoteServiceDetail.findUnique({ where: { noteId: n.id } }).catch(() => null),
    prisma.clinicalGroupAttendance.findFirst({ where: { progressNoteId: n.id }, select: { sessionId: true } }).catch(() => null),
  ]);
  const detail = detailRow ? serializeServiceDetail(detailRow) : null;
  const status = n.workflow?.status === 'LOCKED' ? 'Locked' : n.workflow?.status === 'SIGNED' ? 'Signed' : 'Draft';
  const groupHref = group?.sessionId ? `/dashboard/ehr/group-sessions/sessions/${encodeURIComponent(group.sessionId)}` : null;
  const openHref = groupHref ?? `/dashboard/ehr/notes?openNote=${encodeURIComponent(n.id)}&filterClient=${encodeURIComponent(n.client.id)}`;
  const meta = resolveNoteMeta(n);
  const t = noteTimeliness({
    dateOfService: meta.dateOfService || n.createdAt.toISOString().slice(0, 10),
    endTime: detail?.endTime ?? null,
    signedAt: null,
    now,
    deadlineHours: policy.deadlineHours,
    timeZone: policy.timeZone,
  });
  const base = { noteId: n.id, clientId: n.client.id, lateEntryRequired: t.state === 'overdue', lateReasonMinChars: LATE_REASON_MIN_CHARS, openHref };
  const notReady = (nextStep: string): NoteSignReadiness => ({ ...base, ready: false, nextStep });
  if (n.dismissedAt) return notReady('This note was dismissed.');
  if (status !== 'Draft') return notReady('This note is already signed.');
  if (n.clinicianId !== input.actorUserId) return notReady('Only the author signs this note.');
  if (groupHref) return notReady('Sign group notes from the group session.');
  const step = noteSignNextStep(n, { detail, requireDiagnosisToSign: policy.requireDiagnosisToSign, groupNote: false, formatElements: formatElementsGate(policy, now) });
  return step ? notReady(step) : { ...base, ready: true, nextStep: null };
}

type ReturnedReview = { noteId: string; reviewerName: string | null; comment: string | null; createdAt: Date };

async function latestReturns(organizationId: string, noteIds: string[]): Promise<Map<string, ReturnedReview>> {
  if (!noteIds.length) return new Map();
  try {
    const rows = await prisma.$queryRaw<(ReturnedReview & { action: string })[]>(Prisma.sql`
      SELECT DISTINCT ON ("noteId") "noteId", "action", "reviewerName", "comment", "createdAt"
      FROM "NoteQualityReview"
      WHERE "organizationId" = ${organizationId} AND "noteId" IN (${Prisma.join(noteIds)})
      ORDER BY "noteId", "createdAt" DESC
    `);
    const returned = rows.filter((r) => r.action === 'RETURNED');
    if (!returned.length) return new Map();
    // Returned and not yet answered with an addendum
    const addenda = await prisma.progressNoteAddendum.findMany({
      where: { noteId: { in: returned.map((r) => r.noteId) } },
      select: { noteId: true, createdAt: true },
    });
    const out = new Map<string, ReturnedReview>();
    for (const r of returned) {
      const answered = addenda.some((a) => a.noteId === r.noteId && a.createdAt > r.createdAt);
      if (!answered) out.set(r.noteId, r);
    }
    return out;
  } catch {
    return new Map();
  }
}

export async function loadWorklist(input: {
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
  medicalDirector?: boolean;
  tab: WorklistTab;
  filters: WorklistFilters;
  sort: WorklistSort;
  page: number;
  pageSize: number;
  now?: Date;
}): Promise<WorklistResult> {
  const now = input.now ?? new Date();
  const policy = await loadNotePolicy(input.organizationId);
  const scope: Prisma.ProgressNoteWhereInput = { client: clientAccessWhere(input) };
  const filters = worklistFilterWhere(input.filters);
  const mine: Prisma.ProgressNoteWhereInput = { clinicianId: input.actorUserId };
  // Dismissed notes are out of every queue and count; All notes can list them read-only
  const where = (...extra: Prisma.ProgressNoteWhereInput[]): Prisma.ProgressNoteWhereInput => ({ AND: [scope, NOT_DISMISSED, ...filters, ...extra] });
  const leadership = ESCALATION_LEADERSHIP_ROLES.includes(String(input.actorRole).toUpperCase());
  const allWhere: Prisma.ProgressNoteWhereInput =
    input.tab === 'all' && input.filters.includeDismissed
      ? { AND: [scope, ...filters, ...(leadership ? [] : [{ OR: [NOT_DISMISSED, mine] }])] }
      : where();
  const elevated = isElevatedNoteActor(input.actorRole);

  // Org-wide (leadership / Medical Director) or caseload reviewer (Psychiatrist); supervisors qualify via their queue below
  const canReviewCosign = cosignQueueScope(input.actorRole, { medicalDirector: input.medicalDirector }) !== 'supervisees';

  // ── My unsigned notes: classified drafts vs ready (needs bodies; capped) ──
  const myUnsigned = await prisma.progressNote.findMany({ where: where(mine, UNSIGNED), select: noteSelect, orderBy: { createdAt: 'desc' }, take: 500 });
  const details = myUnsigned.length
    ? await prisma.progressNoteServiceDetail.findMany({ where: { noteId: { in: myUnsigned.map((n) => n.id) } } }).catch(() => [])
    : [];
  const detailById = new Map(details.map((d) => [d.noteId, serializeServiceDetail(d)]));
  // Group-session notes are completed and signed from the group session (its own required fields)
  const groupNoteIds = new Set(
    myUnsigned.length
      ? (
          await prisma.clinicalGroupAttendance
            .findMany({ where: { progressNoteId: { in: myUnsigned.map((n) => n.id) } }, select: { progressNoteId: true } })
            .catch((): { progressNoteId: string | null }[] => [])
        ).map((a) => a.progressNoteId as string)
      : []
  );
  const nextStepFor = (n: NoteRecord): string | null =>
    noteSignNextStep(n, { detail: detailById.get(n.id) ?? null, requireDiagnosisToSign: policy.requireDiagnosisToSign, groupNote: groupNoteIds.has(n.id), formatElements: formatElementsGate(policy, now) });
  const unsignedSteps = new Map(myUnsigned.map((n) => [n.id, nextStepFor(n)]));
  const draftNotes = myUnsigned.filter((n) => unsignedSteps.get(n.id));
  const readyNotes = myUnsigned.filter((n) => !unsignedSteps.get(n.id));

  // ── Co-sign: waiting for me (reviewer) + mine waiting for a supervisor (author) ──
  const reviewerQueue = await listCosignQueue({ organizationId: input.organizationId, actorUserId: input.actorUserId, actorRole: input.actorRole }).catch(() => []);
  const reviewerIds = reviewerQueue.map((q) => q.noteId);
  const myPending = await prisma.progressNote.findMany({
    where: where(mine, { workflow: { is: { cosignRequired: true, cosignedAt: null, status: { in: ['SIGNED', 'LOCKED'] } } } }),
    select: { id: true },
    take: 500,
  });
  const returns = await latestReturns(input.organizationId, myPending.map((n) => n.id));
  const authorPendingIds = myPending.map((n) => n.id).filter((id) => !returns.has(id));
  const returnedIds = [...returns.keys()];

  // ── Missing notes: my past visits (30 days) with no note ──
  const search = (input.filters.search || '').trim();
  const missingWhere: Prisma.AppointmentWhereInput = {
    clinicianId: input.actorUserId,
    client: {
      AND: [
        clientAccessWhere(input),
        ...(input.filters.locationId ? [{ locationId: input.filters.locationId }] : []),
        ...(search ? [{ name: { contains: search, mode: 'insensitive' as const } }] : []),
      ],
    },
    startsAt: { gte: new Date(now.getTime() - 30 * DAY), lte: now },
    status: { in: ['SCHEDULED', 'CHECKED_IN', 'IN_SESSION', 'COMPLETED'] },
    groupSessionId: null,
    // A visit whose only note was dismissed still needs a note
    progressNotes: { none: NOT_DISMISSED },
    // Visits imported from Valant were documented in Valant
    ...NOT_IMPORTED_HISTORY,
    ...(input.filters.clientId ? { clientId: input.filters.clientId } : {}),
    ...(dateOnly(input.filters.from) || dateOnly(input.filters.to)
      ? {
          AND: [
            ...(dateOnly(input.filters.from) ? [{ startsAt: { gte: new Date(`${dateOnly(input.filters.from)}T00:00:00.000Z`) } }] : []),
            ...(dateOnly(input.filters.to) ? [{ startsAt: { lte: new Date(`${dateOnly(input.filters.to)}T23:59:59.999Z`) } }] : []),
          ],
        }
      : {}),
  };
  // ── Overdue > 7 days escalated to me (supervisor view) ──
  const escalated = await loadEscalatedNotes({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorRole: input.actorRole,
    filters,
    policy,
    now,
  });
  for (const [id, d] of escalated.details) detailById.set(id, d);

  const noteOnlyFilters = Boolean(input.filters.noteType || input.filters.program || input.filters.status || input.filters.billing || input.filters.part2 || (input.filters.clinicianId && input.filters.clinicianId !== input.actorUserId));

  const [missingCount, signedCount, allCount] = await Promise.all([
    noteOnlyFilters ? Promise.resolve(0) : prisma.appointment.count({ where: missingWhere }).catch(() => 0),
    prisma.progressNote.count({ where: where(mine, SIGNED) }),
    prisma.progressNote.count({ where: allWhere }),
  ]);

  const counts: Record<WorklistTab, number> = {
    missing: missingCount,
    drafts: draftNotes.length,
    ready: readyNotes.length,
    cosign: reviewerIds.length + authorPendingIds.length,
    returned: returnedIds.length,
    signed: signedCount,
    all: allCount,
    escalated: escalated.notes.length,
  };

  const toRow = (n: NoteRecord, extra: Partial<WorklistRow> = {}): WorklistRow => {
    const meta = resolveNoteMeta(n);
    const status = n.workflow?.status === 'LOCKED' ? 'Locked' : n.workflow?.status === 'SIGNED' ? 'Signed' : 'Draft';
    const dos = meta.dateOfService || n.createdAt.toISOString().slice(0, 10);
    const t = noteTimeliness({
      dateOfService: dos,
      endTime: detailById.get(n.id)?.endTime ?? null,
      signedAt: status === 'Draft' ? null : n.workflow?.signedAt ?? null,
      now,
      deadlineHours: policy.deadlineHours,
      timeZone: policy.timeZone,
    });
    return {
      kind: 'note',
      noteId: n.id,
      appointmentId: n.appointmentId,
      clientId: n.client.id,
      clientName: n.client.name,
      clientImage: n.client.image ?? null,
      dateOfService: meta.dateOfService,
      noteType: meta.noteType ? normalizeNoteType(meta.noteType) : null,
      cptCode: meta.cptCode,
      durationMinutes: meta.durationMinutes,
      status,
      clinicianId: n.clinicianId,
      clinicianName: n.workflow?.clinicianName || n.clinician?.name || n.clinician?.email || null,
      locationName: n.client.location?.name ?? null,
      daysSinceService: t.daysSinceService,
      timeliness: t.state,
      dueAt: t.dueAt,
      lateEntryLabel: null,
      billingStatus: n.claims[0]?.status ?? null,
      claimId: n.claims[0]?.id ?? null,
      part2: meta.part2,
      aiDrafted: meta.aiDrafted,
      telehealth: meta.telehealth,
      nextStep: status === 'Draft' && n.clinicianId === input.actorUserId ? unsignedSteps.get(n.id) ?? null : null,
      readyToSign:
        status === 'Draft' &&
        !n.dismissedAt &&
        n.clinicianId === input.actorUserId &&
        unsignedSteps.has(n.id) &&
        !unsignedSteps.get(n.id) &&
        !groupNoteIds.has(n.id),
      stale: status === 'Draft' && isStaleDraft(n.updatedAt, now, policy.staleDraftDays),
      cosignRequired: Boolean(n.workflow?.cosignRequired),
      cosignedAt: n.workflow?.cosignedAt?.toISOString() ?? null,
      cosignRole: null,
      returnedComment: null,
      returnedBy: null,
      returnedAt: null,
      appointmentStartsAt: n.appointment?.startsAt?.toISOString() ?? null,
      dismissedAt: n.dismissedAt?.toISOString() ?? null,
      dismissedByName: n.dismissedAt ? n.dismissedByName : null,
      dismissReason: n.dismissedAt ? n.dismissReason : null,
      canUndoDismiss: n.dismissedAt ? canUndoDismiss({ dismissedAt: n.dismissedAt, now, isAuthor: n.clinicianId === input.actorUserId, elevated }) : false,
      ...extra,
    };
  };

  const orderBy: Prisma.ProgressNoteOrderByWithRelationInput[] =
    input.sort === 'dos_asc' || input.sort === 'oldest_due'
      ? [{ dateOfService: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }]
      : input.sort === 'client'
        ? [{ client: { name: 'asc' } }, { dateOfService: { sort: 'desc', nulls: 'last' } }]
        : [{ dateOfService: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }];

  const sortRows = (rows: WorklistRow[]) => {
    const key = (r: WorklistRow) => r.dateOfService || '';
    if (input.sort === 'client') return rows.sort((a, b) => a.clientName.localeCompare(b.clientName) || key(b).localeCompare(key(a)));
    if (input.sort === 'dos_asc' || input.sort === 'oldest_due') return rows.sort((a, b) => key(a).localeCompare(key(b)));
    return rows.sort((a, b) => key(b).localeCompare(key(a)));
  };
  const pageOf = <T,>(rows: T[]) => rows.slice((input.page - 1) * input.pageSize, input.page * input.pageSize);

  let rows: WorklistRow[] = [];
  let total = 0;
  const tab = input.tab;
  if (tab === 'escalated') {
    const list = sortRows(escalated.notes.map((n) => toRow(n)));
    total = list.length;
    rows = pageOf(list);
  } else if (tab === 'drafts' || tab === 'ready') {
    const list = sortRows((tab === 'drafts' ? draftNotes : readyNotes).map((n) => toRow(n)));
    total = list.length;
    rows = pageOf(list);
  } else if (tab === 'cosign' || tab === 'returned') {
    const ids = tab === 'returned' ? returnedIds : [...reviewerIds, ...authorPendingIds];
    // Reviewer rows come from the co-sign queue (org / supervisee scope); filters still apply
    const notes = ids.length
      ? await prisma.progressNote.findMany({
          where: { AND: [{ id: { in: ids } }, ...filters, tab === 'cosign' ? {} : scope] },
          select: noteSelect,
        })
      : [];
    const list = sortRows(
      notes.map((n) => {
        const r = returns.get(n.id);
        return toRow(n, {
          cosignRole: tab === 'cosign' ? (reviewerIds.includes(n.id) ? 'reviewer' : 'author') : null,
          returnedComment: r?.comment ?? null,
          returnedBy: r?.reviewerName ?? null,
          returnedAt: r?.createdAt?.toISOString() ?? null,
        });
      })
    );
    total = list.length;
    rows = pageOf(list);
  } else if (tab === 'missing') {
    total = missingCount;
    if (total) {
      const appts = await prisma.appointment.findMany({
        where: missingWhere,
        orderBy: { startsAt: input.sort === 'dos_asc' || input.sort === 'oldest_due' ? 'asc' : 'desc' },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        select: {
          id: true,
          startsAt: true,
          type: true,
          isVirtual: true,
          audioOnly: true,
          clinicianId: true,
          clinicianName: true,
          client: { select: { id: true, name: true, image: true, location: { select: { name: true } } } },
        },
      });
      rows = appts.map((a) => {
        const dos = toPracticeWallTime(a.startsAt, policy.timeZone).date;
        const t = noteTimeliness({ dateOfService: dos, now, deadlineHours: policy.deadlineHours, timeZone: policy.timeZone });
        return {
          kind: 'missing' as const,
          noteId: null,
          appointmentId: a.id,
          clientId: a.client.id,
          clientName: a.client.name,
          clientImage: a.client.image ?? null,
          dateOfService: dos,
          noteType: a.type || null,
          cptCode: null,
          durationMinutes: null,
          status: 'Missing' as const,
          clinicianId: a.clinicianId,
          clinicianName: a.clinicianName,
          locationName: a.client.location?.name ?? null,
          daysSinceService: t.daysSinceService,
          timeliness: t.state,
          dueAt: t.dueAt,
          lateEntryLabel: null,
          billingStatus: null,
          claimId: null,
          part2: false,
          aiDrafted: false,
          telehealth: a.isVirtual || a.audioOnly,
          nextStep: 'Write the note for this visit.',
          readyToSign: false,
          stale: false,
          cosignRequired: false,
          cosignedAt: null,
          cosignRole: null,
          returnedComment: null,
          returnedBy: null,
          returnedAt: null,
          appointmentStartsAt: a.startsAt.toISOString(),
          dismissedAt: null,
          dismissedByName: null,
          dismissReason: null,
          canUndoDismiss: false,
        };
      });
    }
  } else {
    const w = tab === 'signed' ? where(mine, SIGNED) : allWhere;
    total = tab === 'signed' ? signedCount : allCount;
    const notes = await prisma.progressNote.findMany({
      where: w,
      select: noteSelect,
      orderBy,
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    });
    rows = notes.map((n) => toRow(n));
  }

  // Late-entry labels stamped at signing
  const signedIds = rows.filter((r) => r.noteId && r.status !== 'Draft').map((r) => r.noteId as string);
  if (signedIds.length) {
    const stamps = await prisma.progressNoteTimeliness
      .findMany({ where: { noteId: { in: signedIds }, lateEntry: true }, select: { noteId: true, label: true } })
      .catch((): { noteId: string; label: string | null }[] => []);
    const byId = new Map<string, string | null>(stamps.map((s) => [s.noteId, s.label]));
    rows = rows.map((r) => (r.noteId && byId.has(r.noteId) ? { ...r, lateEntryLabel: byId.get(r.noteId) ?? null } : r));
  }

  const unsignedStates = [...draftNotes, ...readyNotes].map((n) => {
    const meta = resolveNoteMeta(n);
    return noteTimeliness({
      dateOfService: meta.dateOfService || n.createdAt.toISOString().slice(0, 10),
      endTime: detailById.get(n.id)?.endTime ?? null,
      now,
      deadlineHours: policy.deadlineHours,
      timeZone: policy.timeZone,
    }).state;
  });
  const overdue = unsignedStates.filter((s) => s === 'overdue').length;
  const dueSoon = unsignedStates.filter((s) => s === 'due_soon').length;

  const [clinicianRows, locations] = await Promise.all([
    prisma.progressNote
      .groupBy({ by: ['clinicianId'], where: { AND: [scope, { createdAt: { gte: new Date(now.getTime() - 365 * DAY) } }] }, _count: { _all: true } })
      .catch(() => []),
    prisma.location.findMany({ where: { organizationId: input.organizationId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }).catch(() => []),
  ]);
  const clinicianIds = clinicianRows.map((c) => c.clinicianId).filter((id): id is string => Boolean(id));
  const users = clinicianIds.length
    ? await prisma.user.findMany({ where: { id: { in: clinicianIds } }, select: { id: true, name: true, email: true } })
    : [];

  return {
    tab,
    rows,
    total,
    page: input.page,
    pageSize: input.pageSize,
    counts,
    overdue,
    dueSoon,
    escalation: { visible: escalated.visible, overdueDays: ESCALATION_OVERDUE_DAYS },
    policy: {
      deadlineHours: policy.deadlineHours,
      dueSoonHours: DUE_SOON_HOURS,
      cosignRequiredRoles: policy.cosignRequiredRoles,
      staleDraftDays: policy.staleDraftDays,
      cloneWarnPercent: policy.cloneWarnPercent,
      requireDiagnosisToSign: policy.requireDiagnosisToSign,
      timeZone: policy.timeZone,
    },
    facets: {
      clinicians: users.map((u) => ({ id: u.id, name: u.name || u.email })).sort((a, b) => a.name.localeCompare(b.name)),
      locations,
      programs: Object.keys(NOTE_PROGRAMS),
    },
    canReviewCosign: canReviewCosign || reviewerIds.length > 0,
  };
}

type ServiceDetailView = NonNullable<ReturnType<typeof serializeServiceDetail>>;

/**
 * Unsigned notes more than ESCALATION_OVERDUE_DAYS past due that escalate to the viewer: notes of
 * the viewer's supervisees (SupervisionTrack), and, for clinical / practice directors and admins,
 * notes of authors with no assigned supervisor. Org scope like the co-sign queue (a supervisor
 * oversees supervisees' notes outside their own caseload); no note text is returned.
 */
async function loadEscalatedNotes(input: {
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
  filters: Prisma.ProgressNoteWhereInput[];
  policy: Awaited<ReturnType<typeof loadNotePolicy>>;
  now: Date;
}): Promise<{ visible: boolean; notes: NoteRecord[]; details: Map<string, ServiceDetailView> }> {
  const details = new Map<string, ServiceDetailView>();
  const leadership = ESCALATION_LEADERSHIP_ROLES.includes(String(input.actorRole).toUpperCase());
  const supervisees = await prisma.supervisionTrack
    .findMany({ where: { organizationId: input.organizationId, supervisorId: input.actorUserId }, select: { superviseeId: true } })
    .then((rows) => rows.map((r) => r.superviseeId))
    .catch((): string[] => []);
  if (!leadership && !supervisees.length) return { visible: false, notes: [], details };

  // Coarse date cut (service day + deadline + 7 days, one day of slack); exact due math below
  const cutoff = new Date(input.now.getTime() - (input.policy.deadlineHours * 3_600_000 + (ESCALATION_OVERDUE_DAYS - 1) * DAY));
  const candidates = await prisma.progressNote
    .findMany({
      where: {
        AND: [
          { client: clientOrgFilter(input.organizationId) },
          ...input.filters,
          UNSIGNED,
          NOT_DISMISSED,
          { clinicianId: { not: input.actorUserId } },
          ...(leadership ? [] : [{ clinicianId: { in: supervisees } }]),
          { OR: [{ dateOfService: { lt: cutoff } }, { dateOfService: null, createdAt: { lt: cutoff } }] },
        ],
      },
      select: noteSelect,
      orderBy: { createdAt: 'asc' },
      take: 500,
    })
    .catch((): NoteRecord[] => []);
  if (!candidates.length) return { visible: true, notes: [], details };

  const authorIds = [...new Set(candidates.map((n) => n.clinicianId).filter((id): id is string => Boolean(id)))];
  const [tracks, detailRows] = await Promise.all([
    prisma.supervisionTrack
      .findMany({ where: { organizationId: input.organizationId, superviseeId: { in: authorIds } }, select: { superviseeId: true, supervisorId: true } })
      .catch((): { superviseeId: string; supervisorId: string }[] => []),
    prisma.progressNoteServiceDetail.findMany({ where: { noteId: { in: candidates.map((n) => n.id) } } }).catch(() => []),
  ]);
  for (const d of detailRows) {
    const v = serializeServiceDetail(d);
    if (v) details.set(d.noteId, v);
  }
  const withDue = candidates.map((n) => {
    const meta = resolveNoteMeta(n);
    const t = noteTimeliness({
      dateOfService: meta.dateOfService || n.createdAt.toISOString().slice(0, 10),
      endTime: details.get(n.id)?.endTime ?? null,
      now: input.now,
      deadlineHours: input.policy.deadlineHours,
      timeZone: input.policy.timeZone,
    });
    return { note: n, authorId: n.clinicianId, dueAt: t.dueAt };
  });
  const selected = selectEscalatedOverdue(withDue, {
    viewerId: input.actorUserId,
    viewerRole: String(input.actorRole),
    supervisorByAuthor: new Map(tracks.map((t) => [t.superviseeId, t.supervisorId])),
    now: input.now,
  });
  return { visible: true, notes: selected.map((s) => s.note), details };
}
