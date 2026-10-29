/**
 * Measure scheduling (pure; no database). Which measures are due for a visit, which stage of the
 * pre-visit send it is (3 days / 1 day before), what the auto-assignment rules add, and the status
 * label of a send. Dates are clinic days (YYYY-MM-DD).
 *
 * Due rules per assignment:
 *  - once:         due until it has been completed once on or after its start date
 *  - interval:     due when the latest result is older than `everyDays` (with a tolerance of up to
 *                  7 days so a 30-day measure done 28 days ago still goes out for this visit)
 *  - before_visit: due for every visit unless completed in the 4 days before it
 * An assignment that is paused / ended, starts after the visit or ended before it is never due.
 */
import { depressionInstrumentForAge, isSendable } from './instruments';

export type MeasureSchedule = 'once' | 'interval' | 'before_visit';
export type MeasureSource = 'manual' | 'program' | 'provider_rule' | 'visit_rule' | 'sud_radar' | 'legacy';
export type SendStage = 'visit_3d' | 'visit_1d';

export const SEND_STAGE_DAYS: Readonly<Record<SendStage, number>> = Object.freeze({ visit_3d: 3, visit_1d: 1 });

export type AssignmentLike = {
  id: string;
  clientId: string;
  instrumentId: string;
  schedule: MeasureSchedule | string;
  everyDays: number | null;
  /** YYYY-MM-DD */
  startDate: string;
  endDate: string | null;
  status: string;
};

const DAY_MS = 86_400_000;

export function dayDiff(fromDay: string, toDay: string): number {
  return Math.round((Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / DAY_MS);
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Days of slack before an interval measure counts as due again */
export function intervalTolerance(everyDays: number): number {
  return Math.min(7, Math.floor(everyDays / 4));
}

/**
 * Is this assignment due for a visit on `visitDay`? `latestDay` = the latest completed result of
 * this instrument for the client (any source: portal, session, paper), or null.
 */
export function isDueForVisit(a: AssignmentLike, visitDay: string, latestDay: string | null): boolean {
  if (a.status !== 'active') return false;
  if (a.startDate > visitDay) return false;
  if (a.endDate && a.endDate < visitDay) return false;
  if (!isSendable(a.instrumentId)) return false;
  if (a.schedule === 'once') return !latestDay || latestDay < a.startDate;
  if (a.schedule === 'before_visit') return !latestDay || dayDiff(latestDay, visitDay) > 4;
  const every = Math.max(1, a.everyDays ?? 30);
  if (!latestDay) return true;
  return dayDiff(latestDay, visitDay) >= every - intervalTolerance(every);
}

/** Which send stage `today` is for a visit on `visitDay` (null: not a send day) */
export function sendStageFor(today: string, visitDay: string): SendStage | null {
  const d = dayDiff(today, visitDay);
  if (d === SEND_STAGE_DAYS.visit_3d) return 'visit_3d';
  if (d === SEND_STAGE_DAYS.visit_1d) return 'visit_1d';
  return null;
}

export type VisitSendPlan = {
  instrumentIds: string[];
  assignmentIds: string[];
};

/**
 * Measures to send for one client and visit: due assignments, one per instrument (the earliest
 * assignment wins), catalog-sendable only. Instruments already in an open (not completed /
 * expired) request for this visit are still re-sent on the 1-day stage as a reminder.
 */
export function planVisitSend(input: {
  assignments: AssignmentLike[];
  visitDay: string;
  latestByInstrument: ReadonlyMap<string, string>;
}): VisitSendPlan {
  const seen = new Set<string>();
  const out: VisitSendPlan = { instrumentIds: [], assignmentIds: [] };
  for (const a of input.assignments) {
    if (seen.has(a.instrumentId)) continue;
    if (!isDueForVisit(a, input.visitDay, input.latestByInstrument.get(a.instrumentId) ?? null)) continue;
    seen.add(a.instrumentId);
    out.instrumentIds.push(a.instrumentId);
    out.assignmentIds.push(a.id);
  }
  return out;
}

/** activeKey: one open assignment per client and measure */
export function activeKeyFor(clientId: string, instrumentId: string): string {
  return `${clientId}:${instrumentId}`;
}

// ─── Auto-assignment rules ───────────────────────────────────────────────────

export type MbcRule = { instrumentIds: string[]; everyDays: number };
export type ProgramRule = MbcRule & { programId: string };
export type ProviderRule = MbcRule & { userId: string };

export type RuleSettings = {
  visitRule: boolean;
  programRule: boolean;
  providerRule: boolean;
  phq9Days: number;
  gad7Days: number;
  programMeasures: ProgramRule[];
  providerMeasures: ProviderRule[];
};

/** Visit kinds rule a covers: therapy (individual / family / intake) and medication management */
export const VISIT_RULE_KINDS: ReadonlySet<string> = new Set(['therapy_individual', 'therapy_family', 'therapy_intake', 'med_management', 'psych_reeval']);

export type RuleAdd = {
  clientId: string;
  instrumentId: string;
  schedule: 'interval';
  everyDays: number;
  source: Extract<MeasureSource, 'visit_rule' | 'program' | 'provider_rule'>;
  sourceRef: string;
};

const clampDays = (n: unknown, fallback: number) => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) && v >= 1 && v <= 365 ? v : fallback;
};

/** Valid rule rows from the stored JSON (unknown / pending instruments dropped) */
export function parseRules<K extends 'programId' | 'userId'>(raw: unknown, key: K): (MbcRule & Record<K, string>)[] {
  if (!Array.isArray(raw)) return [];
  const out: (MbcRule & Record<K, string>)[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const id = typeof o[key] === 'string' ? (o[key] as string).trim() : '';
    if (!id) continue;
    const ids = Array.isArray(o.instrumentIds) ? [...new Set(o.instrumentIds.map(String))].filter(isSendable) : [];
    if (!ids.length) continue;
    out.push({ [key]: id, instrumentIds: ids.slice(0, 10), everyDays: clampDays(o.everyDays, 30) } as MbcRule & Record<K, string>);
  }
  return out.slice(0, 100);
}

/**
 * New assignments the enabled rules call for. Never adds a measure the client already has open
 * (existingActiveKeys) or twice in one run. Rules are OFF unless leadership turned them on.
 */
export function planRuleAssignments(input: {
  settings: RuleSettings;
  /** Upcoming visits (any status still expected), with the resolved visit kind */
  upcomingVisits: { clientId: string; clinicianId: string | null; kind: string; ageYears: number | null }[];
  /** Admitted intensive program enrollments */
  enrollments: { clientId: string; programId: string }[];
  existingActiveKeys: ReadonlySet<string>;
}): RuleAdd[] {
  const s = input.settings;
  const taken = new Set(input.existingActiveKeys);
  const out: RuleAdd[] = [];
  const add = (r: RuleAdd) => {
    if (!isSendable(r.instrumentId)) return;
    const k = activeKeyFor(r.clientId, r.instrumentId);
    if (taken.has(k)) return;
    taken.add(k);
    out.push(r);
  };
  if (s.visitRule) {
    for (const v of input.upcomingVisits) {
      if (!VISIT_RULE_KINDS.has(v.kind)) continue;
      add({ clientId: v.clientId, instrumentId: depressionInstrumentForAge(v.ageYears), schedule: 'interval', everyDays: clampDays(s.phq9Days, 30), source: 'visit_rule', sourceRef: 'visit' });
      add({ clientId: v.clientId, instrumentId: 'gad-7', schedule: 'interval', everyDays: clampDays(s.gad7Days, 30), source: 'visit_rule', sourceRef: 'visit' });
    }
  }
  if (s.programRule) {
    const byProgram = new Map(s.programMeasures.map((r) => [r.programId, r]));
    for (const e of input.enrollments) {
      const rule = byProgram.get(e.programId);
      if (!rule) continue;
      for (const id of rule.instrumentIds) add({ clientId: e.clientId, instrumentId: id, schedule: 'interval', everyDays: rule.everyDays, source: 'program', sourceRef: e.programId });
    }
  }
  if (s.providerRule) {
    const byUser = new Map(s.providerMeasures.map((r) => [r.userId, r]));
    for (const v of input.upcomingVisits) {
      const rule = v.clinicianId ? byUser.get(v.clinicianId) : undefined;
      if (!rule) continue;
      for (const id of rule.instrumentIds) add({ clientId: v.clientId, instrumentId: id, schedule: 'interval', everyDays: rule.everyDays, source: 'provider_rule', sourceRef: v.clinicianId! });
    }
  }
  return out;
}

// ─── Send status (what staff see) ────────────────────────────────────────────

export type RequestStatusLabel = 'Not sent' | 'Sent' | 'Opened' | 'Started' | 'Completed' | 'Expired' | 'Locked' | 'Cancelled';

export function requestStatusLabel(r: { status: string; expiresAt: Date | string; completedAt?: Date | string | null }, now: Date): RequestStatusLabel {
  if (r.completedAt || r.status === 'completed') return 'Completed';
  if (r.status === 'locked') return 'Locked';
  if (r.status === 'cancelled') return 'Cancelled';
  if (r.status === 'not_sent' || r.status === 'pending') return 'Not sent';
  if (r.status === 'expired' || new Date(r.expiresAt).getTime() <= now.getTime()) return 'Expired';
  if (r.status === 'started') return 'Started';
  if (r.status === 'opened') return 'Opened';
  return 'Sent';
}
