import type {
  AppointmentNoteStatus,
  AppointmentStatus,
  Prisma,
  Role,
} from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { triggerAutopayAfterVisitStatus } from '@/lib/patientPayments/visitTrigger';
import {
  DEFAULT_PRACTICE_TIME_ZONE,
  fromPracticeWallTime,
  parseAppointmentDateTime,
  practiceToday,
  toPracticeWallTime,
} from '@/lib/time/practiceTime';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { isCaseloadRole, isMedicalRole } from '@/types/roles';
import type { AppointmentType } from '@/features/appointments';
import { behavioralCareTeamClientWhere, canAccessClientAppointments, clientByIdWhere } from '@/lib/clients/orgScope';
import {
  appointmentOrgWhere,
  duplicateAppointmentFailure,
  duplicateLockKey,
  findDuplicateAppointment,
} from '@/lib/appointments/duplicates';
import {
  notesForStaffUi,
  parseTelehealthMeta,
  staffHostMeetingUrl,
  writeTelehealthMeta,
  type TelehealthMeta,
} from '@/lib/telehealth/meta';
import { clientTelehealthJoinUrl } from '@/lib/telehealth/joinUrl';
import { provisionTelehealthMeeting } from '@/lib/telehealth/meeting';
import { sendAppointmentCreatedEmail, sendAppointmentCreatedSms } from '@/patient';
import { sendToUser } from '@/lib/notifications/pushService';
import {
  autoApplySuggestedLabel,
  withLabelFields,
  writeAppointmentLabelId,
} from '@/lib/scheduling/appointmentLabelsServer';
import { appointmentListWindow } from '@/lib/appointments/listWindow';
import {
  clinicianLockKey,
  clinicianOverlapFailure,
  findClinicianOverlaps,
  parseOverbook,
} from '@/lib/appointments/overlap';
import { loadAppointmentNoteSummaries, type AppointmentNoteSummary } from '@/lib/analytics/visitDocumentationServer';
import type { DerivedNoteStatus } from '@/lib/analytics/visitDocumentation';
import { deriveDocLight, EMPTY_NOTE_SUMMARY, visitPaymentStatus, type VisitPayment } from '@/lib/appointments/docLight';
import { practiceNoteSignDeadlineHours } from '@/lib/practice/consumers';
import { canReadLedger } from '@/lib/billing/ledger';
import { FO_VISIT_KIND, stepIdFor } from '@/lib/frontOffice/rules';
import { isCaseloadScoped } from '@/lib/auth/medicalDirector';
import { caseloadAllows } from '@/lib/clients/caseloadAccess';
import { checkInConsentDecision, recordCheckInOverride } from '@/lib/consents/library/checkIn';
import { checkInAllowed, consentRequiredFailure } from '@/lib/consents/library/decisions';
import { SCHEDULABLE_STAFF_STATUSES } from '@/lib/staff/schedulable';
import { loadPlannedPlans } from '@/lib/appointments/plannedCodesDb';
import { plannedCodeSummary } from '@/lib/appointments/plannedCodes';

export type VisitStatusUi =
  | 'scheduled'
  | 'checked-in'
  | 'in-session'
  | 'completed'
  | 'cancelled'
  | 'no-show'
  | 'late-cancel';

export type NoteStatusUi = 'not-started' | 'ai-draft' | 'in-progress' | 'signed';

const UI_STATUS: Record<AppointmentStatus, VisitStatusUi> = {
  SCHEDULED: 'scheduled',
  CHECKED_IN: 'checked-in',
  IN_SESSION: 'in-session',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  NO_SHOW: 'no-show',
  LATE_CANCEL: 'late-cancel',
};

const DB_STATUS: Record<string, AppointmentStatus> = {
  scheduled: 'SCHEDULED',
  'checked-in': 'CHECKED_IN',
  'in-session': 'IN_SESSION',
  completed: 'COMPLETED',
  cancelled: 'CANCELLED',
  'no-show': 'NO_SHOW',
  'late-cancel': 'LATE_CANCEL',
  SCHEDULED: 'SCHEDULED',
  CHECKED_IN: 'CHECKED_IN',
  IN_SESSION: 'IN_SESSION',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  NO_SHOW: 'NO_SHOW',
  LATE_CANCEL: 'LATE_CANCEL',
};

const UI_NOTE: Record<AppointmentNoteStatus, NoteStatusUi> = {
  NOT_STARTED: 'not-started',
  AI_DRAFT: 'ai-draft',
  IN_PROGRESS: 'in-progress',
  SIGNED: 'signed',
};

const DB_NOTE: Record<string, AppointmentNoteStatus> = {
  'not-started': 'NOT_STARTED',
  'ai-draft': 'AI_DRAFT',
  'in-progress': 'IN_PROGRESS',
  signed: 'SIGNED',
  NOT_STARTED: 'NOT_STARTED',
  AI_DRAFT: 'AI_DRAFT',
  IN_PROGRESS: 'IN_PROGRESS',
  SIGNED: 'SIGNED',
};

/** Allowed visit transitions (UI keys). */
export const VISIT_TRANSITIONS: Record<VisitStatusUi, VisitStatusUi[]> = {
  scheduled: ['checked-in', 'no-show', 'cancelled', 'late-cancel'],
  'checked-in': ['in-session', 'no-show', 'cancelled'],
  'in-session': ['completed'],
  completed: [],
  'no-show': [],
  cancelled: [],
  'late-cancel': [],
};

/**
 * date / startTime / endTime are the PRACTICE wall clock (not the server's UTC clock). Before,
 * these used Date#getHours on a UTC server, so the calendar showed UTC hours (an imported
 * 9:00 AM ET visit read 1:00 PM) while the chart converted startsAt correctly.
 */
/** Staff name shown as "Booked by" / "Last changed by" (falls back to the email). */
async function staffDisplayName(userId: string): Promise<string | null> {
  // Display only: a failed lookup never blocks booking or rescheduling
  try {
    const u = await prisma.user.findFirst({ where: { id: userId }, select: { name: true, email: true } });
    return u?.name?.trim() || u?.email || null;
  } catch {
    return null;
  }
}

function practiceDate(d: Date, timeZone: string) {
  return toPracticeWallTime(d, timeZone).date;
}

function practiceTime(d: Date, timeZone: string) {
  return toPracticeWallTime(d, timeZone).time;
}

function serialize(timeZone: string, a: {
  id: string;
  clientId: string;
  clientName: string | null;
  type: string;
  startsAt: Date;
  endsAt: Date;
  status: AppointmentStatus;
  noteStatus: AppointmentNoteStatus;
  isVirtual: boolean;
  notes: string | null;
  clinicianId: string | null;
  clinicianName: string | null;
  organizationId: string | null;
  client: { name: string; image: string | null };
  clinician: { name: string | null } | null;
  audioOnly?: boolean | null;
  seriesId?: string | null;
  confirmedAt?: Date | null;
  groupSessionId?: string | null;
  createdAt?: Date | null;
  createdByName?: string | null;
  createdVia?: string | null;
  lastChangedByName?: string | null;
  lastChangedAt?: Date | null;
}) {
  const meta = parseTelehealthMeta(a.notes);
  const clientJoinUrl = a.isVirtual
    ? clientTelehealthJoinUrl({
        appointmentId: a.id,
        clientId: a.clientId,
        endsAt: a.endsAt,
        meta,
      })
    : null;
  const hostJoinUrl = a.isVirtual
    ? staffHostMeetingUrl(meta) || clientJoinUrl
    : null;
  return {
    id: a.id,
    clientId: a.clientId,
    clientName: a.clientName?.trim() || a.client.name,
    clientImage: a.client.image,
    clinicianId: a.clinicianId,
    clinicianName: a.clinicianName?.trim() || a.clinician?.name || null,
    organizationId: a.organizationId,
    type: a.type,
    date: practiceDate(a.startsAt, timeZone),
    startTime: practiceTime(a.startsAt, timeZone),
    endTime: practiceTime(a.endsAt, timeZone),
    /** Zone the date / startTime / endTime above are in. */
    timeZone,
    startsAt: a.startsAt.toISOString(),
    endsAt: a.endsAt.toISOString(),
    status: UI_STATUS[a.status],
    noteStatus: UI_NOTE[a.noteStatus],
    isVirtual: a.isVirtual,
    videoProvider: a.isVirtual ? meta.provider || 'in_app' : null,
    hostJoinUrl,
    clientJoinUrl,
    notes: notesForStaffUi(a.notes),
    /** Phone-only telehealth: notes / claims default their audio-only flag from this */
    audioOnly: Boolean(a.audioOnly),
    seriesId: a.seriesId ?? null,
    confirmedAt: a.confirmedAt ? a.confirmedAt.toISOString() : null,
    /** Per-member visit of a group session (src/lib/groups); the facilitator has one per member */
    groupSessionId: a.groupSessionId ?? null,
    /** Who put the visit on the schedule and who last changed it (staff names only) */
    bookedBy: {
      name: a.createdByName ?? null,
      via: a.createdVia ?? null,
      at: a.createdAt ? a.createdAt.toISOString() : null,
    },
    lastChangedBy: a.lastChangedAt
      ? { name: a.lastChangedByName ?? null, at: a.lastChangedAt.toISOString() }
      : null,
  };
}

export type AppointmentDto = ReturnType<typeof serialize>;

type LabelSourceRow = Parameters<typeof serialize>[1] & { rescheduleRequestedAt?: Date | null };

/** serialize() + calendar label fields (labelId, label chip, suggested label meaning). */
/**
 * Note status from the linked ProgressNoteWorkflow (ProgressNote.appointmentId), not the stored
 * Appointment.noteStatus alone: "signed" only when a linked note is signed or locked; a linked
 * draft is "in-progress"; a stored "ai-draft" is kept until a note exists. Never "signed" by default.
 */
function derivedNoteStatus(stored: NoteStatusUi, derived: DerivedNoteStatus | undefined): NoteStatusUi {
  if (derived === 'SIGNED') return 'signed';
  if (derived === 'IN_PROGRESS') return stored === 'ai-draft' ? 'ai-draft' : 'in-progress';
  return stored === 'ai-draft' ? 'ai-draft' : 'not-started';
}

/**
 * Copay status per visit for roles that read the ledger (front office, billing, leadership):
 * card charges (PatientCharge kind copay) + the front-office "copay collected" mark. Two queries
 * for the whole list; other roles get no payment field.
 */
async function loadVisitPayments(organizationId: string, ids: string[], role: Role | undefined): Promise<Map<string, VisitPayment | null>> {
  const out = new Map<string, VisitPayment | null>();
  if (!ids.length || !canReadLedger(role)) return out;
  const [charges, marks] = await Promise.all([
    prisma.patientCharge
      .findMany({ where: { organizationId, appointmentId: { in: ids }, kind: 'copay' }, select: { appointmentId: true, status: true } })
      .catch(() => []),
    prisma.visitChecklistItem
      .findMany({
        where: { organizationId, appointmentId: { in: ids }, visitKind: FO_VISIT_KIND, stepId: stepIdFor('copay'), status: 'done' },
        select: { appointmentId: true },
      })
      .catch(() => []),
  ]);
  const marked = new Set(marks.map((m) => m.appointmentId));
  const byAppt = new Map<string, string[]>();
  for (const c of charges) {
    if (!c.appointmentId) continue;
    byAppt.set(c.appointmentId, [...(byAppt.get(c.appointmentId) ?? []), c.status]);
  }
  for (const id of ids) out.set(id, visitPaymentStatus({ chargeStatuses: byAppt.get(id) ?? [], markedCollected: marked.has(id) }));
  return out;
}

async function serializeWithLabels(organizationId: string, rows: LabelSourceRow[], opts: { role?: Role; now?: Date } = {}) {
  const ids = rows.map((r) => r.id);
  const [timeZone, noteSummaries, deadlineHours, payments, plans] = await Promise.all([
    getPracticeTimeZone(organizationId),
    loadAppointmentNoteSummaries(ids).catch(() => new Map<string, AppointmentNoteSummary>()),
    practiceNoteSignDeadlineHours(organizationId),
    loadVisitPayments(organizationId, ids, opts.role).catch(() => new Map<string, VisitPayment | null>()),
    // Planned billing codes (codes only; the signed note's codes bill). Empty when not migrated.
    loadPlannedPlans(organizationId, ids).catch(() => new Map()),
  ]);
  const now = opts.now ?? new Date();
  return withLabelFields(
    organizationId,
    rows.map((r) => ({
      id: r.id,
      clientId: r.clientId,
      startsAt: r.startsAt,
      status: r.status,
      isVirtual: r.isVirtual,
      notes: r.notes,
      rescheduleRequestedAt: r.rescheduleRequestedAt ?? null,
    })),
    rows.map((r) => {
      const dto = serialize(timeZone, r);
      const notes = noteSummaries.get(r.id);
      const noteStatus = derivedNoteStatus(dto.noteStatus, notes?.status);
      // Documentation status light (scheduler dot): linked non-dismissed notes + the practice deadline
      const docLight = deriveDocLight({
        status: dto.status,
        date: dto.date,
        endTime: dto.endTime,
        endsAt: dto.endsAt,
        notes: { ...(notes?.summary ?? EMPTY_NOTE_SUMMARY), hasNote: Boolean(notes?.summary.hasNote) || noteStatus === 'ai-draft' },
        now,
        deadlineHours,
        timeZone,
      });
      return { ...dto, noteStatus, docLight, payment: payments.get(r.id) ?? null, plannedCodes: plannedCodeSummary(plans.get(r.id)?.lines ?? []) };
    })
  );
}

export type CreateAppointmentInput = {
  clientId: string;
  type: AppointmentType | string;
  /**
   * Preferred: explicit instants (ISO with Z / offset). A naive "YYYY-MM-DDTHH:mm" is read on the
   * practice clock and logged. When absent, date + startTime (+ endTime) are practice wall time.
   */
  startsAt?: string | null;
  endsAt?: string | null;
  date?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  isVirtual?: boolean;
  notes?: string | null;
  clinicianId?: string | null;
  videoProvider?: 'zoom' | 'google' | 'in_app' | null;
  /** Calendar label (AppointmentLabel id) chosen in the form */
  labelId?: string | null;
  /**
   * Book even when the same client + clinician + start already has a live appointment.
   * Server-side escape hatch only; the staff calendar never sends it.
   */
  allowDuplicate?: boolean;
  /** Book over another appointment of the same clinician on purpose; requires overbookReason (audited). */
  allowOverbook?: boolean;
  overbookReason?: string | null;
  /** Telehealth by phone only (no video); notes / claims default their audio-only flag from it. */
  audioOnly?: boolean;
  /** Internal: occurrence of a recurring series (src/lib/scheduling/series.ts). */
  seriesId?: string | null;
  /** Internal: series occurrences after the first send no confirmation email / SMS / push each. */
  suppressNotifications?: boolean;
};

type VideoProvider = 'zoom' | 'google' | 'in_app';

/** Telehealth meta for a new (or newly virtual) appointment; provisions Zoom / Meet when chosen. */
async function buildTelehealthMeta(
  provider: VideoProvider,
  opts: { topic: string; start: Date; end: Date }
): Promise<{ ok: true; meta: TelehealthMeta } | { ok: false; error: string }> {
  let meta: TelehealthMeta = { provider };
  if (provider === 'zoom' || provider === 'google') {
    try {
      const meeting = await provisionTelehealthMeeting({
        platform: provider === 'google' ? 'GOOGLE' : 'ZOOM',
        topic: opts.topic,
        startAt: opts.start,
        durationMin: Math.max(15, Math.round((opts.end.getTime() - opts.start.getTime()) / 60000)),
      });
      meta =
        provider === 'zoom'
          ? { ...meta, zoomMeetingId: meeting.roomId, zoomJoinUrl: meeting.joinUrl, zoomStartUrl: meeting.hostUrl }
          : { ...meta, googleEventId: meeting.roomId, googleMeetJoinUrl: meeting.joinUrl };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Could not create meeting' };
    }
  }
  return { ok: true, meta };
}

/** 'chime' is the in-app video room under another name. */
function normalizeProvider(p: string | null | undefined): VideoProvider {
  if (p === 'zoom' || p === 'google') return p;
  return 'in_app';
}

const include = {
  client: { select: { name: true, image: true } },
  clinician: { select: { name: true } },
} as const;


export async function listAppointmentsForUser(
  actor: {
    id: string;
    role: Role;
    organizationId: string;
  },
  options?: { clientId?: string; isVirtual?: boolean; date?: string; from?: string; to?: string }
) {
  if (!canAccessClientAppointments(actor.role)) {
    return [];
  }

  const orgFilter = appointmentOrgWhere(actor.organizationId);

  // Caseload clinicians see their own bookings plus appointments of clients on their care team
  // (assigned, treatment team, or seen in the last ~18 months: clientAccessWhere).
  let where: Prisma.AppointmentWhereInput = isMedicalRole(actor.role)
    ? { AND: [orgFilter, { OR: [{ clinicianId: actor.id }, { client: { assignedToId: actor.id } }] }] }
    : isCaseloadScoped({ role: actor.role, userId: actor.id, organizationId: actor.organizationId })
      ? { AND: [orgFilter, { OR: [{ clinicianId: actor.id }, { client: behavioralCareTeamClientWhere(actor.id) }] }] }
      : orgFilter;

  if (options?.clientId) {
    const client = await prisma.client.findFirst({
      where: clientByIdWhere(options.clientId, actor.organizationId),
      select: { id: true, assignedToId: true },
    });

    if (!client) return [];

    // Care team (same rule as the client list / chart), not only the primary assignee
    if (!(await caseloadAllows({ organizationId: actor.organizationId, userId: actor.id, role: actor.role }, client))) {
      return [];
    }

    where = { AND: [orgFilter, { clientId: options.clientId }] };
  }

  if (options?.isVirtual) {
    where = { AND: [where, { isVirtual: true }] };
  }
  // Date window on the practice calendar (src/lib/appointments/listWindow.ts): one day, from/to,
  // or 90 days back through 365 ahead by default. A clientId with no dates has no cap (chart history).
  const tz = await getPracticeTimeZone(actor.organizationId);
  const win = appointmentListWindow(
    { date: options?.date, from: options?.from, to: options?.to, clientId: options?.clientId },
    tz
  );
  if (win.ok === false) return [];
  if (win.window) {
    where = { AND: [where, { startsAt: { gte: win.window.start, lt: win.window.end } }] };
  }

  const rows = await prisma.appointment.findMany({
    where,
    orderBy: { startsAt: options?.clientId ? 'desc' : 'asc' },
    include,
  });

  return serializeWithLabels(actor.organizationId, rows, { role: actor.role });
}

/**
 * Start / end instants for a booking or reschedule. Explicit startsAt/endsAt (ISO with offset)
 * are used as is; naive datetimes and date + startTime are practice wall-clock times (never UTC:
 * reading the form's "09:44" as UTC is what stored a 9:44 AM ET visit as 5:44 AM ET).
 */
export function resolveAppointmentTimes(
  input: {
    startsAt?: string | null;
    endsAt?: string | null;
    date?: string | null;
    startTime?: string | null;
    endTime?: string | null;
  },
  timeZone: string
): { ok: true; start: Date; end: Date } | { ok: false; error: string } {
  let start: Date | null = null;
  let end: Date | null = null;
  if (input.startsAt) {
    const parsed = parseAppointmentDateTime(input.startsAt, timeZone);
    if (!parsed) return { ok: false, error: 'Invalid date/time' };
    if (parsed.naive) {
      console.warn('[appointments] naive startsAt without offset; read as practice time', { timeZone });
    }
    start = parsed.at;
    if (input.endsAt) {
      const pe = parseAppointmentDateTime(input.endsAt, timeZone);
      if (!pe) return { ok: false, error: 'Invalid date/time' };
      if (pe.naive) console.warn('[appointments] naive endsAt without offset; read as practice time', { timeZone });
      end = pe.at;
    }
  } else {
    if (!input.date || !input.startTime) return { ok: false, error: 'Date and start time are required' };
    start = fromPracticeWallTime(input.date, input.startTime, timeZone);
    if (!start) return { ok: false, error: 'Invalid date/time' };
    if (input.endTime) {
      end = fromPracticeWallTime(input.date, input.endTime, timeZone);
      if (!end) return { ok: false, error: 'Invalid date/time' };
    }
  }
  if (!end) end = new Date(start.getTime() + 50 * 60 * 1000);
  if (end <= start) return { ok: false, error: 'End time must be after start' };
  return { ok: true, start, end };
}

export async function createAppointment(
  input: CreateAppointmentInput,
  actorUserId: string,
  organizationId: string,
  actorRole: Role
) {
  const client = await prisma.client.findFirst({
    where: clientByIdWhere(input.clientId, organizationId),
  });
  if (!client) {
    return { ok: false as const, error: 'Client not found', status: 404 };
  }
  // Care-team members (treatment team / visit clinician) may book for the client, like the primary
  if (!(await caseloadAllows({ organizationId, userId: actorUserId, role: actorRole }, client))) {
    return { ok: false as const, error: 'Not your patient', status: 403 };
  }
  if (client.status === 'DISCHARGED') {
    return {
      ok: false as const,
      error: 'Cannot schedule for a discharged client',
      status: 400,
    };
  }

  const timeZone = await getPracticeTimeZone(organizationId);
  const when = resolveAppointmentTimes(input, timeZone);
  const actorName = await staffDisplayName(actorUserId);
  if (when.ok === false) return { ok: false as const, error: when.error, status: 400 };
  const { start, end } = when;

  const type = input.type.trim();
  if (!type) {
    return { ok: false as const, error: 'Appointment type is required', status: 400 };
  }

  // A caseload clinician booking without picking a clinician books themselves (a treatment-team
  // psychiatrist booking med management is not booking the primary therapist).
  const clinicianId = isCaseloadScoped({ role: actorRole, userId: actorUserId, organizationId })
    ? input.clinicianId || actorUserId
    : isCaseloadRole(actorRole)
      ? input.clinicianId || client.assignedToId || actorUserId
      : input.clinicianId || client.assignedToId;
  if (!clinicianId) {
    return {
      ok: false as const,
      error: 'Clinician is required for this appointment',
      status: 400,
    };
  }

  const clinician = await prisma.user.findFirst({
    where: { id: clinicianId, organizationId, status: { in: SCHEDULABLE_STAFF_STATUSES } },
  });
  if (!clinician) {
    return { ok: false as const, error: 'Clinician not found in your organization', status: 400 };
  }
  const effectiveClinicianId = clinician.id;

  // Same client + clinician + start already booked (and not cancelled)? Checked before any
  // Zoom/Meet provisioning so a duplicate never creates a meeting; re-checked under a lock below.
  const slotKey = { organizationId, clientId: client.id, clinicianId: effectiveClinicianId, startsAt: start };
  if (!input.allowDuplicate) {
    const dup = await findDuplicateAppointment(prisma, slotKey);
    if (dup) return duplicateAppointmentFailure(dup.id);
  }

  // Clinician double-booking: any live appointment of this clinician overlapping [start, end).
  // Staff may overbook on purpose only with a reason (stored + audited). Re-checked under a lock.
  // allowDuplicate (server-only escape hatch, audited by the route) skips it as before.
  const overbook = parseOverbook(input);
  if (overbook.ok === false) return { ok: false as const, error: overbook.error, status: 400 };
  const overlapKey = { organizationId, clinicianId: effectiveClinicianId, start, end };
  // A reason is recorded only when the visit really overlaps another (a stale "book anyway" on a
  // free time is not an overbook).
  let overbookReason: string | null = null;
  if (!input.allowDuplicate) {
    const conflicts = await findClinicianOverlaps(prisma, overlapKey);
    if (conflicts.length) {
      if (!overbook.reason) return clinicianOverlapFailure(conflicts);
      overbookReason = overbook.reason;
    }
  }
  const checkOverlap = !input.allowDuplicate && !overbookReason;

  let notes = input.notes?.trim() || null;
  let telehealthMeta: TelehealthMeta | null = null;
  if (input.isVirtual) {
    const built = await buildTelehealthMeta(input.videoProvider || 'in_app', {
      topic: `${type} — ${client.name}`,
      start,
      end,
    });
    if (built.ok === false) return { ok: false as const, error: built.error, status: 400 };
    telehealthMeta = built.meta;
    notes = writeTelehealthMeta(notes, built.meta);
  }

  if (input.labelId) {
    const label = await prisma.appointmentLabel
      .findFirst({ where: { id: input.labelId, organizationId, active: true }, select: { id: true } })
      .catch(() => null);
    if (!label) {
      return { ok: false as const, error: 'Calendar label not found or turned off', status: 400 };
    }
  }

  const created = await prisma.$transaction(async (tx) => {
    if (!input.allowDuplicate) {
      // Serialize concurrent creates for this exact slot (double-click, two tabs), then re-check.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${duplicateLockKey(slotKey)}))`;
      const dup = await findDuplicateAppointment(tx, slotKey);
      if (dup) return { duplicateOf: dup.id } as const;
    }
    if (checkOverlap) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${clinicianLockKey(organizationId, effectiveClinicianId)}))`;
      const conflicts = await findClinicianOverlaps(tx, overlapKey);
      if (conflicts.length) return { overlap: conflicts } as const;
    }
    const row = await tx.appointment.create({
      data: {
        organizationId,
        clientId: client.id,
        clientName: client.name,
        clinicianId: effectiveClinicianId,
        clinicianName: clinician.name,
        type,
        startsAt: start,
        endsAt: end,
        status: 'SCHEDULED',
        noteStatus: 'NOT_STARTED',
        isVirtual: Boolean(input.isVirtual),
        audioOnly: Boolean(input.isVirtual && input.audioOnly),
        overbookReason,
        seriesId: input.seriesId ?? null,
        notes,
        createdById: actorUserId,
        createdByName: actorName,
        createdVia: 'staff',
      },
      include,
    });
    return { row } as const;
  });
  if ('duplicateOf' in created) return duplicateAppointmentFailure(created.duplicateOf);
  if ('overlap' in created) return clinicianOverlapFailure(created.overlap);
  const { row } = created;

  let labelApplied: 'chosen' | string | null = null;
  if (input.labelId) {
    const set = await writeAppointmentLabelId(organizationId, row.id, input.labelId);
    if (set.ok) labelApplied = 'chosen';
  } else {
    labelApplied = await autoApplySuggestedLabel(organizationId, row);
  }
  const [appointment] = await serializeWithLabels(organizationId, [row]);
  const joinUrl =
    appointment.isVirtual && telehealthMeta
      ? clientTelehealthJoinUrl({
          appointmentId: row.id,
          clientId: row.clientId,
          endsAt: row.endsAt,
          meta: telehealthMeta,
        })
      : null;
  const clientEmail = client.email?.trim();
  if (clientEmail && !input.suppressNotifications) {
    try {
      await sendAppointmentCreatedEmail({
        to: clientEmail,
        clientName: appointment.clientName,
        type: appointment.type,
        date: appointment.date,
        startTime: appointment.startTime,
        endTime: appointment.endTime,
        isVirtual: appointment.isVirtual,
        clinicianName: appointment.clinicianName,
        videoProvider: input.isVirtual ? input.videoProvider || 'in_app' : null,
        joinUrl,
      });
    } catch (err) {
      console.error('[appointments] confirmation email failed', err);
    }
  }

  // TCPA: consent gate (src/lib/sms/patientSms.ts): consent, no STOP / revoked consent, valid
  // charted number, practice "SMS confirmation" setting on. Never throws; every skip is logged.
  let sms: { sent: boolean; reason?: string; message: string } | null = null;
  if (client.phone?.trim() && !input.suppressNotifications) {
    const text = await sendAppointmentCreatedSms({
      clientId: client.id,
      organizationId,
      appointmentId: row.id,
      timeZone: appointment.timeZone,
      date: appointment.date,
      startTime: appointment.startTime,
      endTime: appointment.endTime,
      actor: { userId: actorUserId, role: actorRole },
    });
    if (text) sms = { sent: text.sent, ...('reason' in text ? { reason: text.reason } : {}), message: text.message };
  }

  // Mobile App Push Notification with exact appointment timing
  if (!input.suppressNotifications) try {
    const docName = appointment.clinicianName || 'Your clinician';
    const isVirt = Boolean(appointment.isVirtual);
    void sendToUser(input.clientId, {
      type: 'appointment_reminder',
      // Lock-screen text: no clinician name, no visit type (minimum necessary).
      title: 'Appointment scheduled',
      body: `Your appointment is confirmed for ${appointment.date} at ${appointment.startTime}. Open the app for details.`,
      data: {
        type: 'appointment_reminder',
        appointmentId: row.id,
        date: appointment.date,
        startTime: appointment.startTime,
        endTime: appointment.endTime || '',
        isVirtual: String(isVirt),
        doctorName: docName,
        joinUrl: joinUrl || '',
      },
    }).catch((pushErr) => {
      console.warn('[push] Appointment created push note:', pushErr);
    });
  } catch {
    /* ignore */
  }

  return { ok: true as const, appointment, labelApplied, overbookReason, sms };
}

export type AppointmentPatch = {
  visitStatus?: string | null;
  noteStatus?: string | null;
  notes?: string | null;
  /** @deprecated use visitStatus */
  status?: string | null;
  // Edit Details (reschedule / reassign). The client is not editable: another patient is a new booking.
  type?: string | null;
  /** Instants (ISO with offset preferred; naive = practice wall time). Win over date/startTime. */
  startsAt?: string | null;
  endsAt?: string | null;
  date?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  clinicianId?: string | null;
  isVirtual?: boolean | null;
  videoProvider?: 'zoom' | 'google' | 'in_app' | 'chime' | null;
  /** Same escape hatch as CreateAppointmentInput.allowDuplicate; the staff calendar never sends it. */
  allowDuplicate?: boolean;
  /** Intentional overbook over another appointment of the same clinician; reason required (audited). */
  allowOverbook?: boolean;
  overbookReason?: string | null;
  /** Telehealth by phone only. Allowed until the visit is cancelled (may be set during the call). */
  audioOnly?: boolean | null;
  /** Internal: other appointments that never conflict (series siblings moved in the same edit). */
  overlapExcludeIds?: string[];
  /** Internal: occurrence moved with its series ("this and following" / "entire series"). */
  seriesId?: string | null;
  /** Check-in without the consent to treatment / telehealth consent: staff reason (10+ chars) */
  consentOverrideReason?: string | null;
};

/** Visits that can still be moved or reassigned. Finished and cancelled visits are history. */
const RESCHEDULABLE: AppointmentStatus[] = ['SCHEDULED', 'CHECKED_IN'];

export async function updateAppointment(
  id: string,
  patch: AppointmentPatch,
  actor: { id: string; role: Role; organizationId: string }
) {
  const existing = await prisma.appointment.findFirst({
    where: { id, AND: [appointmentOrgWhere(actor.organizationId)] },
    include: { client: { select: { id: true, assignedToId: true, name: true } } },
  });
  if (!existing) {
    return { ok: false as const, error: 'Appointment not found', status: 404 };
  }

  // The visit's own clinician, or anyone on the client's care team (same rule as the chart)
  if (existing.clinicianId !== actor.id && !(await caseloadAllows({ organizationId: actor.organizationId, userId: actor.id, role: actor.role }, existing.client))) {
    return { ok: false as const, error: 'Not your patient', status: 403 };
  }

  const data: Prisma.AppointmentUpdateInput = {};
  const changedFields: string[] = [];

  const visitInput = patch.visitStatus ?? patch.status;
  if (visitInput != null && visitInput !== '') {
    const next = DB_STATUS[visitInput];
    if (!next) {
      return { ok: false as const, error: 'Invalid visit status', status: 400 };
    }
    const currentUi = UI_STATUS[existing.status];
    const nextUi = UI_STATUS[next];
    const allowed = VISIT_TRANSITIONS[currentUi] || [];
    if (nextUi !== currentUi && !allowed.includes(nextUi)) {
      return {
        ok: false as const,
        error: `Cannot change visit status from ${currentUi} to ${nextUi}`,
        status: 400,
      };
    }
    data.status = next;
    if (next !== existing.status) changedFields.push('status');
  }

  if (patch.noteStatus != null && patch.noteStatus !== '') {
    const note = DB_NOTE[patch.noteStatus];
    if (!note) {
      return { ok: false as const, error: 'Invalid note status', status: 400 };
    }
    data.noteStatus = note;
    if (note !== existing.noteStatus) changedFields.push('noteStatus');
  }

  // ── Schedule fields (Edit Details) ──
  const wantsSchedule =
    patch.type != null ||
    patch.startsAt != null ||
    patch.endsAt != null ||
    patch.date != null ||
    patch.startTime != null ||
    patch.endTime != null ||
    patch.clinicianId != null ||
    patch.isVirtual != null ||
    patch.videoProvider != null;

  const existingMeta = parseTelehealthMeta(existing.notes);
  let nextMeta: TelehealthMeta | null = Object.keys(existingMeta).length ? existingMeta : null;
  let metaChanged = false;

  if (wantsSchedule) {
    if (!RESCHEDULABLE.includes(existing.status)) {
      return {
        ok: false as const,
        error: `A ${UI_STATUS[existing.status]} appointment can't be rescheduled or reassigned`,
        status: 400,
      };
    }

    const type = patch.type != null ? patch.type.trim() : existing.type;
    if (!type) return { ok: false as const, error: 'Appointment type is required', status: 400 };

    const timeZone = await getPracticeTimeZone(actor.organizationId);
    let start: Date;
    let end: Date;
    if (patch.startsAt != null || patch.endsAt != null) {
      const when = resolveAppointmentTimes(
        {
          startsAt: patch.startsAt ?? existing.startsAt.toISOString(),
          endsAt: patch.endsAt ?? new Date(
            (patch.startsAt ? Date.parse(patch.startsAt) : existing.startsAt.getTime()) +
              (existing.endsAt.getTime() - existing.startsAt.getTime())
          ).toISOString(),
        },
        timeZone
      );
      if (when.ok === false) return { ok: false as const, error: when.error, status: 400 };
      ({ start, end } = when);
    } else {
      const date = patch.date ?? practiceDate(existing.startsAt, timeZone);
      const when = resolveAppointmentTimes(
        {
          date,
          startTime: patch.startTime ?? practiceTime(existing.startsAt, timeZone),
          endTime: patch.endTime ?? practiceTime(existing.endsAt, timeZone),
        },
        timeZone
      );
      if (when.ok === false) return { ok: false as const, error: when.error, status: 400 };
      ({ start, end } = when);
    }

    let clinicianId = existing.clinicianId;
    if (patch.clinicianId != null && patch.clinicianId !== existing.clinicianId) {
      const clinician = await prisma.user.findFirst({
        where: { id: patch.clinicianId, organizationId: actor.organizationId, status: { in: SCHEDULABLE_STAFF_STATUSES } },
        select: { id: true, name: true },
      });
      if (!clinician) {
        return { ok: false as const, error: 'Clinician not found in your organization', status: 400 };
      }
      clinicianId = clinician.id;
      data.clinician = { connect: { id: clinician.id } };
      data.clinicianName = clinician.name;
      changedFields.push('clinicianId');
    }

    const startChanged = start.getTime() !== existing.startsAt.getTime();
    // Double-booking: another live appointment for this client + clinician + start. The
    // appointment being edited is excluded, so saving it in place never conflicts with itself.
    if ((startChanged || clinicianId !== existing.clinicianId) && clinicianId && !patch.allowDuplicate) {
      const dup = await findDuplicateAppointment(prisma, {
        organizationId: actor.organizationId,
        clientId: existing.clientId,
        clinicianId,
        startsAt: start,
        excludeId: existing.id,
      });
      if (dup) return duplicateAppointmentFailure(dup.id);
    }

    // Clinician double-booking: the new time must not overlap another live appointment of the
    // (new) clinician, unless staff overbook on purpose with a reason.
    const endChanged = end.getTime() !== existing.endsAt.getTime();
    if ((startChanged || endChanged || clinicianId !== existing.clinicianId) && clinicianId && !patch.allowDuplicate) {
      const overbook = parseOverbook(patch);
      if (overbook.ok === false) return { ok: false as const, error: overbook.error, status: 400 };
      const conflicts = await findClinicianOverlaps(prisma, {
        organizationId: actor.organizationId,
        clinicianId,
        start,
        end,
        excludeIds: [existing.id, ...(patch.overlapExcludeIds ?? [])],
      });
      if (conflicts.length) {
        if (!overbook.reason) return clinicianOverlapFailure(conflicts);
        data.overbookReason = overbook.reason;
        changedFields.push('overbookReason');
      }
    }

    if (type !== existing.type) {
      data.type = type;
      changedFields.push('type');
    }
    if (startChanged) {
      data.startsAt = start;
      changedFields.push('startsAt');
    }
    if (end.getTime() !== existing.endsAt.getTime()) {
      data.endsAt = end;
      changedFields.push('endsAt');
    }

    const nextIsVirtual = patch.isVirtual ?? existing.isVirtual;
    if (nextIsVirtual) {
      const wanted = normalizeProvider(patch.videoProvider ?? existingMeta.provider);
      const current = existing.isVirtual ? normalizeProvider(existingMeta.provider) : null;
      if (current !== wanted) {
        const built = await buildTelehealthMeta(wanted, {
          topic: `${type} — ${existing.clientName?.trim() || existing.client.name}`,
          start,
          end,
        });
        if (built.ok === false) return { ok: false as const, error: built.error, status: 400 };
        nextMeta = built.meta;
        metaChanged = true;
        changedFields.push('videoProvider');
      }
    } else if (existing.isVirtual) {
      nextMeta = null; // now in person: drop the video room
      metaChanged = true;
    }
    if (nextIsVirtual !== existing.isVirtual) {
      data.isVirtual = nextIsVirtual;
      changedFields.push('isVirtual');
    }
  }

  if (patch.audioOnly != null && existing.status !== 'CANCELLED' && existing.status !== 'LATE_CANCEL') {
    const nextVirtual = (data.isVirtual as boolean | undefined) ?? existing.isVirtual;
    const nextAudio = Boolean(patch.audioOnly) && nextVirtual;
    if (nextAudio !== existing.audioOnly) {
      data.audioOnly = nextAudio;
      changedFields.push('audioOnly');
    }
  }
  if (patch.seriesId !== undefined && patch.seriesId !== existing.seriesId) {
    data.series = patch.seriesId ? { connect: { id: patch.seriesId } } : { disconnect: true };
    changedFields.push('seriesId');
  }

  // Notes: staff only ever see notes without the hidden telehealth block, so keep that block
  // (meeting ids, join URLs) when they save the visible text.
  if (patch.notes !== undefined || metaChanged) {
    const visible =
      patch.notes !== undefined ? patch.notes?.trim() || null : notesForStaffUi(existing.notes) || null;
    const nextNotes = nextMeta ? writeTelehealthMeta(visible, nextMeta) : visible;
    if (nextNotes !== existing.notes) {
      data.notes = nextNotes;
      if (patch.notes !== undefined) changedFields.push('notes');
    }
  }

  if (Object.keys(data).length === 0) {
    if (!wantsSchedule && patch.notes === undefined) {
      return { ok: false as const, error: 'No updates provided', status: 400 };
    }
    // Edit saved with nothing different: return the appointment as it is.
  }

  // Check-in soft stop (src/lib/consents/library/decisions.ts): the consent to treatment (and the
  // telehealth consent for a virtual visit) or a staff override reason. Other gaps are flags only.
  // A failure to load consents never blocks a check-in (logged).
  let consentOverride: { reason: string; templateKeys: string[] } | null = null;
  if (data.status === 'CHECKED_IN' && existing.status !== 'CHECKED_IN') {
    const nextVirtual = (data.isVirtual as boolean | undefined) ?? existing.isVirtual;
    let decision: Awaited<ReturnType<typeof checkInConsentDecision>> | null = null;
    try {
      decision = await checkInConsentDecision(actor.organizationId, existing.clientId, nextVirtual);
    } catch (err) {
      console.error('[appointments] check-in consent check failed', err instanceof Error ? err.message : 'unknown');
    }
    if (decision) {
      const allowed = checkInAllowed(decision, patch.consentOverrideReason);
      if (allowed.ok === false) {
        return consentRequiredFailure(allowed.error, decision, nextVirtual);
      }
      if (allowed.override) consentOverride = { reason: allowed.override, templateKeys: decision.blocking.map((b) => b.key) };
    }
  }

  if (Object.keys(data).length > 0) {
    data.lastChangedById = actor.id;
    data.lastChangedByName = await staffDisplayName(actor.id);
    data.lastChangedAt = new Date();
  }
  const row =
    Object.keys(data).length === 0
      ? await prisma.appointment.findUniqueOrThrow({ where: { id }, include })
      : await prisma.appointment.update({ where: { id }, data, include });
  // AutoPay after COMPLETED / NO_SHOW / LATE_CANCEL (background, idempotent; src/lib/patientPayments/visitTrigger.ts)
  if (data.status) void triggerAutopayAfterVisitStatus(row.id, String(data.status), { userId: actor.id, role: String(actor.role) });

  // A status change can make a label suggestion apply (e.g. cancelled); only when auto-apply is on
  const labelAutoApplied = data.status ? await autoApplySuggestedLabel(actor.organizationId, row) : null;
  const [appointment] = await serializeWithLabels(actor.organizationId, [row]);
  let consentOverrideId: string | null = null;
  if (consentOverride) {
    try {
      consentOverrideId = await recordCheckInOverride({ organizationId: actor.organizationId, appointmentId: row.id, clientId: existing.clientId, templateKeys: consentOverride.templateKeys, reason: consentOverride.reason, userId: actor.id });
    } catch (err) {
      console.error('[appointments] consent override not stored', err instanceof Error ? err.message : 'unknown');
    }
  }
  return {
    ok: true as const,
    appointment,
    labelAutoApplied,
    changedFields,
    consentOverride: consentOverride ? { id: consentOverrideId, templateKeys: consentOverride.templateKeys } : null,
  };
}

/**
 * Set or clear an appointment's calendar label. Same org + caseload rules as updateAppointment.
 */
export async function setAppointmentLabel(
  id: string,
  labelId: string | null,
  actor: { id: string; role: Role; organizationId: string }
) {
  const existing = await prisma.appointment.findFirst({
    where: { id, AND: [appointmentOrgWhere(actor.organizationId)] },
    include: { ...include, client: { select: { id: true, name: true, image: true, assignedToId: true } } },
  });
  if (!existing) {
    return { ok: false as const, error: 'Appointment not found', status: 404 };
  }
  if (existing.clinicianId !== actor.id && !(await caseloadAllows({ organizationId: actor.organizationId, userId: actor.id, role: actor.role }, existing.client))) {
    return { ok: false as const, error: 'Not your patient', status: 403 };
  }
  const [before] = await serializeWithLabels(actor.organizationId, [existing]);
  const res = await writeAppointmentLabelId(actor.organizationId, id, labelId);
  if (res.ok === false) return { ok: false as const, error: res.error, status: res.status };
  const [appointment] = await serializeWithLabels(actor.organizationId, [existing]);
  return { ok: true as const, appointment, previousLabelId: before.labelId };
}

/** @deprecated prefer updateAppointment */
export async function updateAppointmentStatus(
  id: string,
  statusInput: string,
  actor: { id: string; role: Role; organizationId: string }
) {
  return updateAppointment(id, { visitStatus: statusInput }, actor);
}

export async function generateAiDraft(
  id: string,
  actor: { id: string; role: Role; organizationId: string }
) {
  return updateAppointment(id, { noteStatus: 'ai-draft' }, actor);
}

/** Today on the practice clock (server runs in UTC; this is the default zone's day). */
export function todayLocalDate(timeZone: string = DEFAULT_PRACTICE_TIME_ZONE) {
  return practiceToday(timeZone);
}
