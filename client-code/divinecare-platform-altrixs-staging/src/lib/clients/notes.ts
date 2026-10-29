import type { Role } from '@prisma/client';
import { threadAssigneeOr } from '@/lib/messages/assignee';
import { z } from 'zod';
import { parseNoteMeta } from '@/lib/ehr/noteTemplates';
export { parseNoteMeta } from '@/lib/ehr/noteTemplates';
import { prisma } from '@/lib/db/prisma';
import { loadWorkflowStatuses } from '@/lib/notes/workflow-store';
import type { LockedNoteSnapshot } from '@/lib/notes/workflow';
import { canAccessClientChartNotes, canWriteClientChartNotes, clientAccessWhere, clientOrgFilter } from '@/lib/clients/orgScope';
import { ADDENDUM_REASONS } from '@/lib/notes/noteMeta';
import { isCaseloadScoped } from '@/lib/auth/medicalDirector';
import { caseloadAllows } from '@/lib/clients/caseloadAccess';
import { clientPhiBlock, withoutLockedClients } from '@/lib/privacy/lockedRows';
import { loadPlannedPlans } from '@/lib/appointments/plannedCodesDb';
import { plannedPrimaryCode } from '@/lib/appointments/plannedCodes';

type ClientAccessResult =
  | { ok: true; client: { id: string; assignedToId: string | null } }
  | { ok: false; status: number; error: string };

export type SerializedNoteAddendum = {
  id: string;
  reason: string;
  text: string;
  authorName: string | null;
  createdAt: string;
};

export type SerializedProgressNote = {
  id: string;
  body: string;
  createdAt: string;
  clinicianId: string | null;
  clinicianName: string | null;
  clinicianEmail: string | null;
  clinicianImage: string | null;
  workflowStatus: 'Draft' | 'Signed' | 'Locked';
  signedAt: string | null;
  lockedAt: string | null;
  noteType: string | null;
  /** YYYY-MM-DD */
  dateOfService: string | null;
  durationMinutes: number | null;
  cptCode: string | null;
  /** Same value as cptCode; kept for existing readers */
  billingCode?: string | null;
  /** Primary code planned at booking on the linked appointment (display hint only; the note's code bills) */
  scheduledCode?: string | null;
  telehealth?: boolean;
  placeOfService?: string | null;
  part2: boolean;
  /** Same value as part2; kept for existing readers */
  sudConfidential?: boolean;
  aiDrafted: boolean;
  addenda: SerializedNoteAddendum[];
  /** YYYY-MM-DD: signed under the go-live transition with the treatment plan pending; null otherwise */
  planPendingUntil?: string | null;
  /** Appointment the note documents (Start visit reopens it instead of creating a second note) */
  appointmentId?: string | null;
};

export type SerializedEhrProgressNote = SerializedProgressNote & {
  clientId: string;
  clientName: string;
  clientImage: string | null;
};

type NotesError = { ok: false; status: number; error: string };
type ListNotesResult = { ok: true; notes: SerializedProgressNote[] } | NotesError;
type ListEhrNotesResult =
  | {
      ok: true;
      notes: SerializedEhrProgressNote[];
      stats: { today: number; unsigned: number; thisWeek: number; total: number };
    }
  | NotesError;
type CreateNoteResult = { ok: true; note: SerializedProgressNote } | NotesError;

// ─── Metadata (columns, with legacy hidden-comment fallback) ─────────────────

/** Request schema for note metadata; every save path sends what it knows. */
export const noteMetaSchema = z.object({
  noteType: z.string().trim().max(60).nullish(),
  dateOfService: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of service must be YYYY-MM-DD')
    .refine((v) => !Number.isNaN(new Date(`${v}T00:00:00.000Z`).getTime()), 'Invalid date of service')
    .refine(
      (v) => new Date(`${v}T00:00:00.000Z`).getTime() <= Date.now() + 36 * 60 * 60 * 1000,
      'Date of service cannot be in the future'
    )
    .nullish(),
  durationMinutes: z.number().int().min(1).max(1440).nullish(),
  cptCode: z
    .string()
    .trim()
    .max(20)
    .regex(/^[A-Za-z0-9-]*$/, 'Invalid CPT / HCPCS code')
    .nullish(),
  placeOfService: z
    .string()
    .trim()
    .regex(/^(\d{2})?$/, 'Place of service must be a 2-digit code')
    .nullish(),
  telehealth: z.boolean().optional(),
  /** Telehealth by audio only (no video) */
  audioOnly: z.boolean().optional(),
  /** Psychiatric E/M note: psychotherapy add-on billed as a second claim line */
  addOnCptCode: z.enum(['90833', '90836', '90838', '']).nullish(),
  /** Psychotherapy minutes documented separately from the E/M (required with the add-on) */
  psychotherapyMinutes: z.number().int().min(1).max(600).nullish(),
  part2: z.boolean().optional(),
  aiDrafted: z.boolean().optional(),
});

export type NoteMetaInput = z.infer<typeof noteMetaSchema>;

type NoteMetaColumns = {
  noteType: string | null;
  dateOfService: Date | null;
  durationMinutes: number | null;
  cptCode: string | null;
  placeOfService: string | null;
  telehealth: boolean;
  audioOnly: boolean;
  addOnCptCode: string | null;
  psychotherapyMinutes: number | null;
  part2: boolean;
  aiDrafted: boolean;
};

export function dateOfServiceFromInput(value: string | null | undefined): Date | null {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

/** undefined = not sent; '' or null = clear */
function pick<T>(input: T | '' | null | undefined, existing: T | null | undefined, legacy: T | null | undefined): T | null {
  if (input !== undefined) return input === '' ? null : input;
  if (existing != null) return existing;
  return legacy ?? null;
}

/**
 * Column values for a write. Sent values win; otherwise keep the `existing`
 * columns; otherwise fall back to the legacy comment in `legacyBody` (so an old
 * note that is edited keeps its metadata once the comment is dropped from body).
 */
export function noteMetaColumns(
  input: NoteMetaInput,
  existing?: Partial<NoteMetaColumns> | null,
  legacyBody?: string
): NoteMetaColumns {
  const legacy = legacyBody ? parseNoteMeta(legacyBody) : null;
  const cpt = pick(input.cptCode, existing?.cptCode, legacy?.billingCode);
  return {
    noteType: pick(input.noteType, existing?.noteType, legacy?.noteType),
    dateOfService:
      input.dateOfService !== undefined
        ? dateOfServiceFromInput(input.dateOfService)
        : (existing?.dateOfService ?? null),
    durationMinutes: pick(input.durationMinutes, existing?.durationMinutes, legacy?.durationMinutes),
    cptCode: cpt ? cpt.toUpperCase() : null,
    placeOfService: pick(input.placeOfService, existing?.placeOfService, legacy?.placeOfService),
    // Audio-only is telehealth: setting it implies the telehealth flag
    telehealth: (input.telehealth ?? Boolean(existing?.telehealth || legacy?.telehealth)) || Boolean(input.audioOnly),
    audioOnly: input.audioOnly ?? Boolean(existing?.audioOnly),
    addOnCptCode: pick(input.addOnCptCode, existing?.addOnCptCode, null),
    psychotherapyMinutes: pick(input.psychotherapyMinutes, existing?.psychotherapyMinutes, null),
    part2: input.part2 ?? Boolean(existing?.part2 || legacy?.sudConfidential),
    aiDrafted: input.aiDrafted ?? existing?.aiDrafted ?? false,
  };
}

/** Read metadata for display: columns first, legacy hidden comment second. */
export function resolveNoteMeta(note: { body: string } & Partial<NoteMetaColumns>) {
  const legacy = parseNoteMeta(note.body);
  return {
    displayBody: legacy.displayBody,
    noteType: note.noteType || legacy.noteType || null,
    dateOfService: note.dateOfService ? note.dateOfService.toISOString().slice(0, 10) : null,
    durationMinutes: note.durationMinutes ?? legacy.durationMinutes ?? null,
    cptCode: note.cptCode || legacy.billingCode || null,
    placeOfService: note.placeOfService || legacy.placeOfService || null,
    telehealth: Boolean(note.telehealth || legacy.telehealth),
    part2: Boolean(note.part2 || legacy.sudConfidential),
    aiDrafted: Boolean(note.aiDrafted),
  };
}

export function serializeAddendum(a: {
  id: string;
  reason: string;
  text: string;
  authorName: string | null;
  createdAt: Date;
}): SerializedNoteAddendum {
  return {
    id: a.id,
    reason: a.reason,
    text: a.text,
    authorName: a.authorName,
    createdAt: a.createdAt.toISOString(),
  };
}

const addendaInclude = {
  orderBy: { createdAt: 'asc' as const },
  select: { id: true, reason: true, text: true, authorName: true, createdAt: true },
};

// ─── Access ───────────────────────────────────────────────────────────────────

/** Admin / director (or an admin in Role Preview) */
export function isElevatedNoteActor(role: Role | string | null | undefined, baseRole?: Role | string | null) {
  const elevated = ['SUPER_ADMIN', 'ADMIN', 'PRACTICE_DIRECTOR', 'DIRECTOR'];
  return elevated.includes(String(role ?? '')) || elevated.includes(String(baseRole ?? ''));
}

async function findAllowedClient(input: {
  clientId: string;
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
  /** Real account role — Admin Role Preview must still write notes to DB */
  actorBaseRole?: Role | null;
}): Promise<ClientAccessResult> {
  const client = await prisma.client.findFirst({
    where: { id: input.clientId, ...clientOrgFilter(input.organizationId) },
    select: { id: true, assignedToId: true },
  });

  if (!client) {
    return { ok: false as const, status: 404, error: 'Client not found' };
  }

  const elevated =
    input.actorBaseRole === 'ADMIN' || input.actorBaseRole === 'PRACTICE_DIRECTOR';
  if (elevated) {
    return { ok: true as const, client };
  }

  if (!(await caseloadAllows({ organizationId: input.organizationId, userId: input.actorUserId, role: input.actorRole }, client))) {
    const actor = prisma.user
      ? await prisma.user
          .findUnique({
            where: { id: input.actorUserId },
            select: { name: true },
          })
          .catch(() => null)
      : null;
    const actorName = actor?.name?.trim();
    const hasForwardedThread = await prisma.messageThread.findFirst({
      where: {
        clientId: input.clientId,
        organizationId: input.organizationId,
        // Exact (case-insensitive) name / id match, never a substring
        OR: threadAssigneeOr({ userId: input.actorUserId, name: actorName }),
      },
    });
    if (!hasForwardedThread) {
      return { ok: false as const, status: 403, error: 'Forbidden' };
    }
  }

  return { ok: true as const, client };
}

/**
 * Load a note the actor may access: same org, and for caseload roles the
 * client must be on their caseload (or forwarded to them), as for chart notes.
 */
export async function findAccessibleNote(input: {
  noteId: string;
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
  actorBaseRole?: Role | null;
}) {
  const note = await prisma.progressNote.findFirst({
    where: { id: input.noteId, client: clientOrgFilter(input.organizationId) },
    include: {
      workflow: { select: { status: true } },
    },
  });
  if (!note) return { ok: false as const, status: 404, error: 'Note not found' };
  const allowed = await findAllowedClient({ ...input, clientId: note.clientId });
  if (allowed.ok === false) {
    return { ok: false as const, status: allowed.status, error: allowed.error };
  }
  // 42 CFR Part 2 / VIP lock (whitelist, break-glass or PD / ADMIN bypass)
  const locked = await notePhiBlock(input, note.clientId);
  if (locked) return locked;
  return { ok: true as const, note };
}

/** Part 2 / VIP lock for one client's notes; a verified ADMIN / PD base role (Role Preview) keeps its bypass. */
async function notePhiBlock(
  input: { organizationId: string; actorUserId: string; actorRole: Role; actorBaseRole?: Role | null },
  clientId: string,
) {
  const elevated = input.actorBaseRole === 'ADMIN' || input.actorBaseRole === 'PRACTICE_DIRECTOR';
  const blocked = await clientPhiBlock(
    { organizationId: input.organizationId, userId: input.actorUserId, role: elevated ? (input.actorBaseRole as Role) : input.actorRole },
    clientId,
    '/api/notes',
  );
  return blocked ? { ok: false as const, status: blocked.status, error: blocked.body.error } : null;
}

// ─── Serialization ────────────────────────────────────────────────────────────

/** Adds scheduledCode (the linked appointment's planned primary code) for the "Scheduled as" hint. */
async function withScheduledCodes<T extends { appointmentId?: string | null }>(organizationId: string, rows: T[]): Promise<(T & { scheduledCode: string | null })[]> {
  const ids = Array.from(new Set(rows.map((r) => r.appointmentId).filter((x): x is string => Boolean(x))));
  const plans = ids.length ? await loadPlannedPlans(organizationId, ids) : new Map<string, never>();
  return rows.map((r) => ({ ...r, scheduledCode: r.appointmentId ? plannedPrimaryCode(plans.get(r.appointmentId)?.lines ?? []) : null }));
}

type NoteRow = {
  id: string;
  body: string;
  createdAt: Date;
  clinicianId?: string | null;
  appointmentId?: string | null;
  clinician: { name: string | null; email: string; image: string | null } | null;
  addenda?: Parameters<typeof serializeAddendum>[0][];
  workflow: {
    status: 'DRAFT' | 'SIGNED' | 'LOCKED';
    signedAt: Date | null;
    lockedAt: Date | null;
    clinicianName?: string | null;
    clinicianImage?: string | null;
    planPendingUntil?: string | null;
  } | null;
} & Partial<NoteMetaColumns>;

function serializeNote(note: NoteRow): SerializedProgressNote {
  const meta = resolveNoteMeta(note);
  return {
    id: note.id,
    body: meta.displayBody || note.body,
    createdAt: note.createdAt.toISOString(),
    clinicianId: note.clinicianId ?? null,
    clinicianName: note.workflow?.clinicianName || note.clinician?.name || null,
    clinicianEmail: note.clinician?.email ?? null,
    clinicianImage: note.workflow?.clinicianImage || note.clinician?.image || null,
    workflowStatus: note.workflow?.status === 'SIGNED'
      ? 'Signed'
      : note.workflow?.status === 'LOCKED'
        ? 'Locked'
        : 'Draft',
    signedAt: note.workflow?.signedAt?.toISOString() ?? null,
    lockedAt: note.workflow?.lockedAt?.toISOString() ?? null,
    planPendingUntil: note.workflow?.planPendingUntil ?? null,
    appointmentId: note.appointmentId ?? null,
    noteType: meta.noteType,
    dateOfService: meta.dateOfService,
    durationMinutes: meta.durationMinutes,
    cptCode: meta.cptCode,
    billingCode: meta.cptCode,
    telehealth: meta.telehealth,
    placeOfService: meta.placeOfService,
    part2: meta.part2,
    sudConfidential: meta.part2,
    aiDrafted: meta.aiDrafted,
    addenda: (note.addenda || []).map(serializeAddendum),
  };
}

type WorkflowStatusEntry = {
  status: 'Draft' | 'Signed' | 'Locked';
  signedAt: string | null;
  lockedAt: string | null;
  clinicianName: string | null;
  clinicianImage: string | null;
  planPendingUntil?: string | null;
};

function workflowFor(entry: WorkflowStatusEntry | undefined): NoteRow['workflow'] {
  if (!entry) return null;
  return {
    status: entry.status === 'Signed' ? 'SIGNED' : entry.status === 'Locked' ? 'LOCKED' : 'DRAFT',
    signedAt: entry.signedAt ? new Date(entry.signedAt) : null,
    lockedAt: entry.lockedAt ? new Date(entry.lockedAt) : null,
    clinicianName: entry.clinicianName,
    clinicianImage: entry.clinicianImage,
    planPendingUntil: entry.planPendingUntil,
  };
}

export async function listClientNotes(input: {
  clientId: string;
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
  actorBaseRole?: Role | null;
}): Promise<ListNotesResult> {
  const canRead =
    canAccessClientChartNotes(input.actorRole) ||
    input.actorBaseRole === 'ADMIN' ||
    input.actorBaseRole === 'PRACTICE_DIRECTOR';
  if (!canRead) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }
  const allowed = await findAllowedClient(input);
  if (allowed.ok === false) {
    return { ok: false, status: allowed.status, error: allowed.error };
  }
  const locked = await notePhiBlock(input, input.clientId);
  if (locked) return locked;

  const notes = await prisma.progressNote.findMany({
    // Dismissed drafts are out of the chart list (read-only from the notes worklist, "Include dismissed")
    where: { clientId: input.clientId, dismissedAt: null },
    orderBy: { createdAt: 'desc' },
    include: {
      clinician: { select: { name: true, email: true, image: true } },
      addenda: addendaInclude,
    },
  });

  const workflowMap = await loadWorkflowStatuses(notes.map((note) => note.id));

  return {
    ok: true as const,
    notes: await withScheduledCodes(
      input.organizationId,
      notes.map((note) => serializeNote({ ...note, workflow: workflowFor(workflowMap.get(note.id)) }))
    ),
  };
}

export async function listEhrProgressNotes(input: {
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
}): Promise<ListEhrNotesResult> {
  const orgClientWhere = clientOrgFilter(input.organizationId);
  // Caseload roles: clients on their care team, the same rule as the client list and chart
  const clientWhere =
    isCaseloadScoped({ role: input.actorRole, userId: input.actorUserId, organizationId: input.organizationId })
      ? clientAccessWhere({ organizationId: input.organizationId, actorUserId: input.actorUserId, actorRole: input.actorRole })
      : orgClientWhere;

  // Dismissed drafts are out of the feed and its counts (src/lib/notes/dismiss.ts)
  const noteWhere = { client: clientWhere, dismissedAt: null };
  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const weekStart = new Date(dayStart);
  const day = weekStart.getDay();
  weekStart.setDate(weekStart.getDate() + (day === 0 ? -6 : 1 - day));

  const [allNotes, total, today, thisWeek, draftWorkflows] = await Promise.all([
    prisma.progressNote.findMany({
      where: noteWhere,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        client: { select: { id: true, name: true, image: true } },
        clinician: { select: { name: true, email: true, image: true } },
        addenda: addendaInclude,
      },
    }),
    prisma.progressNote.count({ where: noteWhere }),
    prisma.progressNote.count({
      where: { ...noteWhere, createdAt: { gte: dayStart } },
    }),
    prisma.progressNote.count({
      where: { ...noteWhere, createdAt: { gte: weekStart } },
    }),
    // Unsigned = no workflow row yet (drafts only get one when signed) or a DRAFT row
    prisma.progressNote.count({
      where: { ...noteWhere, OR: [{ workflow: { is: null } }, { workflow: { is: { status: 'DRAFT' } } }] },
    }),
  ]);
  // Practice feed: drop notes of Part 2 / VIP clients this actor may not open (fail closed)
  const notes = await withoutLockedClients(
    { organizationId: input.organizationId, userId: input.actorUserId, role: input.actorRole },
    allNotes,
  );
  const workflowMap = await loadWorkflowStatuses(notes.map((note) => note.id));

  return {
    ok: true as const,
    stats: {
      today,
      unsigned: draftWorkflows,
      thisWeek,
      total,
    },
    notes: await withScheduledCodes(
      input.organizationId,
      notes.map((note) => ({
        ...serializeNote({ ...note, workflow: workflowFor(workflowMap.get(note.id)) }),
        clientId: note.client.id,
        clientName: note.client.name,
        clientImage: note.client.image ?? null,
      }))
    ),
  };
}

export async function createClientNote(input: {
  clientId: string;
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
  actorBaseRole?: Role | null;
  body: string;
  meta?: NoteMetaInput;
  /** Appointment the note is started from (chart / appointment popover / telehealth "start note") */
  appointmentId?: string | null;
}): Promise<CreateNoteResult> {
  const canWrite =
    canWriteClientChartNotes(input.actorRole) ||
    input.actorBaseRole === 'ADMIN' ||
    input.actorBaseRole === 'PRACTICE_DIRECTOR';
  if (!canWrite) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }
  const allowed = await findAllowedClient(input);
  if (allowed.ok === false) {
    return { ok: false, status: allowed.status, error: allowed.error };
  }

  // Older clients / offline saves queued before the column change may still send
  // the hidden metadata comment: move it into columns and keep body clean.
  const rawBody = input.body.trim();
  const body = parseNoteMeta(rawBody).displayBody.trim();
  if (!body) {
    return { ok: false as const, status: 400, error: 'Note is required' };
  }
  const columns = noteMetaColumns(input.meta ?? {}, null, rawBody);

  // The linked appointment must be this client's, in this organization. Its audio-only flag is
  // the default for the note. It is a cross-check for billing, never the source of DOS / rendering.
  let appointmentId: string | null = null;
  if (input.appointmentId) {
    const appt = await prisma.appointment.findFirst({
      where: { id: input.appointmentId, clientId: input.clientId, client: clientOrgFilter(input.organizationId) },
      select: { id: true, audioOnly: true },
    });
    if (!appt) return { ok: false, status: 400, error: 'The appointment for this note was not found for this client' };
    appointmentId = appt.id;
    if (input.meta?.audioOnly === undefined && appt.audioOnly) {
      columns.audioOnly = true;
      columns.telehealth = true;
    }
  }

  const note = await prisma.progressNote.create({
    data: {
      clientId: input.clientId,
      clinicianId: input.actorUserId,
      body,
      ...columns,
      appointmentId,
    },
    include: {
      clinician: { select: { name: true, email: true, image: true } },
    },
  });

  return {
    ok: true as const,
    note: serializeNote({
      ...note,
      addenda: [],
      workflow: null,
    }),
  };
}

// ─── Billing readers ──────────────────────────────────────────────────────────

export type LockedNoteSnapshotWithMeta = LockedNoteSnapshot & {
  noteType: string | null;
  dateOfService: string | null;
  durationMinutes: number | null;
  cptCode: string | null;
  placeOfService: string | null;
  telehealth: boolean;
  part2: boolean;
};

/**
 * Add the note metadata columns (legacy comment fallback) to locked-note
 * snapshots. The payload stays a superset of LockedNoteSnapshot.
 */
export async function withNoteMeta(
  snapshots: LockedNoteSnapshot[]
): Promise<LockedNoteSnapshotWithMeta[]> {
  if (snapshots.length === 0) return [];
  const rows = await prisma.progressNote.findMany({
    where: { id: { in: snapshots.map((s) => s.noteId) } },
    select: {
      id: true,
      body: true,
      noteType: true,
      dateOfService: true,
      durationMinutes: true,
      cptCode: true,
      placeOfService: true,
      telehealth: true,
      part2: true,
    },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return snapshots.map((s) => {
    const meta = resolveNoteMeta(byId.get(s.noteId) ?? { body: s.body });
    return {
      ...s,
      noteType: meta.noteType,
      dateOfService: meta.dateOfService,
      durationMinutes: meta.durationMinutes,
      cptCode: meta.cptCode,
      placeOfService: meta.placeOfService,
      telehealth: meta.telehealth,
      part2: meta.part2,
    };
  });
}

// ─── Addenda ──────────────────────────────────────────────────────────────────

export const addendumSchema = z.object({
  reason: z.enum(ADDENDUM_REASONS, { message: 'Select a reason for the addendum' }),
  text: z.string().trim().min(1, 'Addendum text is required').max(8000, 'Addendum is too long'),
});

/**
 * Attach an addendum to a signed or locked note. The note body is never
 * changed; the addendum is its own row authored by the caller.
 */
export async function addNoteAddendum(input: {
  noteId: string;
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
  actorBaseRole?: Role | null;
  reason: (typeof ADDENDUM_REASONS)[number];
  text: string;
}) {
  // Role checks run in the routes; here: org + caseload scope and note status.
  const found = await findAccessibleNote(input);
  if (found.ok === false) return found;
  const status = found.note.workflow?.status;
  if (status !== 'SIGNED' && status !== 'LOCKED') {
    return {
      ok: false as const,
      status: 409,
      error: 'Addenda can only be added to signed or locked notes. Edit the draft instead.',
    };
  }

  const author = await prisma.user
    .findUnique({ where: { id: input.actorUserId }, select: { name: true, email: true } })
    .catch(() => null);
  const row = await prisma.progressNoteAddendum.create({
    data: {
      noteId: found.note.id,
      reason: input.reason,
      text: input.text.trim(),
      authorId: input.actorUserId,
      authorName: author?.name?.trim() || author?.email || null,
    },
  });
  return { ok: true as const, clientId: found.note.clientId, addendum: serializeAddendum(row) };
}
