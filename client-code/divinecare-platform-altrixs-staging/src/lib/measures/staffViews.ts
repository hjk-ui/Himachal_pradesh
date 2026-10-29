/**
 * Staff side of measures to patients (server): the MBC schedule list (/dashboard/mbc/outcomes),
 * the chart Measures card, "mark reviewed", the note narrative and the inbox items. Every query is
 * scoped by organization + the caller's client scope (clientWhere from requireClinicalContext).
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { howGiven } from './printView';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { invalidateInboxForOrg } from '@/lib/inbox/cacheStore';
import { clinicDate } from '@/lib/workflows/dates';
import { HIGHER_IS_BETTER, instrumentById, instrumentName, isWorsening, NOT_SENDABLE_TEXT, sendableCheck, SAFETY_ITEMS } from './instruments';
import { activeKeyFor, addDays, intervalTolerance, requestStatusLabel, type MeasureSchedule, type RequestStatusLabel } from './schedule';
import { measuresNarrative, type NarrativeRecord } from './narrative';

export type StaffScope = { organizationId: string; userId: string; role: string; clientWhere: Prisma.ClientWhereInput };

export class MeasureError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

export type ScorePoint = {
  id: string;
  score: number | null;
  severity: string | null;
  date: string;
  source: string | null;
  safetyFlagged: boolean;
  /** "In clinic" | "Patient link" | "Paper — entered by <staff>" (chart Measures card) */
  how?: string;
  /** Paper form: the filed scan */
  scanUrl?: string | null;
};

export type RequestView = {
  id: string;
  status: RequestStatusLabel;
  channel: string;
  trigger: string;
  instrumentIds: string[];
  sentAt: string | null;
  openedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  expiresAt: string;
  notSentReason: string | null;
  deliveryResults: { channel: string; ok: boolean; reason: string | null }[];
  safetyFlagged: boolean;
  reviewedAt: string | null;
  appointmentId: string | null;
};

function requestView(r: {
  id: string; status: string; channel: string; trigger: string; instrumentIds: string[]; sentAt: Date | null; openedAt: Date | null; startedAt: Date | null;
  completedAt: Date | null; expiresAt: Date; notSentReason: string | null; deliveryResults: Prisma.JsonValue; safetyFlagged: boolean; reviewedAt: Date | null; appointmentId: string | null;
}, now: Date): RequestView {
  return {
    id: r.id,
    status: requestStatusLabel(r, now),
    channel: r.channel,
    trigger: r.trigger,
    instrumentIds: r.instrumentIds,
    sentAt: r.sentAt?.toISOString() ?? null,
    openedAt: r.openedAt?.toISOString() ?? null,
    startedAt: r.startedAt?.toISOString() ?? null,
    completedAt: r.completedAt?.toISOString() ?? null,
    expiresAt: r.expiresAt.toISOString(),
    notSentReason: r.notSentReason,
    deliveryResults: Array.isArray(r.deliveryResults) ? (r.deliveryResults as { channel: string; ok: boolean; reason: string | null }[]) : [],
    safetyFlagged: r.safetyFlagged,
    reviewedAt: r.reviewedAt?.toISOString() ?? null,
    appointmentId: r.appointmentId,
  };
}

const REQUEST_SELECT = {
  id: true, clientId: true, status: true, channel: true, trigger: true, instrumentIds: true, sentAt: true, openedAt: true, startedAt: true,
  completedAt: true, expiresAt: true, notSentReason: true, deliveryResults: true, safetyFlagged: true, reviewedAt: true, appointmentId: true, createdAt: true,
} as const;

/** Next due day for an assignment from its latest result (null = due now / not scheduled) */
export function nextDueDay(a: { schedule: string; everyDays: number | null; startDate: string; status: string }, latestDay: string | null, today: string): string | null {
  if (a.status !== 'active') return null;
  if (a.schedule === 'once') return latestDay && latestDay >= a.startDate ? null : a.startDate > today ? a.startDate : today;
  if (a.schedule === 'before_visit') return null;
  const every = Math.max(1, a.everyDays ?? 30);
  if (!latestDay) return a.startDate > today ? a.startDate : today;
  const next = addDays(latestDay, every - intervalTolerance(every));
  return next < a.startDate ? a.startDate : next;
}

export type AssignmentRow = {
  id: string;
  clientId: string;
  clientName: string;
  instrumentId: string;
  measure: string;
  maxScore: number | null;
  scoreRanges: { min: number; max: number; label: string }[];
  /** Higher score = better (WHO-5, SWLS): the lowest band is the worst */
  higherIsBetter: boolean;
  schedule: MeasureSchedule | string;
  everyDays: number | null;
  startDate: string;
  endDate: string | null;
  source: string;
  status: string;
  sendable: boolean;
  notSendableReason: string | null;
  scores: ScorePoint[];
  /** Completed sends / sends that reached the patient, % (null: nothing sent yet) */
  completionRate: number | null;
  nextDue: string | null;
  lastRequest: RequestView | null;
};

/** The MBC schedule list. `clientId` narrows to one client (chart). */
export async function listAssignmentRows(scope: StaffScope, opts: { clientId?: string | null; now?: Date } = {}): Promise<AssignmentRow[]> {
  const now = opts.now ?? new Date();
  const today = clinicDate(now);
  const assignments = await prisma.measureAssignment.findMany({
    where: { organizationId: scope.organizationId, status: { in: ['active', 'paused'] }, ...(opts.clientId ? { clientId: opts.clientId } : {}) },
    orderBy: [{ createdAt: 'desc' }],
    take: 2000,
  });
  if (!assignments.length) return [];
  const clientIds = [...new Set(assignments.map((a) => a.clientId))];
  const clients = await prisma.client.findMany({ where: { AND: [{ id: { in: clientIds }, organizationId: scope.organizationId }, scope.clientWhere] }, select: { id: true, name: true } });
  const names = new Map(clients.map((c) => [c.id, c.name]));
  const inScope = assignments.filter((a) => names.has(a.clientId));
  if (!inScope.length) return [];
  const scopedIds = [...new Set(inScope.map((a) => a.clientId))];
  const instruments = [...new Set(inScope.map((a) => a.instrumentId))];
  const [records, requests] = await Promise.all([
    prisma.clinicalAssessmentRecord.findMany({
      where: { organizationId: scope.organizationId, clientId: { in: scopedIds }, instrumentId: { in: instruments } },
      select: { id: true, clientId: true, instrumentId: true, totalScore: true, severity: true, createdAt: true, source: true, safetyFlagged: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.measureRequest.findMany({
      where: { organizationId: scope.organizationId, clientId: { in: scopedIds } },
      select: REQUEST_SELECT,
      orderBy: { createdAt: 'desc' },
      take: 5000,
    }),
  ]);
  const key = (c: string, i: string) => `${c}|${i}`;
  const series = new Map<string, ScorePoint[]>();
  for (const r of records) {
    const k = key(r.clientId, r.instrumentId);
    series.set(k, [...(series.get(k) ?? []), { id: r.id, score: r.totalScore, severity: r.severity, date: r.createdAt.toISOString(), source: r.source, safetyFlagged: r.safetyFlagged }]);
  }
  return inScope.map((a) => {
    const inst = instrumentById(a.instrumentId);
    const pts = series.get(key(a.clientId, a.instrumentId)) ?? [];
    const reqs = requests.filter((r) => r.clientId === a.clientId && r.instrumentIds.includes(a.instrumentId));
    const reached = reqs.filter((r) => r.sentAt);
    const completed = reached.filter((r) => r.completedAt);
    const check = sendableCheck(a.instrumentId);
    const latestDay = pts.length ? pts[pts.length - 1].date.slice(0, 10) : null;
    const startDate = day(a.startDate)!;
    return {
      id: a.id,
      clientId: a.clientId,
      clientName: names.get(a.clientId) ?? 'Client',
      instrumentId: a.instrumentId,
      measure: inst?.name ?? instrumentName(a.instrumentId),
      maxScore: inst?.maxScore ?? null,
      scoreRanges: (inst?.scoreRanges ?? []).map((r) => ({ min: r.min, max: r.max, label: r.label })),
      higherIsBetter: HIGHER_IS_BETTER.has(a.instrumentId),
      schedule: a.schedule,
      everyDays: a.everyDays,
      startDate,
      endDate: day(a.endDate),
      source: a.source,
      status: a.status,
      sendable: check.ok,
      notSendableReason: check.ok === false ? NOT_SENDABLE_TEXT[check.reason] : null,
      scores: pts.slice(-12),
      completionRate: reached.length ? Math.round((completed.length / reached.length) * 100) : null,
      nextDue: nextDueDay({ schedule: a.schedule, everyDays: a.everyDays, startDate, status: a.status }, latestDay, today),
      lastRequest: reqs[0] ? requestView(reqs[0], now) : null,
    };
  });
}

const scheduleSchemaValues = new Set(['once', 'interval', 'before_visit']);

export async function createAssignment(scope: StaffScope, input: { clientId: string; instrumentId: string; schedule: string; everyDays?: number | null; startDate?: string | null; endDate?: string | null }, now = new Date()) {
  const client = await prisma.client.findFirst({ where: { AND: [{ id: input.clientId, organizationId: scope.organizationId }, scope.clientWhere] }, select: { id: true } });
  if (!client) throw new MeasureError('Client not found', 404);
  if (!instrumentById(input.instrumentId)) throw new MeasureError('Unknown measure');
  if (!scheduleSchemaValues.has(input.schedule)) throw new MeasureError('Choose once, every N days or before each visit');
  const everyDays = input.schedule === 'interval' ? Math.round(Number(input.everyDays ?? 30)) : null;
  if (everyDays !== null && (!Number.isFinite(everyDays) || everyDays < 1 || everyDays > 365)) throw new MeasureError('Every 1 to 365 days');
  const start = input.startDate && /^\d{4}-\d{2}-\d{2}$/.test(input.startDate) ? input.startDate : clinicDate(now);
  const end = input.endDate && /^\d{4}-\d{2}-\d{2}$/.test(input.endDate) ? input.endDate : null;
  if (end && end < start) throw new MeasureError('End date is before the start date');
  try {
    const row = await prisma.measureAssignment.create({
      data: {
        organizationId: scope.organizationId, clientId: client.id, instrumentId: input.instrumentId, schedule: input.schedule, everyDays,
        startDate: new Date(`${start}T00:00:00Z`), endDate: end ? new Date(`${end}T00:00:00Z`) : null, source: 'manual', status: 'active',
        activeKey: activeKeyFor(client.id, input.instrumentId), assignedById: scope.userId,
      },
    });
    await writeAuditLog({
      action: 'MEASURE_ASSIGNED', actorUserId: scope.userId, actorRole: scope.role, organizationId: scope.organizationId, resourceType: 'measureAssignment',
      resourceId: row.id, patientId: client.id, metadata: { instrumentId: input.instrumentId, schedule: input.schedule, everyDays, source: 'manual' },
    }).catch(() => {});
    return row;
  } catch (err) {
    if ((err as { code?: string })?.code === 'P2002') throw new MeasureError('This measure is already scheduled for this client. Pause or end it first.', 409);
    throw err;
  }
}

export async function setAssignmentStatus(scope: StaffScope, id: string, status: 'active' | 'paused' | 'ended') {
  const a = await prisma.measureAssignment.findFirst({ where: { id, organizationId: scope.organizationId }, select: { id: true, clientId: true, instrumentId: true, status: true } });
  if (!a) throw new MeasureError('Schedule not found', 404);
  const ok = await prisma.client.findFirst({ where: { AND: [{ id: a.clientId, organizationId: scope.organizationId }, scope.clientWhere] }, select: { id: true } });
  if (!ok) throw new MeasureError('Schedule not found', 404);
  try {
    await prisma.measureAssignment.update({
      where: { id: a.id },
      data: { status, activeKey: status === 'active' ? activeKeyFor(a.clientId, a.instrumentId) : null, ...(status === 'ended' ? { endDate: new Date() } : {}) },
    });
  } catch (err) {
    if ((err as { code?: string })?.code === 'P2002') throw new MeasureError('Another active schedule already has this measure for this client.', 409);
    throw err;
  }
  await writeAuditLog({
    action: 'MEASURE_ASSIGNMENT_STATUS', actorUserId: scope.userId, actorRole: scope.role, organizationId: scope.organizationId, resourceType: 'measureAssignment',
    resourceId: a.id, patientId: a.clientId, metadata: { from: a.status, to: status },
  }).catch(() => {});
}

// ─── Chart Measures card ─────────────────────────────────────────────────────

export type ClientMeasureSummary = {
  instrumentId: string;
  measure: string;
  maxScore: number | null;
  latest: ScorePoint;
  previous: ScorePoint | null;
  change: number | null;
  worsening: boolean;
  safetyItem: { item: string; score: number | null } | null;
  series: ScorePoint[];
};

export async function clientMeasures(scope: StaffScope, clientId: string, now = new Date()) {
  const client = await prisma.client.findFirst({ where: { AND: [{ id: clientId, organizationId: scope.organizationId }, scope.clientWhere] }, select: { id: true } });
  if (!client) throw new MeasureError('Client not found', 404);
  const [records, requests, assignments] = await Promise.all([
    prisma.clinicalAssessmentRecord.findMany({
      where: { organizationId: scope.organizationId, clientId },
      select: { id: true, instrumentId: true, totalScore: true, severity: true, createdAt: true, source: true, safetyFlagged: true, administrationType: true, notes: true, sourceDocumentId: true },
      orderBy: { createdAt: 'asc' },
      take: 500,
    }),
    prisma.measureRequest.findMany({ where: { organizationId: scope.organizationId, clientId }, select: REQUEST_SELECT, orderBy: { createdAt: 'desc' }, take: 30 }),
    listAssignmentRows(scope, { clientId, now }),
  ]);
  const docIds = records.map((r) => r.sourceDocumentId).filter((x): x is string => Boolean(x));
  const scans = docIds.length
    ? new Map(
        (await prisma.documentIntake.findMany({ where: { id: { in: docIds }, suggestedClientId: clientId, status: 'filed' }, select: { id: true, s3RawKey: true } }))
          .filter((d) => d.s3RawKey && d.s3RawKey !== 'pending')
          .map((d) => [d.id, `/api/files/intake-docs/${d.s3RawKey}`]),
      )
    : new Map<string, string>();
  const by = new Map<string, ScorePoint[]>();
  for (const r of records) {
    by.set(r.instrumentId, [
      ...(by.get(r.instrumentId) ?? []),
      {
        id: r.id,
        score: r.totalScore,
        severity: r.severity,
        date: r.createdAt.toISOString(),
        source: r.source,
        safetyFlagged: r.safetyFlagged,
        how: howGiven(r),
        scanUrl: r.sourceDocumentId ? scans.get(r.sourceDocumentId) ?? null : null,
      },
    ]);
  }
  const safetyIds = [...by.entries()].filter(([id]) => SAFETY_ITEMS[id]).map(([, pts]) => pts[pts.length - 1].id);
  const items = safetyIds.length
    ? await prisma.assessmentItemAnswer.findMany({ where: { assessmentId: { in: safetyIds } }, select: { assessmentId: true, itemId: true, scoreValue: true } })
    : [];
  const summaries: ClientMeasureSummary[] = [...by.entries()].map(([instrumentId, pts]) => {
    const latest = pts[pts.length - 1];
    const previous = pts.length > 1 ? pts[pts.length - 2] : null;
    const change = previous && latest.score != null && previous.score != null ? latest.score - previous.score : null;
    const item = SAFETY_ITEMS[instrumentId];
    const itemRow = item ? items.find((x) => x.assessmentId === latest.id && x.itemId === item) : undefined;
    return {
      instrumentId,
      measure: instrumentName(instrumentId),
      maxScore: instrumentById(instrumentId)?.maxScore ?? null,
      latest,
      previous,
      change,
      worsening: isWorsening(instrumentId, latest.score, previous?.score ?? null),
      safetyItem: item ? { item: item.replace(/^q/, ''), score: itemRow?.scoreValue ?? null } : null,
      series: pts.slice(-8),
    };
  });
  summaries.sort((a, b) => b.latest.date.localeCompare(a.latest.date));
  const pending = requests.filter((r) => ['Sent', 'Opened', 'Started', 'Not sent', 'Locked'].includes(requestStatusLabel(r, now)) && !r.reviewedAt);
  const unreviewed = requests.filter((r) => r.completedAt && !r.reviewedAt).map((r) => r.id);
  return {
    summaries,
    requests: requests.map((r) => requestView(r, now)),
    pendingCount: pending.length,
    unreviewedRequestIds: unreviewed,
    assignments,
  };
}

export async function markRequestsReviewed(scope: StaffScope, input: { clientId: string; requestIds?: string[] }) {
  const client = await prisma.client.findFirst({ where: { AND: [{ id: input.clientId, organizationId: scope.organizationId }, scope.clientWhere] }, select: { id: true } });
  if (!client) throw new MeasureError('Client not found', 404);
  const res = await prisma.measureRequest.updateMany({
    where: { organizationId: scope.organizationId, clientId: client.id, completedAt: { not: null }, reviewedAt: null, ...(input.requestIds?.length ? { id: { in: input.requestIds } } : {}) },
    data: { reviewedAt: new Date(), reviewedById: scope.userId },
  });
  if (res.count) {
    await writeAuditLog({
      action: 'MEASURE_RESULTS_REVIEWED', actorUserId: scope.userId, actorRole: scope.role, organizationId: scope.organizationId, resourceType: 'measureRequest',
      patientId: client.id, metadata: { count: res.count, requestIds: input.requestIds ?? null },
    }).catch(() => {});
    invalidateInboxForOrg(scope.organizationId);
  }
  return res.count;
}

// ─── Note narrative ──────────────────────────────────────────────────────────

/**
 * Completed measures since the client's last note (other than `noteId`), as one line. With no
 * previous note: the last 30 days.
 */
export async function noteNarrative(scope: StaffScope, clientId: string, noteId: string | null, now = new Date()) {
  const client = await prisma.client.findFirst({ where: { AND: [{ id: clientId, organizationId: scope.organizationId }, scope.clientWhere] }, select: { id: true } });
  if (!client) throw new MeasureError('Client not found', 404);
  const lastNote = await prisma.progressNote.findFirst({
    where: { clientId, dismissedAt: null, ...(noteId ? { id: { not: noteId } } : {}), createdAt: { lt: now } },
    select: { createdAt: true, dateOfService: true },
    orderBy: { createdAt: 'desc' },
  });
  const since = lastNote ? day(lastNote.createdAt)! : clinicDate(new Date(now.getTime() - 30 * 86_400_000));
  const records = await prisma.clinicalAssessmentRecord.findMany({
    where: { organizationId: scope.organizationId, clientId, totalScore: { not: null } },
    select: { id: true, instrumentId: true, instrumentName: true, totalScore: true, severity: true, createdAt: true, answers: { select: { itemId: true, scoreValue: true } } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  const history: NarrativeRecord[] = records.map((r) => ({
    id: r.id,
    instrumentId: r.instrumentId,
    instrumentName: r.instrumentName,
    totalScore: r.totalScore,
    severity: r.severity,
    date: r.createdAt.toISOString(),
    items: Object.fromEntries(r.answers.map((a) => [a.itemId, a.scoreValue])),
  }));
  const n = measuresNarrative(history, since);
  const requestIds = n.recordIds.length
    ? (await prisma.measureRequest.findMany({ where: { organizationId: scope.organizationId, clientId, resultRecordIds: { hasSome: n.recordIds }, reviewedAt: null }, select: { id: true } })).map((r) => r.id)
    : [];
  return { text: n.text, recordIds: n.recordIds, since, requestIds };
}

// ─── Inbox: "Measures completed" and "Worsening" ────────────────────────────

export type MeasureInboxItem = {
  kind: 'completed' | 'worsening';
  requestId: string;
  recordId: string | null;
  clientId: string;
  clientName: string;
  title: string;
  detail: string | null;
  safetyFlagged: boolean;
  at: string;
};

const fmt = (n: number | null) => (n == null ? '—' : String(Math.round(n * 100) / 100));

/**
 * Pure: inbox items from completed, unreviewed requests. One "Measures completed" item per request
 * and one "Worsening" item per result that rose by a clinically meaningful amount.
 */
export function measureInboxItems(
  requests: { id: string; clientId: string; clientName: string; completedAt: Date; safetyFlagged: boolean; resultRecordIds: string[] }[],
  records: ReadonlyMap<string, { id: string; instrumentId: string; totalScore: number | null; severity: string | null }>,
  previousScore: (recordId: string) => number | null
): MeasureInboxItem[] {
  const out: MeasureInboxItem[] = [];
  for (const r of requests) {
    const recs = r.resultRecordIds.map((id) => records.get(id)).filter((x): x is NonNullable<typeof x> => Boolean(x));
    out.push({
      kind: 'completed',
      requestId: r.id,
      recordId: null,
      clientId: r.clientId,
      clientName: r.clientName,
      title: `Measures completed · ${recs.map((x) => `${instrumentName(x.instrumentId)} ${fmt(x.totalScore)}`).join(', ') || 'results'}`,
      detail: recs.map((x) => `${instrumentName(x.instrumentId)}: ${x.severity ?? 'scored'}`).join(' · ') || null,
      safetyFlagged: r.safetyFlagged,
      at: r.completedAt.toISOString(),
    });
    for (const x of recs) {
      const prev = previousScore(x.id);
      if (!isWorsening(x.instrumentId, x.totalScore, prev)) continue;
      out.push({
        kind: 'worsening',
        requestId: r.id,
        recordId: x.id,
        clientId: r.clientId,
        clientName: r.clientName,
        title: `Worsening · ${instrumentName(x.instrumentId)} ${fmt(x.totalScore)} (up ${fmt((x.totalScore ?? 0) - (prev ?? 0))} from ${fmt(prev)})`,
        detail: x.severity,
        safetyFlagged: r.safetyFlagged,
        at: r.completedAt.toISOString(),
      });
    }
  }
  return out;
}

/** Completed, unreviewed results for the clinician they were routed to (last 30 days) */
export async function loadMeasureInbox(actor: { organizationId: string; userId: string }, clientWhere: Prisma.ClientWhereInput, now = new Date()): Promise<MeasureInboxItem[]> {
  const rows = await prisma.measureRequest.findMany({
    where: {
      organizationId: actor.organizationId,
      clinicianId: actor.userId,
      completedAt: { not: null, gte: new Date(now.getTime() - 30 * 86_400_000) },
      reviewedAt: null,
    },
    select: { id: true, clientId: true, completedAt: true, safetyFlagged: true, resultRecordIds: true },
    orderBy: { completedAt: 'desc' },
    take: 200,
  });
  if (!rows.length) return [];
  const clients = await prisma.client.findMany({ where: { AND: [{ id: { in: [...new Set(rows.map((r) => r.clientId))] }, organizationId: actor.organizationId }, clientWhere] }, select: { id: true, name: true } });
  const names = new Map(clients.map((c) => [c.id, c.name]));
  const visible = rows.filter((r) => names.has(r.clientId));
  const recordIds = visible.flatMap((r) => r.resultRecordIds);
  const recs = recordIds.length
    ? await prisma.clinicalAssessmentRecord.findMany({ where: { id: { in: recordIds }, organizationId: actor.organizationId }, select: { id: true, clientId: true, instrumentId: true, totalScore: true, severity: true, createdAt: true } })
    : [];
  // Previous result of the same instrument, for "Worsening"
  const prevMap = new Map<string, number | null>();
  for (const r of recs) {
    const prev = await prisma.clinicalAssessmentRecord.findFirst({
      where: { organizationId: actor.organizationId, clientId: r.clientId, instrumentId: r.instrumentId, createdAt: { lt: r.createdAt }, totalScore: { not: null } },
      select: { totalScore: true },
      orderBy: { createdAt: 'desc' },
    });
    prevMap.set(r.id, prev?.totalScore ?? null);
  }
  return measureInboxItems(
    visible.map((r) => ({ ...r, completedAt: r.completedAt!, clientName: names.get(r.clientId)! })),
    new Map(recs.map((r) => [r.id, r])),
    (id) => prevMap.get(id) ?? null
  );
}

