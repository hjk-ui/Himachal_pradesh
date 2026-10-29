/**
 * Report library formulas (pure, unit tested). Every rate returns null when its denominator is 0:
 * the UI shows "No data", never 0% standing in for "unknown".
 */
import { RELIABLE_CHANGE as INSIGHT_RELIABLE_CHANGE } from '@/lib/insights/clinical/rules';

const DAY_MS = 86_400_000;

export function pct(numerator: number, denominator: number): number | null {
  if (!denominator || denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function avgOrNull(values: number[]): number | null {
  return values.length ? round1(values.reduce((s, v) => s + v, 0) / values.length) : null;
}

export function medianOrNull(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return round1(s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2);
}

/** Whole days from `from` to `to` (never negative). */
export function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / DAY_MS));
}

// ─── A/R aging ───────────────────────────────────────────────────────────────

/** Same boundaries as AR Control (src/lib/billing/arControl.ts AR_AGING_BUCKETS). */
export const AGING_BUCKETS = [
  { key: 'b0_30', label: '0-30', max: 30 },
  { key: 'b31_60', label: '31-60', max: 60 },
  { key: 'b61_90', label: '61-90', max: 90 },
  { key: 'b91_120', label: '91-120', max: 120 },
  { key: 'b120p', label: '120+', max: Infinity },
] as const;
export type AgingBucketKey = (typeof AGING_BUCKETS)[number]['key'];

export function agingBucket(days: number): AgingBucketKey {
  for (const b of AGING_BUCKETS) if (days <= b.max) return b.key;
  return 'b120p';
}

export type AgingTotals = Record<AgingBucketKey, number> & { total: number };

export function emptyAging(): AgingTotals {
  return { b0_30: 0, b31_60: 0, b61_90: 0, b91_120: 0, b120p: 0, total: 0 };
}

export function addAging(t: AgingTotals, days: number, cents: number): void {
  t[agingBucket(days)] += cents;
  t.total += cents;
}

/**
 * Outstanding cents on an Altrixs claim (AR Control's rule): the patient responsibility when the
 * ERA set one; else billed minus the larger of ERA-paid and ledger payments; never negative.
 */
export function claimOutstandingCents(c: {
  amountCents: number | null;
  paidAmount: number | null;
  patientResponsibility: number | null;
  paymentsCents: number;
}): number {
  const billed = c.amountCents ?? 0;
  const paid = Math.max(Math.round((c.paidAmount ?? 0) * 100), c.paymentsCents);
  const resp = c.patientResponsibility != null ? Math.round(c.patientResponsibility * 100) : null;
  if (resp != null && resp > 0) return resp;
  return Math.max(0, billed - paid);
}

// ─── Revenue cycle KPIs ──────────────────────────────────────────────────────

/**
 * Days in A/R = ending A/R ÷ average daily charges over the period
 * (average daily charges = gross charges in the period ÷ calendar days in the period).
 * null when there were no charges (cannot divide) or the period has no days.
 */
export function daysInAr(endingArCents: number, chargesCents: number, periodDays: number): number | null {
  if (periodDays <= 0 || chargesCents <= 0) return null;
  return round1(endingArCents / (chargesCents / periodDays));
}

/**
 * Net collection rate = payments ÷ (charges − contractual adjustments) × 100 (MGMA / HFMA).
 * null when the net collectible amount is not positive.
 */
export function netCollectionRate(paymentsCents: number, chargesCents: number, contractualAdjCents: number): number | null {
  const net = chargesCents - contractualAdjCents;
  if (net <= 0) return null;
  return round1((paymentsCents / net) * 100);
}

/** Gross collection rate = payments ÷ charges × 100. */
export function grossCollectionRate(paymentsCents: number, chargesCents: number): number | null {
  return pct(paymentsCents, chargesCents);
}

/** Denial rate = denied claims ÷ claims with a payer decision (accepted, paid or denied) × 100. */
export function denialRate(denied: number, decided: number): number | null {
  return pct(denied, decided);
}

/** Clean claim (first-pass) rate = claims accepted / paid with no denial ever ÷ decided claims × 100. */
export function cleanClaimRate(firstPassAccepted: number, decided: number): number | null {
  return pct(firstPassAccepted, decided);
}

// ─── Scheduling ──────────────────────────────────────────────────────────────

export type ApptCounts = {
  scheduled: number;
  completed: number;
  noShow: number;
  lateCancel: number;
  cancelled: number;
  /** CHECKED_IN / IN_SESSION (arrived, not closed out) */
  arrived: number;
};

export function emptyApptCounts(): ApptCounts {
  return { scheduled: 0, completed: 0, noShow: 0, lateCancel: 0, cancelled: 0, arrived: 0 };
}

export function addApptStatus(c: ApptCounts, status: string, n = 1): void {
  switch (status) {
    case 'COMPLETED': c.completed += n; break;
    case 'NO_SHOW': c.noShow += n; break;
    case 'LATE_CANCEL': c.lateCancel += n; break;
    case 'CANCELLED': c.cancelled += n; break;
    case 'CHECKED_IN':
    case 'IN_SESSION': c.arrived += n; break;
    default: c.scheduled += n;
  }
}

/** Total booked = every appointment on the schedule in the period, any status. */
export function bookedTotal(c: ApptCounts): number {
  return c.scheduled + c.completed + c.noShow + c.lateCancel + c.cancelled + c.arrived;
}

/**
 * No-show rate = no-shows ÷ (kept + no-shows) × 100, where kept = completed + arrived.
 * Same denominator as the Outcomes report (completed + no-shows); cancellations made in time are
 * not appointments the client failed to attend.
 */
export function noShowRate(c: ApptCounts): number | null {
  return pct(c.noShow, c.completed + c.arrived + c.noShow);
}

/** Late-cancel rate = late cancels ÷ (kept + no-shows + late cancels) × 100. */
export function lateCancelRate(c: ApptCounts): number | null {
  return pct(c.lateCancel, c.completed + c.arrived + c.noShow + c.lateCancel);
}

/** Utilization (kept rate) = completed ÷ booked excluding timely cancellations × 100. */
export function keptRate(c: ApptCounts): number | null {
  return pct(c.completed + c.arrived, bookedTotal(c) - c.cancelled);
}

// ─── Documentation timeliness ────────────────────────────────────────────────

export const NOTE_TIMELINESS_BUCKETS = [
  { key: 'within24', label: 'Signed within 24 h' },
  { key: 'within72', label: 'Signed 24-72 h' },
  { key: 'over72', label: 'Signed after 72 h' },
  { key: 'unsigned', label: 'Not signed yet' },
] as const;
export type NoteTimelinessKey = (typeof NOTE_TIMELINESS_BUCKETS)[number]['key'];

/**
 * Timeliness of one note: hours from the service (date of service / visit start, else note
 * creation) to the clinician's signature. A signature before the service counts as within 24 h.
 */
export function noteTimeliness(serviceAt: Date, signedAt: Date | null): NoteTimelinessKey {
  if (!signedAt) return 'unsigned';
  const hours = (signedAt.getTime() - serviceAt.getTime()) / 3_600_000;
  if (hours <= 24) return 'within24';
  if (hours <= 72) return 'within72';
  return 'over72';
}

export const UNSIGNED_AGING_BUCKETS = [
  { key: 'd0_1', label: '0-1 days', max: 1 },
  { key: 'd2_3', label: '2-3 days', max: 3 },
  { key: 'd4_7', label: '4-7 days', max: 7 },
  { key: 'd8_14', label: '8-14 days', max: 14 },
  { key: 'd15_30', label: '15-30 days', max: 30 },
  { key: 'd30p', label: 'Over 30 days', max: Infinity },
] as const;

export function unsignedAgingBucket(days: number): (typeof UNSIGNED_AGING_BUCKETS)[number]['key'] {
  for (const b of UNSIGNED_AGING_BUCKETS) if (days <= b.max) return b.key;
  return 'd30p';
}

// ─── Measurement-based care ──────────────────────────────────────────────────

/**
 * Reliable change thresholds: the same points Clinical Insights uses (src/lib/insights/clinical/
 * rules.ts RELIABLE_CHANGE: PHQ-9 5, GAD-7 4). A change of at least this many points between the
 * first and the latest score is reliable improvement or deterioration.
 */
export const RELIABLE_CHANGE = { 'phq-9': INSIGHT_RELIABLE_CHANGE.phq9, 'gad-7': INSIGHT_RELIABLE_CHANGE.gad7 } as const;

export type ReliableChange = 'improved' | 'worsened' | 'no_reliable_change';

export function reliableChange(baseline: number, latest: number, threshold: number): ReliableChange {
  const diff = latest - baseline;
  if (diff <= -threshold) return 'improved';
  if (diff >= threshold) return 'worsened';
  return 'no_reliable_change';
}

// ─── Small-cell suppression ──────────────────────────────────────────────────

/** Cells counting 1-9 people are hidden from non-clinical viewers (CMS cell-size convention). */
export const SMALL_CELL_THRESHOLD = 10;
export const SUPPRESSED_LABEL = '<10';

export function isSmallCount(v: unknown): boolean {
  return typeof v === 'number' && v > 0 && v < SMALL_CELL_THRESHOLD;
}

// ─── Treatment plan state ────────────────────────────────────────────────────

export type PlanState = 'missing' | 'valant' | 'draft' | 'overdue' | 'due' | 'current';
export const PLAN_STATE_LABEL: Record<PlanState, string> = {
  missing: 'Missing',
  valant: 'Valant imported (rewrite)',
  draft: 'Draft (unsigned)',
  overdue: 'Review overdue',
  due: 'Review due in 30 days',
  current: 'Current',
};

/**
 * State of a client's current plan. Precedence: missing > Valant imported > draft (unsigned) >
 * overdue (status Needs review or review date passed) > due within 30 days > current.
 */
export function classifyPlan(
  plan: { status: string; reviewDueAt: Date | null; clinicianSignedAt: Date | null; imported: boolean } | null,
  now: Date
): PlanState {
  if (!plan) return 'missing';
  if (plan.imported) return 'valant';
  if (plan.status === 'DRAFT' || !plan.clinicianSignedAt) return 'draft';
  if (plan.status === 'NEEDS_REVIEW' || (plan.reviewDueAt && plan.reviewDueAt.getTime() < now.getTime())) return 'overdue';
  if (plan.reviewDueAt && plan.reviewDueAt.getTime() - now.getTime() <= 30 * DAY_MS) return 'due';
  return 'current';
}
