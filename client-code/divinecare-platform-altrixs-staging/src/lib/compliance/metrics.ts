/**
 * Computed compliance metrics (pure, client-safe).
 *
 * Rule: never invent a value. When the inputs needed for a metric are missing the
 * result is `null`, and the UI shows "No data" / "Not recorded" instead of a number.
 */
import { DEFAULT_PRACTICE_TIME_ZONE, practiceToday } from '@/lib/time/practiceTime';
import { addBusinessDays } from '@/lib/workflows/dates';

// ─── Practice quarter ─────────────────────────────────────────────────────────

export type PracticeQuarter = {
  year: number;
  quarter: 1 | 2 | 3 | 4;
  /** e.g. "Q4 2026" */
  label: string;
  /** YYYY-MM-DD, inclusive */
  startIso: string;
  /** YYYY-MM-DD, inclusive */
  endIso: string;
  /** e.g. "Oct 1 – Dec 31, 2026" */
  rangeLabel: string;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The calendar quarter containing "today" in the practice time zone (America/New_York). */
export function practiceQuarter(now = new Date(), timeZone = DEFAULT_PRACTICE_TIME_ZONE): PracticeQuarter {
  const today = practiceToday(timeZone, now);
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const quarter = (Math.floor((month - 1) / 3) + 1) as 1 | 2 | 3 | 4;
  const firstMonth = (quarter - 1) * 3 + 1;
  const lastMonth = firstMonth + 2;
  const lastDay = new Date(Date.UTC(year, lastMonth, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    year,
    quarter,
    label: `Q${quarter} ${year}`,
    startIso: `${year}-${pad(firstMonth)}-01`,
    endIso: `${year}-${pad(lastMonth)}-${pad(lastDay)}`,
    rangeLabel: `${MONTHS[firstMonth - 1]} 1 – ${MONTHS[lastMonth - 1]} ${lastDay}, ${year}`,
  };
}

/** True when a date (YYYY-MM-DD or ISO datetime) falls inside the quarter. */
export function isInQuarter(iso: string | null | undefined, q: PracticeQuarter): boolean {
  if (!iso) return false;
  const day = iso.slice(0, 10);
  return day >= q.startIso && day <= q.endIso;
}

/** Practice-time year for "YTD" counts. */
export function practiceYear(now = new Date(), timeZone = DEFAULT_PRACTICE_TIME_ZONE): number {
  return Number(practiceToday(timeZone, now).slice(0, 4));
}

/** Practice-time date `days` before today (YYYY-MM-DD). */
export function practiceDaysAgo(days: number, now = new Date(), timeZone = DEFAULT_PRACTICE_TIME_ZONE): string {
  const today = practiceToday(timeZone, now);
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

// ─── Incident timeliness ──────────────────────────────────────────────────────

export type Timeliness = 'within_24h' | 'late';

function parseInstant(value: string | null | undefined): number | null {
  if (!value) return null;
  // A bare date carries no time of day, so the 24-hour window cannot be measured.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * CARF 24-hour reporting timeliness. Only computed when both the time the incident
 * occurred and the time it was reported are known (date + time). Otherwise `null`.
 */
export function incidentTimeliness(
  occurredAt: string | null | undefined,
  reportedAt: string | null | undefined,
): Timeliness | null {
  const occurred = parseInstant(occurredAt);
  const reported = parseInstant(reportedAt);
  if (occurred === null || reported === null) return null;
  if (reported < occurred) return null; // inconsistent entry; do not guess
  return reported - occurred <= 24 * 3_600_000 ? 'within_24h' : 'late';
}

// ─── Training status ──────────────────────────────────────────────────────────

export type TrainingStatus = 'complete' | 'expiring' | 'overdue' | 'not-required' | 'in-progress' | 'not-started';

export type TrainingRecord = {
  status?: string;
  completedDate?: string;
  expiresDate?: string;
};

/** Months of validity for a course frequency label; null = never expires; undefined = unknown. */
export function frequencyMonths(frequency: string | null | undefined): number | null | undefined {
  const f = String(frequency ?? '').trim().toLowerCase();
  if (!f) return undefined;
  if (f.includes('one-time') || f.includes('one time') || f === 'once') return null;
  if (f.includes('annual') || f === '1yr' || f === '1 yr' || f === 'yearly') return 12;
  if (f.includes('quarter')) return 3;
  if (f.includes('month')) return 1;
  const yr = f.match(/^(\d+)\s*-?\s*(yr|year|years)$/);
  if (yr) return Number(yr[1]) * 12;
  const mo = f.match(/^(\d+)\s*-?\s*(mo|month|months)$/);
  if (mo) return Number(mo[1]);
  return undefined;
}

/** Expiry date from the completion date and the course frequency; undefined when it cannot be known. */
export function expiryFromFrequency(completedIso: string, frequency: string | null | undefined): string | undefined {
  const months = frequencyMonths(frequency);
  if (months === null || months === undefined) return undefined;
  const d = new Date(`${completedIso.slice(0, 10)}T12:00:00Z`);
  if (!Number.isFinite(d.getTime())) return undefined;
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/** Status computed from the recorded dates; falls back to the stored status only when no completion is recorded. */
export function trainingStatusFromDates(t: TrainingRecord, todayIso: string, expiringWindowDays = 30): TrainingStatus {
  if (t.status === 'not-required') return 'not-required';
  if (t.completedDate) {
    if (!t.expiresDate) return 'complete';
    const exp = t.expiresDate.slice(0, 10);
    if (exp < todayIso) return 'overdue';
    const windowEnd = new Date(`${todayIso}T12:00:00Z`);
    windowEnd.setUTCDate(windowEnd.getUTCDate() + expiringWindowDays);
    return exp <= windowEnd.toISOString().slice(0, 10) ? 'expiring' : 'complete';
  }
  if (t.status === 'in-progress') return 'in-progress';
  if (t.status === 'overdue') return 'overdue';
  return 'not-started';
}

// ─── Compliance calendar ──────────────────────────────────────────────────────

export type CalendarItemLike = { status: string; dueDate: string; completedAt?: string };

/** Overdue = any open item whose due date has passed. */
export function isOverdueCalendarItem(item: CalendarItemLike, todayIso: string): boolean {
  if (item.status === 'completed') return false;
  return item.status === 'overdue' || (!!item.dueDate && item.dueDate.slice(0, 10) < todayIso);
}

/** Completed items with completedAt in the given year. */
export function completedInYear(items: CalendarItemLike[], year: number): number {
  const prefix = `${year}-`;
  return items.filter((i) => i.status === 'completed' && !!i.completedAt && i.completedAt.startsWith(prefix)).length;
}

// ─── Readiness score ──────────────────────────────────────────────────────────

export type ReadinessFactor = { key: string; label: string; weight: number; score: number | null; note: string };
export type Readiness = { overall: number | null; factors: ReadinessFactor[]; factorsWithData: number };

type IncidentLike = { status?: string; severity?: string; reportedAt?: string };
type GrievanceLike = { status?: string; submittedAt?: string; receivedAt?: string; dueDate?: string };
type SafetyPlanLike = { withoutPlan?: boolean; reviewDue?: boolean };
type TrainingStaffLike = { trainings?: TrainingRecord[] };
type MeetingLike = { date?: string };
type DischargeLike = { milestones?: { completed?: boolean }[] };

const OPEN_INCIDENT = new Set(['reported', 'investigating', 'corrective_action']);
const OPEN_GRIEVANCE = new Set(['submitted', 'acknowledged', 'investigating', 'appealed']);

export type ReadinessInputs = {
  safetyPlans: SafetyPlanLike[];
  trainingStaff: TrainingStaffLike[];
  qiMeetings: MeetingLike[];
  incidents: IncidentLike[];
  grievances: GrievanceLike[];
  dischargeCases: DischargeLike[];
  now?: Date;
  timeZone?: string;
};

const pct = (n: number, d: number) => Math.round((n / d) * 100);

export function computeReadiness(input: ReadinessInputs): Readiness {
  const now = input.now ?? new Date();
  const tz = input.timeZone ?? DEFAULT_PRACTICE_TIME_ZONE;
  const today = practiceToday(tz, now);
  const factors: ReadinessFactor[] = [];

  // 1. Safety plans current
  {
    const n = input.safetyPlans.length;
    const ok = input.safetyPlans.filter((p) => !p.withoutPlan && !p.reviewDue).length;
    factors.push({
      key: 'safety', label: 'Safety Plans', weight: 20,
      score: n ? pct(ok, n) : null,
      note: n ? `${ok} of ${n} current` : 'No safety plans recorded',
    });
  }

  // 2. Required staff training current (status computed from dates)
  {
    const required = input.trainingStaff
      .flatMap((s) => s.trainings ?? [])
      .map((t) => trainingStatusFromDates(t, today))
      .filter((s) => s !== 'not-required');
    const ok = required.filter((s) => s === 'complete' || s === 'expiring').length;
    factors.push({
      key: 'training', label: 'Staff Training', weight: 20,
      score: required.length ? pct(ok, required.length) : null,
      note: required.length ? `${ok} of ${required.length} current` : 'No training records',
    });
  }

  // 3. QI meeting held in the last 90 days
  {
    const since = practiceDaysAgo(90, now, tz);
    const dated = input.qiMeetings.filter((m) => !!m.date);
    const recent = dated.filter((m) => m.date!.slice(0, 10) >= since && m.date!.slice(0, 10) <= today);
    factors.push({
      key: 'qi', label: 'QI Meeting (90 days)', weight: 15,
      score: dated.length ? (recent.length ? 100 : 0) : null,
      note: dated.length ? (recent.length ? `${recent.length} in last 90 days` : 'None in last 90 days') : 'No QI meetings recorded',
    });
  }

  // 4. No open critical/serious incident older than 48 hours
  {
    const n = input.incidents.length;
    const cutoff = now.getTime() - 48 * 3_600_000;
    const overdue = input.incidents.filter((i) => {
      if (!OPEN_INCIDENT.has(String(i.status))) return false;
      if (i.severity !== 'critical' && i.severity !== 'serious') return false;
      if (!i.reportedAt) return false;
      const t = new Date(/^\d{4}-\d{2}-\d{2}$/.test(i.reportedAt) ? `${i.reportedAt}T12:00:00` : i.reportedAt).getTime();
      return Number.isFinite(t) && t < cutoff;
    }).length;
    factors.push({
      key: 'incidents', label: 'Critical Incidents', weight: 15,
      score: n ? (overdue ? 0 : 100) : null,
      note: n ? (overdue ? `${overdue} open > 48h` : '0 open > 48h') : 'No incident records',
    });
  }

  // 5. No open grievance past its 10-business-day resolution target
  {
    const n = input.grievances.length;
    const overdue = input.grievances.filter((g) => {
      if (!OPEN_GRIEVANCE.has(String(g.status))) return false;
      let due = g.dueDate?.slice(0, 10);
      const start = (g.receivedAt ?? g.submittedAt)?.slice(0, 10);
      if (!due && start && /^\d{4}-\d{2}-\d{2}$/.test(start)) due = addBusinessDays(start, 10);
      return !!due && due < today;
    }).length;
    factors.push({
      key: 'grievances', label: 'Grievances (10 business days)', weight: 15,
      score: n ? (overdue ? 0 : 100) : null,
      note: n ? (overdue ? `${overdue} past due` : '0 past due') : 'No grievance records',
    });
  }

  // 6. Discharge follow-up milestones
  {
    const ms = input.dischargeCases.flatMap((c) => c.milestones ?? []);
    const done = ms.filter((m) => m.completed).length;
    factors.push({
      key: 'discharge', label: 'Discharge Follow-ups', weight: 15,
      score: ms.length ? pct(done, ms.length) : null,
      note: ms.length ? `${done} of ${ms.length} milestones` : 'No discharge milestones',
    });
  }

  const withData = factors.filter((f) => f.score !== null);
  const weight = withData.reduce((s, f) => s + f.weight, 0);
  const overall = weight
    ? Math.round(withData.reduce((s, f) => s + (f.score as number) * f.weight, 0) / weight)
    : null;
  return { overall, factors, factorsWithData: withData.length };
}
