/**
 * Clinical Insights — set-based fact loader (server only: prisma).
 *
 * Clients come in id-ordered batches; every other table is read ONCE per batch with
 * `clientId IN (...)` (no per-client queries). Callers pass clients that are already scoped and
 * with protected (42 CFR Part 2) records the viewer cannot open removed — no clinical row of a
 * dropped client is read. The nightly system scan reads every active client; the page applies
 * each viewer's Part 2 lock when it reads the snapshot.
 *
 * Sources (see the report in docs / the page "About" panel):
 *   PHQ-9 / GAD-7 / PCL-5  ClinicalAssessmentRecord + MeasurementResult (Valant import) + TmsPhq9
 *   C-SSRS                 ClinicalAssessmentRecord (instrument c-ssrs*; safetyFlagged = positive)
 *   PHQ-9 safety item      ClinicalAssessmentRecord.safetyFlagged on PHQ-9
 *   Crisis                 CrisisEpisode (+ follow-up statuses)
 *   Risk alerts            RiskAlert (unreviewed; type risk_language = AI risk-language watch)
 *   Safety plan            ehr-safety-plans module entries linked by clientId + finalized
 *                          evaluation safety plans (same rule as Population Health)
 *   Visits                 Appointment statuses; last attended visit = Population Health rule
 *                          (attended appointment, signed note, or billed Valant charge)
 *   Visit frequency        Session Frequency (src/lib/clinical/sessionFrequencyData.ts)
 *   Portal                 MessageThread / ThreadMessage
 *   Plan / goals / notes   TreatmentPlan, signed-note progress chips, draft notes past deadline
 *   Medication             RcopiaRefillNotification + EhrRefillRequest (pending), RcopiaRxfillEvent
 *                          (not dispensed), ClientMedication + LabStandingOrder / LabOrder (labs)
 *   Social / coverage      SdohScreening (AHC HRSN), PriorAuth, Client.insuranceEffectiveTo
 *   Discharge              ehr-discharge-cases module (clientId link, or exact name + DOB)
 *   Not available          ED visits / hospital discharges (no ADT / HIE feed is stored)
 */
import { Prisma, type Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { getModuleData } from '@/lib/modules/manage';
import { loadSessionFrequency } from '@/lib/clinical/sessionFrequencyData';
import { ATTENDED_APPOINTMENT_STATUSES, dayOf } from '@/lib/clinical/sessionFrequency';
import { isCurrent } from '@/lib/clinical/serviceEligibility/rules';
import { parseProgressChips } from '@/lib/ai/authForecast/draft';
import { suggestedOrderSets } from '@/lib/labs/orderSets';
import { standingDueState } from '@/lib/labs/standing';
import { unsignedNoteCutoff } from '@/lib/inbox/core';
import { practiceNoteSignDeadlineHours } from '@/lib/practice/consumers';
import { hasFilledJson, loadLastVisits, safetyPlanClientIds } from '@/lib/reports/populationHealthQueries';
import { DEFAULT_THERAPY_WORKFLOW_SETTINGS, isValantClient, parseTherapyWorkflowSettings, transitionUntilDate } from '@/lib/ehr/therapy/rules';
import { parsePlanSource } from '@/lib/migration/valantTreatmentPlans';
import { dayDiff, evaluateClient, LOOKBACK_DAYS, normalizeScores, trajectory, trajectoryFlags } from './rules';
import { dxGroupOf, payerOf, TREND_MONTHS, TREND_WEEKS, type InsightRow, type RowHistory } from './population';
import type { ClientFacts, Evaluation, InstrumentKey, ScorePoint } from './types';

const DAY = 86_400_000;
export const BATCH_SIZE = 400;
export const MAX_CLIENTS = 6000;
const CONCURRENCY = 2;
const MONITORED_SETS = ['clozapine', 'lithium', 'valproate', 'carbamazepine', 'antipsychotic-metabolic'];
const PORTAL_WINDOW_DAYS = 60;
const HISTORY_DAYS = 200;
/** ClinicModuleState key of the therapy workflow settings (src/lib/ehr/therapy/planStore.ts) */
const THERAPY_SETTINGS_MODULE = 'therapy-workflow';

export const INSIGHT_CLIENT_SELECT = {
  id: true, name: true, mrn: true, status: true, riskLevel: true, createdAt: true, importedAt: true, sourcePlatform: true,
  dateOfBirth: true, legalFirstName: true, legalLastName: true,
  insurancePayer: true, insuranceType: true, insuranceEffectiveTo: true, primaryDiagnosisCode: true,
  assignedTo: { select: { id: true, name: true } },
  location: { select: { id: true, name: true } },
} as const;

export type InsightClient = Prisma.ClientGetPayload<{ select: typeof INSIGHT_CLIENT_SELECT }>;

export type ScanContext = {
  organizationId: string;
  /** Actor for the session-frequency read (system scans pass an org-wide role) */
  actor: { userId: string; role: Role | string };
  timeZone: string;
  now: Date;
  today: string;
  safetyPlanIds: Set<string>;
  discharges: Map<string, { date: string | null; followUpDocumented: boolean }>;
  unsignedCutoff: Date;
  /** Last day of the go-live plan transition for Valant clients (therapy workflow settings) */
  planTransitionUntil: string | null;
};

export type EvaluatedClient = {
  client: InsightClient;
  facts: ClientFacts;
  evaluation: Evaluation;
  history: RowHistory;
  programs: string[];
};

function group<T>(rows: T[], key: (r: T) => string | null | undefined): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    if (!k) continue;
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  }
  return m;
}

const PHQ_KEYS = ['phq-9', 'phq9'];
const GAD_KEYS = ['gad-7', 'gad7'];
const PCL_KEYS = ['pcl-5', 'pcl5'];

function instrumentOf(id: string | null | undefined, name?: string | null): InstrumentKey | 'cssrs' | null {
  const s = `${id ?? ''} ${name ?? ''}`.toLowerCase();
  if (/c-?ssrs/.test(s)) return 'cssrs';
  if (/phq-?9/.test(s)) return 'phq9';
  if (/gad-?7/.test(s)) return 'gad7';
  if (/pcl-?5/.test(s)) return 'pcl5';
  return null;
}

/** Monday (YYYY-MM-DD) of the week containing `ymd` */
export function weekStart(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d);
  const dow = new Date(t).getUTCDay(); // 0 Sun
  return new Date(t - ((dow + 6) % 7) * DAY).toISOString().slice(0, 10);
}

function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * DAY).toISOString().slice(0, 10);
}

/** Last day (YYYY-MM-DD) of a YYYY-MM month */
function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export function trendWeeks(today: string): string[] {
  const cur = weekStart(today);
  return Array.from({ length: TREND_WEEKS + 1 }, (_, i) => addDays(cur, -7 * (TREND_WEEKS - i)));
}

export function trendMonths(today: string): string[] {
  const [y, m] = today.split('-').map(Number);
  return Array.from({ length: TREND_MONTHS }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (TREND_MONTHS - 1 - i), 1));
    return d.toISOString().slice(0, 7);
  });
}

// ─── Org-level inputs (once per scan) ───────────────────────────────────────

type RawDischarge = Record<string, unknown>;
const norm = (s: unknown) => (typeof s === 'string' ? s.trim().replace(/\s+/g, ' ').toLowerCase() : '');
const ymdOrNull = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

/**
 * Discharge cases discharged in the last 90 days, keyed by client id. Linked by clientId, or by
 * exact name AND date of birth (both required here — a name alone is never matched).
 */
async function loadDischarges(organizationId: string, clientWhere: Prisma.ClientWhereInput, today: string) {
  const out = new Map<string, { date: string | null; followUpDocumented: boolean }>();
  const raw = await getModuleData<unknown>(organizationId, 'ehr-discharge-cases').catch(() => null);
  const list: RawDischarge[] = Array.isArray(raw) ? raw.filter((r): r is RawDischarge => Boolean(r) && typeof r === 'object') : [];
  const recent = list.filter((r) => {
    if (r.status !== 'discharged' && r.status !== 'follow_up') return false;
    const d = ymdOrNull(r.targetDischarge);
    return d != null && dayDiff(d, today) >= 0 && dayDiff(d, today) <= 90;
  });
  if (!recent.length) return out;
  const followUp = (r: RawDischarge) => {
    const done = (id: string) => Array.isArray(r.checklist) && r.checklist.some((c) => c && typeof c === 'object' && (c as { id?: unknown }).id === id && (c as { done?: unknown }).done === true);
    const milestone = Array.isArray(r.milestones) && r.milestones.some((m) => m && typeof m === 'object' && ymdOrNull((m as { scheduled?: unknown }).scheduled));
    return done('followup_7d_scheduled') || done('aftercare_confirmed') || milestone;
  };
  const named = recent.filter((r) => !r.clientId && norm(r.clientName) && ymdOrNull(r.dob));
  const candidates = named.length
    ? await prisma.client.findMany({
        where: { AND: [clientWhere, { name: { in: [...new Set(named.map((r) => String(r.clientName).trim()))], mode: 'insensitive' } }] },
        select: { id: true, name: true, dateOfBirth: true },
      })
    : [];
  for (const r of recent) {
    let id: string | null = typeof r.clientId === 'string' ? r.clientId : null;
    if (!id) {
      const dob = ymdOrNull(r.dob);
      const hits = candidates.filter((c) => norm(c.name) === norm(r.clientName) && c.dateOfBirth && c.dateOfBirth.toISOString().slice(0, 10) === dob);
      id = hits.length === 1 ? hits[0].id : null;
    }
    if (id) out.set(id, { date: ymdOrNull(r.targetDischarge), followUpDocumented: followUp(r) });
  }
  return out;
}

export async function scanContext(opts: {
  organizationId: string;
  actor: { userId: string; role: Role | string };
  clientWhere: Prisma.ClientWhereInput;
  timeZone: string;
  now?: Date;
  /** Single-chart reads: limit the evaluation safety-plan lookup to these clients */
  clientIds?: string[];
}): Promise<ScanContext> {
  const now = opts.now ?? new Date();
  const today = dayOf(now, opts.timeZone);
  const [planModule, evalPlans, discharges, deadlineHours, therapySettings] = await Promise.all([
    getModuleData<unknown>(opts.organizationId, 'ehr-safety-plans').catch(() => null),
    prisma.clinicalEvaluationRecord.findMany({
      where: {
        organizationId: opts.organizationId, status: { in: ['FINALIZED', 'AMENDED'] }, safetyPlanJson: { not: null },
        ...(opts.clientIds ? { clientId: { in: opts.clientIds } } : {}),
      },
      select: { clientId: true, safetyPlanJson: true },
    }),
    loadDischarges(opts.organizationId, opts.clientWhere, today),
    practiceNoteSignDeadlineHours(opts.organizationId),
    getModuleData<unknown>(opts.organizationId, THERAPY_SETTINGS_MODULE)
      .then((raw) => parseTherapyWorkflowSettings(raw))
      .catch(() => ({ ...DEFAULT_THERAPY_WORKFLOW_SETTINGS })),
  ]);
  const ids = safetyPlanClientIds(planModule).ids;
  for (const e of evalPlans) if (hasFilledJson(e.safetyPlanJson)) ids.add(e.clientId);
  return {
    organizationId: opts.organizationId,
    actor: opts.actor,
    timeZone: opts.timeZone,
    now,
    today,
    safetyPlanIds: ids,
    discharges,
    unsignedCutoff: unsignedNoteCutoff(now, deadlineHours),
    planTransitionUntil: transitionUntilDate(therapySettings),
  };
}

/** Clients in scope for insights: active, plus clients with a recent discharge case. */
export function insightClientWhere(clientWhere: Prisma.ClientWhereInput, ctx: Pick<ScanContext, 'discharges'>): Prisma.ClientWhereInput {
  const dischargeIds = [...ctx.discharges.keys()];
  return { AND: [clientWhere, dischargeIds.length ? { OR: [{ status: 'ACTIVE' }, { id: { in: dischargeIds } }] } : { status: 'ACTIVE' }] };
}

// ─── One batch ──────────────────────────────────────────────────────────────

export async function loadBatch(ctx: ScanContext, clients: InsightClient[]): Promise<EvaluatedClient[]> {
  const ids = clients.map((c) => c.id);
  if (!ids.length) return [];
  const org = ctx.organizationId;
  const { now, today, timeZone } = ctx;
  const since = (days: number) => new Date(now.getTime() - days * DAY);
  const day = (d: Date) => dayOf(d, timeZone);
  const scoreSince = since(LOOKBACK_DAYS + 5);

  const [
    assessments, measures, tmsPhq, crises, alerts, appts, lastVisits, cadence, portal, plans, chipNotes,
    signedNotes, unsigned, rcopiaRefills, ehrRefills, fills, meds, sdoh, auths, prp, tms, spravato, aot, residential,
  ] = await Promise.all([
    prisma.clinicalAssessmentRecord.findMany({
      where: {
        organizationId: org, clientId: { in: ids }, createdAt: { gte: scoreSince },
        OR: [
          { instrumentId: { in: ['phq-9', 'gad-7', 'pcl-5'] } },
          { instrumentId: { startsWith: 'c-ssrs' } },
          { instrumentName: { contains: 'PHQ-9', mode: 'insensitive' } },
          { instrumentName: { contains: 'GAD-7', mode: 'insensitive' } },
          { instrumentName: { contains: 'PCL-5', mode: 'insensitive' } },
          { instrumentName: { contains: 'C-SSRS', mode: 'insensitive' } },
        ],
      },
      select: { clientId: true, instrumentId: true, instrumentName: true, totalScore: true, safetyFlagged: true, createdAt: true },
    }),
    prisma.measurementResult.findMany({
      where: {
        organizationId: org, clientId: { in: ids }, measuredAt: { gte: scoreSince }, valueNumeric: { not: null },
        measurementType: { instrumentKey: { in: [...PHQ_KEYS, ...GAD_KEYS, ...PCL_KEYS] }, isSubscore: false },
      },
      select: { clientId: true, valueNumeric: true, measuredAt: true, measurementType: { select: { instrumentKey: true } } },
    }),
    prisma.tmsPhq9.findMany({
      where: { course: { organizationId: org, clientId: { in: ids } }, instrument: 'phq-9', recordedAt: { gte: scoreSince } },
      select: { score: true, recordedAt: true, course: { select: { clientId: true } } },
    }),
    prisma.crisisEpisode.findMany({
      where: { organizationId: org, clientId: { in: ids }, startedAt: { gte: since(LOOKBACK_DAYS) } },
      select: { id: true, clientId: true, startedAt: true, followUp24hStatus: true, followUp72hStatus: true },
    }),
    prisma.riskAlert.findMany({
      where: { clientId: { in: ids }, OR: [{ reviewed: false }, { type: 'risk_language', createdAt: { gte: since(30) } }] },
      select: { clientId: true, severity: true, type: true, source: true, reviewed: true, createdAt: true },
    }),
    prisma.appointment.findMany({
      where: { clientId: { in: ids }, startsAt: { gte: since(HISTORY_DAYS), lte: new Date(now.getTime() + 400 * DAY) } },
      select: { clientId: true, startsAt: true, status: true },
    }),
    loadLastVisits(org, ids, now),
    loadSessionFrequency({ organizationId: org, actorUserId: ctx.actor.userId, actorRole: ctx.actor.role as Role }, { clientIds: ids }, now)
      .then((r) => new Map(r.items.map((i) => [i.clientId, i])))
      .catch((err) => {
        console.error('[clinical-insights] session frequency unavailable', err instanceof Error ? err.name : 'unknown');
        return null;
      }),
    prisma.threadMessage.findMany({
      where: { thread: { organizationId: org, clientId: { in: ids } }, createdAt: { gte: since(PORTAL_WINDOW_DAYS) } },
      select: { senderType: true, createdAt: true, threadId: true, thread: { select: { clientId: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.treatmentPlan.findMany({
      where: { organizationId: org, clientId: { in: ids }, status: { not: 'CLOSED' } },
      select: { clientId: true, status: true, reviewDueAt: true, createdAt: true, goals: true },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.progressNote.findMany({
      where: {
        clientId: { in: ids }, workflow: { status: { in: ['SIGNED', 'LOCKED'] } }, createdAt: { gte: since(120) },
        OR: [{ body: { contains: '— Regression' } }, { body: { contains: '— No change' } }, { body: { contains: '— Progress made' } }],
      },
      select: { clientId: true, body: true, dateOfService: true, createdAt: true },
    }),
    prisma.progressNote.findMany({
      where: {
        clientId: { in: ids }, workflow: { status: { in: ['SIGNED', 'LOCKED'] } },
        OR: [{ dateOfService: { gte: since(HISTORY_DAYS) } }, { dateOfService: null, createdAt: { gte: since(HISTORY_DAYS) } }],
      },
      select: { clientId: true, dateOfService: true, createdAt: true },
    }),
    prisma.progressNote.groupBy({
      by: ['clientId'],
      where: { clientId: { in: ids }, createdAt: { lt: ctx.unsignedCutoff }, dismissedAt: null, OR: [{ workflow: { is: null } }, { workflow: { is: { status: 'DRAFT' } } }] },
      _count: { _all: true },
      _min: { createdAt: true },
    }),
    prisma.rcopiaRefillNotification.findMany({ where: { clientId: { in: ids }, actionTaken: 'pending' }, select: { clientId: true, createdAt: true } }),
    prisma.ehrRefillRequest.findMany({ where: { clientId: { in: ids }, status: 'Pending' }, select: { clientId: true, requestDate: true } }),
    prisma.rcopiaRxfillEvent.findMany({
      where: { clientId: { in: ids }, fillDate: { gte: since(90) }, OR: [{ fillStatus: 'not_dispensed' }, { adherenceFlag: { not: 'ok' } }] },
      select: { clientId: true, fillDate: true },
    }),
    prisma.clientMedication.findMany({
      where: { clientId: { in: ids }, active: true },
      select: { clientId: true, medicationName: true, drugName: true, genericName: true, brandName: true, isAntipsychotic: true, status: true },
    }),
    prisma.sdohScreening.findMany({
      where: { organizationId: org, clientId: { in: ids }, completedAt: { gte: since(LOOKBACK_DAYS) } },
      select: { clientId: true, completedAt: true, positiveDomains: true },
      orderBy: { completedAt: 'desc' },
    }),
    prisma.priorAuth.findMany({
      where: { organizationId: org, clientId: { in: ids }, status: 'APPROVED', OR: [{ endDate: null }, { endDate: { gte: since(0) } }] },
      select: { clientId: true, endDate: true, unitsApproved: true, unitsUsed: true },
    }),
    prisma.prpEnrollment.findMany({ where: { organizationId: org, clientId: { in: ids } }, select: { clientId: true, status: true } }),
    prisma.tmsCourse.findMany({ where: { organizationId: org, clientId: { in: ids } }, select: { clientId: true, status: true } }),
    prisma.spravatoEnrollment.findMany({ where: { organizationId: org, clientId: { in: ids } }, select: { clientId: true, status: true } }),
    prisma.aotParticipant.findMany({ where: { clientId: { in: ids } }, select: { clientId: true, status: true } }),
    prisma.residentialResident.findMany({ where: { clientId: { in: ids }, active: true }, select: { clientId: true } }),
  ]);

  // Monitoring labs: second step only for clients on a monitored medication
  const monitored = new Map<string, string[]>();
  for (const m of meds) {
    if (/discontinu|stopped|inactive|completed/i.test(m.status || '')) continue;
    const names = [m.medicationName, m.drugName, m.genericName, m.brandName].filter((x): x is string => Boolean(x && x.trim()));
    const sets = suggestedOrderSets(names.map((name) => ({ name, isAntipsychotic: m.isAntipsychotic }))).filter((s) => MONITORED_SETS.includes(s));
    if (sets.length) monitored.set(m.clientId, [...new Set([...(monitored.get(m.clientId) ?? []), ...sets])]);
  }
  const monitoredIds = [...monitored.keys()];
  const [standing, recentLabs] = monitoredIds.length
    ? await Promise.all([
        prisma.labStandingOrder.findMany({
          where: { organizationId: org, clientId: { in: monitoredIds }, active: true },
          select: { clientId: true, nextDueAt: true, endDate: true, active: true },
        }),
        prisma.labOrder.groupBy({
          by: ['clientId'],
          where: { organizationId: org, clientId: { in: monitoredIds }, status: { not: 'cancelled' }, orderedAt: { gte: since(365) } },
          _count: { _all: true },
        }),
      ])
    : [[], []];
  const recentLabSet = new Set(recentLabs.map((r) => r.clientId));
  const standingState = new Map<string, boolean>();
  for (const s of standing) {
    const state = standingDueState(s, now);
    if (state === 'ended') continue;
    standingState.set(s.clientId, (standingState.get(s.clientId) ?? false) || state === 'overdue');
  }

  const byAssess = group(assessments, (r) => r.clientId);
  const byMeasure = group(measures, (r) => r.clientId);
  const byTms = group(tmsPhq, (r) => r.course.clientId);
  const byCrisis = group(crises, (r) => r.clientId);
  const byAlert = group(alerts, (r) => r.clientId);
  const byAppt = group(appts, (r) => r.clientId);
  const byThread = group(portal, (r) => r.threadId);
  // Valant-imported plans (TreatmentPlan.goals.source.platform = 'valant') count as a plan on file
  const planRows = plans.map((p) => ({ clientId: p.clientId, status: p.status, reviewDueAt: p.reviewDueAt, createdAt: p.createdAt, imported: Boolean(parsePlanSource(p.goals)) }));
  const byPlan = group(planRows, (r) => r.clientId);
  const byChip = group(chipNotes, (r) => r.clientId);
  const bySigned = group(signedNotes, (r) => r.clientId);
  const unsignedBy = new Map(unsigned.map((u) => [u.clientId, u]));
  const byRefill = group([...rcopiaRefills.map((r) => ({ clientId: r.clientId, at: r.createdAt })), ...ehrRefills.map((r) => ({ clientId: r.clientId, at: r.requestDate }))], (r) => r.clientId);
  const byFill = group(fills, (r) => r.clientId);
  const bySdoh = group(sdoh, (r) => r.clientId);
  const byAuth = group(auths, (r) => r.clientId);
  const programsBy = new Map<string, Set<string>>();
  const addProgram = (clientId: string | null, p: string) => {
    if (!clientId) return;
    const s = programsBy.get(clientId) ?? new Set<string>();
    s.add(p);
    programsBy.set(clientId, s);
  };
  for (const r of prp) if (isCurrent(r.status)) addProgram(r.clientId, 'PRP');
  for (const r of tms) if (isCurrent(r.status)) addProgram(r.clientId, 'TMS');
  for (const r of spravato) if (isCurrent(r.status)) addProgram(r.clientId, 'Spravato');
  for (const r of aot) if (isCurrent(r.status)) addProgram(r.clientId, 'AOT');
  for (const r of residential) addProgram(r.clientId, 'Residential');

  // Portal: per client, patient messages in 30 days and the oldest unanswered patient message
  const portalBy = new Map<string, ClientFacts['portal']>();
  for (const [, msgs] of byThread) {
    const clientId = msgs[0].thread.clientId;
    const cur = portalBy.get(clientId) ?? { patientMessages30d: 0, lastPatientMessage: null, unansweredSince: null };
    let runStart: Date | null = null;
    for (const m of msgs) {
      if (m.senderType === 'PATIENT') {
        if (m.createdAt >= since(30)) cur.patientMessages30d += 1;
        const d = day(m.createdAt);
        if (!cur.lastPatientMessage || d > cur.lastPatientMessage) cur.lastPatientMessage = d;
        if (!runStart) runStart = m.createdAt;
      } else if (m.senderType === 'FRONT_OFFICE') {
        runStart = null;
      }
    }
    if (runStart) {
      const d = day(runStart);
      if (!cur.unansweredSince || d < cur.unansweredSince) cur.unansweredSince = d;
    }
    portalBy.set(clientId, cur);
  }

  const weeks = trendWeeks(today);
  const months = trendMonths(today);
  const attended = new Set<string>(ATTENDED_APPOINTMENT_STATUSES);

  return clients.map((c): EvaluatedClient => {
    // Scores
    const scores: Record<InstrumentKey, ScorePoint[]> = { phq9: [], gad7: [], pcl5: [] };
    let cssrs: ClientFacts['cssrs'] = null;
    let cssrsAt = 0;
    let latestPhqAssess: { at: number; flagged: boolean; date: string } | null = null;
    for (const a of byAssess.get(c.id) ?? []) {
      const k = instrumentOf(a.instrumentId, a.instrumentName);
      if (!k) continue;
      const date = day(a.createdAt);
      if (k === 'cssrs') {
        if (a.createdAt.getTime() > cssrsAt) {
          cssrsAt = a.createdAt.getTime();
          cssrs = { positive: Boolean(a.safetyFlagged), date };
        }
        continue;
      }
      if (typeof a.totalScore === 'number') scores[k].push({ score: a.totalScore, date, source: 'assessment' });
      if (k === 'phq9' && (!latestPhqAssess || a.createdAt.getTime() > latestPhqAssess.at)) {
        latestPhqAssess = { at: a.createdAt.getTime(), flagged: Boolean(a.safetyFlagged), date };
      }
    }
    for (const m of byMeasure.get(c.id) ?? []) {
      const key = m.measurementType.instrumentKey ?? '';
      const k: InstrumentKey | null = PHQ_KEYS.includes(key) ? 'phq9' : GAD_KEYS.includes(key) ? 'gad7' : PCL_KEYS.includes(key) ? 'pcl5' : null;
      if (k && m.valueNumeric != null) scores[k].push({ score: m.valueNumeric, date: day(m.measuredAt), source: 'valant' });
    }
    for (const t of byTms.get(c.id) ?? []) scores.phq9.push({ score: t.score, date: day(t.recordedAt), source: 'tms' });

    // Visits
    const apptRows = byAppt.get(c.id) ?? [];
    const visitDays = new Set<string>();
    for (const a of apptRows) if (attended.has(a.status) && a.startsAt <= now) visitDays.add(day(a.startsAt));
    for (const n of bySigned.get(c.id) ?? []) visitDays.add(n.dateOfService ? n.dateOfService.toISOString().slice(0, 10) : day(n.createdAt));
    const missedVisits = apptRows
      .filter((a) => (a.status === 'NO_SHOW' || a.status === 'LATE_CANCEL') && a.startsAt <= now && a.startsAt >= since(90))
      .map((a) => ({ date: day(a.startsAt), status: a.status as 'NO_SHOW' | 'LATE_CANCEL' }));
    const future = apptRows.filter((a) => a.startsAt > now && (a.status === 'SCHEDULED' || a.status === 'CHECKED_IN')).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0];
    const last = lastVisits.get(c.id);

    // Crisis follow-up within 7 days: attended visit / signed note / completed crisis follow-up
    const crisisRows = (byCrisis.get(c.id) ?? []).map((x) => {
      const date = day(x.startedAt);
      const age = dayDiff(date, today);
      let followedUp7d: boolean | null = null;
      if (age >= 7) {
        const completed = x.followUp24hStatus === 'completed' || x.followUp72hStatus === 'completed';
        const visit = [...visitDays].some((v) => dayDiff(date, v) > 0 && dayDiff(date, v) <= 7);
        followedUp7d = completed || visit ? true : age <= HISTORY_DAYS - 7 ? false : null;
      }
      return { id: x.id, date, followedUp7d };
    });

    const alertRows = byAlert.get(c.id) ?? [];
    const clientPlans = byPlan.get(c.id) ?? [];
    const own = clientPlans.filter((p) => !p.imported && (p.status === 'ACTIVE' || p.status === 'NEEDS_REVIEW'));
    const plan = own.find((p) => p.status === 'ACTIVE') ?? own[0];
    const imported = clientPlans.find((p) => p.imported);

    // Goal chips: latest per goal
    const chips = new Map<number, { goal: number; status: 'Progress made' | 'No change' | 'Regression'; date: string }>();
    for (const n of byChip.get(c.id) ?? []) {
      const date = n.dateOfService ? n.dateOfService.toISOString().slice(0, 10) : day(n.createdAt);
      for (const chip of parseProgressChips(n.body)) {
        const cur = chips.get(chip.goalIndex);
        if (!cur || date > cur.date) chips.set(chip.goalIndex, { goal: chip.goalIndex + 1, status: chip.status as 'Regression', date });
      }
    }

    const refills = (byRefill.get(c.id) ?? []).sort((a, b) => a.at.getTime() - b.at.getTime());
    const u = unsignedBy.get(c.id);
    const sd = (bySdoh.get(c.id) ?? [])[0];
    const auth = (byAuth.get(c.id) ?? [])
      .map((a) => ({ endDate: a.endDate ? day(a.endDate) : null, unitsLeft: a.unitsApproved > 0 ? a.unitsApproved - a.unitsUsed : null }))
      .sort((a, b) => (a.endDate ?? '9999').localeCompare(b.endDate ?? '9999'))[0] ?? null;
    const cad = cadence ? cadence.get(c.id) : undefined;
    const sets = monitored.get(c.id);

    const facts: ClientFacts = {
      clientId: c.id,
      clientStatus: c.status,
      chartRisk: c.riskLevel,
      scores,
      phq9SafetyFlagDate: latestPhqAssess?.flagged ? latestPhqAssess.date : null,
      cssrs,
      crises: crisisRows,
      openAlerts: alertRows.filter((a) => !a.reviewed).map((a) => ({ severity: a.severity, type: a.type, source: a.source, date: day(a.createdAt) })),
      riskLanguage: alertRows.filter((a) => a.type === 'risk_language' && a.createdAt >= since(30)).map((a) => ({ severity: a.severity, date: day(a.createdAt), reviewed: a.reviewed })),
      safetyPlan: ctx.safetyPlanIds.has(c.id),
      missedVisits,
      lastVisit: last ? day(last) : null,
      nextAppointment: future ? day(future.startsAt) : null,
      cadence: cadence === null
        ? null
        : cad
          ? {
              therapy: { status: cad.therapy.status, daysOverdue: cad.therapy.daysOverdue, label: cad.therapy.recommendation.label },
              med: { status: cad.medManagement.status, daysOverdue: cad.medManagement.daysOverdue, label: cad.medManagement.recommendation.label },
            }
          : null,
      portal: portalBy.get(c.id) ?? { patientMessages30d: 0, lastPatientMessage: null, unansweredSince: null },
      plan: plan ? { status: plan.status as 'ACTIVE' | 'NEEDS_REVIEW', reviewDue: plan.reviewDueAt ? day(plan.reviewDueAt) : null, createdOn: day(plan.createdAt) } : null,
      goalChips: [...chips.values()].sort((a, b) => a.goal - b.goal),
      unsignedNotes: { count: u?._count._all ?? 0, oldest: u?._min.createdAt ? day(u._min.createdAt) : null },
      refillsPending: { count: refills.length, oldest: refills[0] ? day(refills[0].at) : null },
      fillProblems: (byFill.get(c.id) ?? []).map((f) => ({ date: day(f.fillDate) })),
      labs: sets ? { monitoredSets: sets, overdue: standingState.has(c.id) ? standingState.get(c.id)! : !recentLabSet.has(c.id) } : null,
      sdoh: sd ? { date: day(sd.completedAt), domains: sd.positiveDomains } : null,
      auth,
      insuranceEndsOn: c.insuranceEffectiveTo ? c.insuranceEffectiveTo.toISOString().slice(0, 10) : null,
      discharge: ctx.discharges.get(c.id) ?? null,
      importedPlan: imported ? { status: imported.status, reviewDue: imported.reviewDueAt ? day(imported.reviewDueAt) : null } : null,
      valantClient: isValantClient(c),
      planTransitionUntil: ctx.planTransitionUntil,
      firstSeen: c.importedAt ? null : day(c.createdAt),
    };
    const evaluation = evaluateClient(facts, today);

    // History for trends
    const history: RowHistory = {
      weeks: weeks.map((start) => {
        const end = addDays(start, 7);
        let att = 0, missed = 0;
        for (const a of apptRows) {
          if (a.startsAt > now) continue;
          const d = day(a.startsAt);
          if (d < start || d >= end) continue;
          if (attended.has(a.status)) att += 1;
          else if (a.status === 'NO_SHOW' || a.status === 'LATE_CANCEL') missed += 1;
        }
        return { start, attended: att, missed };
      }),
      months: months.map((month) => {
        const endDay = month === today.slice(0, 7) ? today : monthEnd(month);
        const flags = trajectoryFlags(
          (['phq9', 'gad7', 'pcl5'] as const)
            .map((k) => trajectory(k, scores[k].filter((p) => p.date <= endDay), endDay))
            .filter((t): t is NonNullable<typeof t> => t !== null)
        );
        const inMonth = (d: string) => d.slice(0, 7) === month;
        return {
          month,
          seen: [...visitDays].some(inMonth),
          measured: scores.phq9.some((p) => inMonth(p.date)) || scores.gad7.some((p) => inMonth(p.date)),
          ...flags,
        };
      }),
    };
    return { client: c, facts, evaluation, history, programs: [...(programsBy.get(c.id) ?? [])].sort() };
  });
}

/** Snapshot / API row for one evaluated client */
export function toInsightRow(e: EvaluatedClient, scannedAt: string): InsightRow {
  const { client: c, facts, evaluation: ev } = e;
  const flags = trajectoryFlags(ev.trajectories);
  const phq = normalizeScores(facts.scores.phq9, 'phq9', scannedAt.slice(0, 10)).at(-1);
  return {
    id: c.id,
    name: c.name,
    mrn: c.mrn,
    clinician: c.assignedTo ? { id: c.assignedTo.id, name: c.assignedTo.name || 'Unnamed clinician' } : null,
    location: c.location,
    programs: e.programs,
    payer: payerOf(c.insurancePayer, c.insuranceType),
    dxGroup: dxGroupOf(c.primaryDiagnosisCode),
    tier: ev.tier,
    rank: ev.rank,
    rules: ev.rules,
    signals: ev.signals,
    nextAppointment: facts.nextAppointment,
    lastVisit: facts.lastVisit,
    metrics: {
      seen90: facts.lastVisit != null && dayDiff(facts.lastVisit, scannedAt.slice(0, 10)) <= 90,
      phq9Current: Boolean(phq && dayDiff(phq.date, scannedAt.slice(0, 10)) <= 90),
      ...flags,
    },
    coverage: {
      phq9: facts.scores.phq9.length > 0,
      gad7: facts.scores.gad7.length > 0,
      pcl5: facts.scores.pcl5.length > 0,
      cssrs: facts.cssrs != null,
      visit: facts.lastVisit != null,
      futureAppt: facts.nextAppointment != null,
      plan: facts.plan != null || facts.importedPlan != null,
      safetyPlan: facts.safetyPlan,
      sdoh: facts.sdoh != null,
      cadence: facts.cadence != null,
      portal: facts.portal.lastPatientMessage != null,
      medication: facts.labs != null,
    },
    recentDischarge: facts.discharge != null,
    scannedAt,
  };
}

/**
 * Evaluate every client matching `where` in batches. `lockedIds` returns protected clients to
 * drop BEFORE any clinical row is read. `onBatch` receives each evaluated batch.
 */
export async function runInsightsScan(opts: {
  ctx: ScanContext;
  where: Prisma.ClientWhereInput;
  lockedIds: (ids: string[]) => Promise<Set<string>>;
  onBatch?: (rows: EvaluatedClient[]) => Promise<void>;
  maxClients?: number;
  batchSize?: number;
}): Promise<{ evaluated: EvaluatedClient[]; clientsScanned: number; sensitiveHidden: number; truncated: boolean }> {
  const batchSize = opts.batchSize ?? BATCH_SIZE;
  const maxClients = opts.maxClients ?? MAX_CLIENTS;
  const evaluated: EvaluatedClient[] = [];
  let hidden = 0;
  let seen = 0;
  let truncated = false;
  let cursor: string | undefined;
  const pending: Promise<void>[] = [];
  for (;;) {
    if (seen >= maxClients) {
      truncated = true;
      break;
    }
    const take = Math.min(batchSize, maxClients - seen);
    const rows = await prisma.client.findMany({
      where: opts.where,
      select: INSIGHT_CLIENT_SELECT,
      orderBy: { id: 'asc' },
      take,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (!rows.length) break;
    cursor = rows[rows.length - 1].id;
    seen += rows.length;
    const locked = await opts.lockedIds(rows.map((r) => r.id));
    const open = rows.filter((r) => !locked.has(r.id));
    hidden += rows.length - open.length;
    const p = loadBatch(opts.ctx, open).then(async (batch) => {
      evaluated.push(...batch);
      if (opts.onBatch) await opts.onBatch(batch);
    });
    p.catch(() => {});
    pending.push(p);
    if (pending.length >= CONCURRENCY) await pending.shift();
    if (rows.length < take) break;
  }
  await Promise.all(pending);
  return { evaluated, clientsScanned: evaluated.length, sensitiveHidden: hidden, truncated };
}
