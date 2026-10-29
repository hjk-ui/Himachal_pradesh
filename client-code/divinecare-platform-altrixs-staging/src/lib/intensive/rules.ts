/**
 * Intensive program rules (pure, no Prisma): weekly hours against the program minimum,
 * missed-day follow-up, authorization units / renewal, treatment plan timeline, weekly team review
 * (PHP prescriber review), admission readiness, discharge / step-down, post-discharge follow-up
 * window, billing units and charge drafts, and outcome summaries with small-cell suppression.
 *
 * Dates are calendar days 'YYYY-MM-DD' (service dates are stored at 00:00 UTC).
 */
import { MIN_CELL } from '@/lib/insights/clinical/population';
import { authUnitsForLines } from '@/lib/billing/priorAuthMath';
import {
  CARE_LEVEL_LABEL,
  CONSENT_KEYS,
  DISCHARGE_REASONS,
  criteriaFor,
  isAttendedStatus,
  type BillingMode,
  type CareLevel,
  type DischargeReason,
  type ProgramType,
  type ScheduleTemplate,
  type ServiceCodes,
  type SessionType,
  type UnitRule,
} from './types';

// ─── Days ───────────────────────────────────────────────────────────────────

export function isoDay(d: Date | string): string {
  if (typeof d === 'string') return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}
export function dayDate(day: string): Date {
  return new Date(`${day.slice(0, 10)}T00:00:00.000Z`);
}
export function addDays(day: string, n: number): string {
  return isoDay(new Date(dayDate(day).getTime() + n * 86_400_000));
}
export function daysBetween(from: string, to: string): number {
  return Math.round((dayDate(to).getTime() - dayDate(from).getTime()) / 86_400_000);
}
/** 0 = Sunday */
export function weekdayOf(day: string): number {
  return dayDate(day).getUTCDay();
}
/** Monday of the day's week (program weeks run Monday-Sunday). */
export function weekStartOf(day: string): string {
  const wd = weekdayOf(day);
  return addDays(day, wd === 0 ? -6 : 1 - wd);
}
export function isValidDay(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(dayDate(v).getTime()) && isoDay(dayDate(v)) === v;
}

// ─── Attendance & weekly hours ──────────────────────────────────────────────

export type AttendanceLike = { serviceDate: string; status: string; minutes: number | null; scheduledMinutes?: number | null };

/** Minutes a row counts toward hours: attended rows only; recorded minutes, else the scheduled block. */
export function attendedMinutes(r: Pick<AttendanceLike, 'status' | 'minutes' | 'scheduledMinutes'>): number {
  if (!isAttendedStatus(r.status)) return 0;
  const m = r.minutes ?? r.scheduledMinutes ?? 0;
  return Math.max(0, Math.round(m));
}

export function weeklyHours(rows: AttendanceLike[], weekStart: string): { minutes: number; hours: number; daysAttended: number } {
  const end = addDays(weekStart, 7);
  const inWeek = rows.filter((r) => r.serviceDate >= weekStart && r.serviceDate < end);
  const minutes = inWeek.reduce((s, r) => s + attendedMinutes(r), 0);
  const days = new Set(inWeek.filter((r) => isAttendedStatus(r.status)).map((r) => r.serviceDate));
  return { minutes, hours: Math.round((minutes / 60) * 10) / 10, daysAttended: days.size };
}

/** Program days (by the schedule template) in the week starting `weekStart`. */
export function programDaysInWeek(schedule: Pick<ScheduleTemplate, 'days'>, weekStart: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(weekStart, i);
    if (schedule.days.includes(weekdayOf(d))) out.push(d);
  }
  return out;
}

export type WeekStatus = 'met' | 'under' | 'on_track' | 'at_risk' | 'not_applicable';

export type WeekComplianceInput = {
  weekStart: string;
  today: string;
  minWeeklyHours: number;
  schedule: ScheduleTemplate;
  admissionDate: string | null;
  dischargeDate: string | null;
  attendedMinutes: number;
};

export type WeekCompliance = {
  weekStart: string;
  hours: number;
  /** Prorated minimum for the days the client was in the program this week */
  requiredHours: number;
  programDays: number;
  eligibleDays: number;
  complete: boolean;
  status: WeekStatus;
};

/**
 * Hours against the minimum. A partial week (admitted or discharged mid-week) is prorated by the
 * program days the client was enrolled. A week in progress is 'on_track' when the remaining
 * scheduled sessions can still reach the minimum, else 'at_risk'; a finished week is 'met' / 'under'.
 */
export function weekCompliance(i: WeekComplianceInput): WeekCompliance {
  const days = programDaysInWeek(i.schedule, i.weekStart);
  const eligible = days.filter((d) => (!i.admissionDate || d >= i.admissionDate) && (!i.dischargeDate || d <= i.dischargeDate));
  const hours = Math.round((i.attendedMinutes / 60) * 10) / 10;
  const weekEnd = addDays(i.weekStart, 6);
  const complete = i.today > weekEnd || Boolean(i.dischargeDate && i.dischargeDate <= weekEnd && i.today > i.dischargeDate);
  if (!days.length || !eligible.length) {
    return { weekStart: i.weekStart, hours, requiredHours: 0, programDays: days.length, eligibleDays: 0, complete, status: 'not_applicable' };
  }
  const requiredHours = Math.round(((i.minWeeklyHours * eligible.length) / days.length) * 10) / 10;
  let status: WeekStatus;
  if (hours >= requiredHours) status = 'met';
  else if (complete) status = 'under';
  else {
    const perDay = i.schedule.blocks.reduce((s, b) => s + b.minutes, 0);
    const remainingDays = eligible.filter((d) => d >= i.today).length;
    status = hours + (remainingDays * perDay) / 60 >= requiredHours ? 'on_track' : 'at_risk';
  }
  return { weekStart: i.weekStart, hours, requiredHours, programDays: days.length, eligibleDays: eligible.length, complete, status };
}

/** A whole program day missed: rows recorded, none attended, at least one plain absence (excused only = no outreach). */
export function missedDayNeedsFollowUp(statuses: string[]): boolean {
  if (!statuses.length) return false;
  if (statuses.some((s) => isAttendedStatus(s))) return false;
  return statuses.includes('absent');
}

/** Outreach due: end of the missed day plus the practice's outreach hours. */
export function followUpDueAt(serviceDate: string, hours: number): Date {
  return new Date(dayDate(serviceDate).getTime() + 86_400_000 - 1000 + Math.max(0, hours) * 3_600_000);
}

// ─── Authorization ──────────────────────────────────────────────────────────

export type AuthInput = {
  unitsApproved: number;
  /** Units the claim side already counted (PriorAuth.unitsUsed) */
  unitsUsedClaims: number;
  cptCodes: string[];
  startDate: string | null;
  endDate: string | null;
};

export type AuthStatus = {
  approved: number;
  used: number;
  remaining: number;
  daysLeft: number | null;
  expired: boolean;
  exhausted: boolean;
  renewalDue: boolean;
  reasons: string[];
};

/**
 * Units used = the larger of what claims counted and the (non-void) draft units for the codes the
 * auth covers (so a day is never counted twice). Renewal is due when the end date is within the
 * lead time, or the units left will not cover the next week of scheduled program days.
 */
export function authStatus(
  auth: AuthInput,
  drafts: Array<{ code: string; units: number; status: string }>,
  opts: { today: string; leadDays: number; unitsPerWeek: number },
): AuthStatus {
  const draftUnits = authUnitsForLines(
    auth.cptCodes,
    drafts.filter((d) => d.status !== 'void').map((d) => ({ cpt: d.code, units: d.units })),
  );
  const used = Math.max(auth.unitsUsedClaims || 0, draftUnits);
  const remaining = Math.max(0, auth.unitsApproved - used);
  const daysLeft = auth.endDate ? daysBetween(opts.today, auth.endDate) : null;
  const expired = daysLeft !== null && daysLeft < 0;
  const exhausted = auth.unitsApproved > 0 && remaining <= 0;
  const reasons: string[] = [];
  if (expired) reasons.push('Authorization end date has passed');
  else if (daysLeft !== null && daysLeft <= opts.leadDays) reasons.push(`Ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`);
  if (exhausted) reasons.push('No units left');
  else if (opts.unitsPerWeek > 0 && remaining < opts.unitsPerWeek) reasons.push(`${remaining} unit${remaining === 1 ? '' : 's'} left, under one week of program days`);
  return { approved: auth.unitsApproved, used, remaining, daysLeft, expired, exhausted, renewalDue: reasons.length > 0, reasons };
}

// ─── Treatment plan timeline ────────────────────────────────────────────────

export type PlanState = 'done' | 'due' | 'overdue' | 'not_applicable';

export function planTimeline(i: {
  admissionDate: string | null;
  today: string;
  initialPlanDays: number;
  planReviewDays: number;
  /** Plan signed for this episode (signed / created on or after admission) */
  plan: { signedOn: string | null } | null;
}): { initialDue: string | null; initialState: PlanState; nextReviewDue: string | null; reviewState: PlanState } {
  if (!i.admissionDate) return { initialDue: null, initialState: 'not_applicable', nextReviewDue: null, reviewState: 'not_applicable' };
  const initialDue = addDays(i.admissionDate, i.initialPlanDays);
  const signed = i.plan?.signedOn ?? null;
  if (!signed) {
    return { initialDue, initialState: i.today > initialDue ? 'overdue' : 'due', nextReviewDue: null, reviewState: 'not_applicable' };
  }
  const nextReviewDue = addDays(signed, i.planReviewDays);
  const reviewState: PlanState = i.today > nextReviewDue ? 'overdue' : daysBetween(i.today, nextReviewDue) <= 3 ? 'due' : 'done';
  return { initialDue, initialState: 'done', nextReviewDue, reviewState };
}

// ─── Weekly team review ─────────────────────────────────────────────────────

export function weeklyReviewStatus(i: {
  programType: ProgramType;
  review: { prescriberReviewedAt: Date | string | null } | null;
}): { teamDone: boolean; prescriberRequired: boolean; prescriberDone: boolean; missing: string[] } {
  const prescriberRequired = i.programType === 'PHP';
  const teamDone = Boolean(i.review);
  const prescriberDone = Boolean(i.review?.prescriberReviewedAt);
  const missing: string[] = [];
  if (!teamDone) missing.push('Weekly team review');
  if (prescriberRequired && !prescriberDone) missing.push('Psychiatrist / NP weekly review (PHP)');
  return { teamDone, prescriberRequired, prescriberDone, missing };
}

/** Who may sign the prescriber part of a weekly review. */
export function canSignPrescriberReview(role: string | null | undefined): boolean {
  const r = String(role ?? '').toUpperCase();
  return r === 'PSYCHIATRIST' || r === 'NP';
}

// ─── Admission readiness ────────────────────────────────────────────────────

export type AdmissionInput = {
  programType: ProgramType;
  part2: boolean;
  clientAgeYears: number | null;
  criteria: Record<string, boolean>;
  criteriaOverride: string | null;
  levelOfCare: { locusRecordId: string | null; asamComplete: boolean };
  consentsOnFile: Set<string>;
  hasAuthorization: boolean;
  psychEvalDate: string | null;
  admissionDate: string | null;
  primaryClinicianId: string | null;
  prescriberId: string | null;
  caseManagerId: string | null;
  usesGroups: boolean;
};

export type ReadinessItem = { key: string; label: string; ok: boolean; blocking: boolean };

/** Admission checklist: blocking items must be done to admit; the rest are warnings. */
export function admissionReadiness(i: AdmissionInput): { items: ReadinessItem[]; canAdmit: boolean; blockers: string[] } {
  const items: ReadinessItem[] = [];
  const crit = criteriaFor(i.programType);
  const critMet = crit.every((c) => i.criteria[c.key] === true);
  items.push({
    key: 'criteria',
    label: critMet ? 'Admission criteria met' : i.criteriaOverride ? 'Admission criteria: clinical override documented' : 'Admission criteria checklist incomplete',
    ok: critMet || Boolean(i.criteriaOverride?.trim()),
    blocking: true,
  });
  const sud = i.programType === 'SUD_IOP' || i.part2;
  const locOk = sud ? i.levelOfCare.asamComplete || Boolean(i.levelOfCare.locusRecordId) : Boolean(i.levelOfCare.locusRecordId) || i.levelOfCare.asamComplete;
  items.push({ key: 'level_of_care', label: sud ? 'ASAM dimensions rated (or LOCUS on file)' : 'LOCUS / CALOCUS on file (or ASAM rated)', ok: locOk, blocking: true });
  items.push({ key: 'consent_treatment', label: 'Consent to treatment signed', ok: i.consentsOnFile.has(CONSENT_KEYS.treatment), blocking: true });
  if (sud) items.push({ key: 'consent_part2', label: '42 CFR Part 2 consent signed', ok: i.consentsOnFile.has(CONSENT_KEYS.part2), blocking: true });
  if (i.clientAgeYears !== null && i.clientAgeYears < 18) {
    items.push({ key: 'consent_minor', label: 'Minor consent to treatment signed', ok: i.consentsOnFile.has(CONSENT_KEYS.minor), blocking: true });
  }
  if (i.usesGroups) items.push({ key: 'consent_group', label: 'Group confidentiality agreement signed', ok: i.consentsOnFile.has(CONSENT_KEYS.group), blocking: false });
  if (i.programType === 'PHP') {
    items.push({ key: 'psych_eval', label: 'Psychiatric evaluation documented (required for PHP)', ok: Boolean(i.psychEvalDate), blocking: true });
    items.push({ key: 'prescriber', label: 'Psychiatrist / NP assigned (required for PHP)', ok: Boolean(i.prescriberId), blocking: true });
  } else {
    items.push({ key: 'prescriber', label: 'Psychiatrist / NP assigned', ok: Boolean(i.prescriberId), blocking: false });
  }
  items.push({ key: 'authorization', label: 'Authorization recorded (Carelon / payer)', ok: i.hasAuthorization, blocking: false });
  items.push({ key: 'admission_date', label: 'Admission date set', ok: Boolean(i.admissionDate), blocking: true });
  items.push({ key: 'primary_clinician', label: 'Primary clinician assigned', ok: Boolean(i.primaryClinicianId), blocking: true });
  items.push({ key: 'case_manager', label: 'Case manager assigned', ok: Boolean(i.caseManagerId), blocking: false });
  const blockers = items.filter((x) => x.blocking && !x.ok).map((x) => x.label);
  return { items, canAdmit: blockers.length === 0, blockers };
}

// ─── Discharge / step-down ──────────────────────────────────────────────────

/** Levels offered at discharge from each program type (step-down first). */
export function stepDownOptions(type: ProgramType): CareLevel[] {
  if (type === 'PHP') return ['IOP', 'OP', 'inpatient', 'residential', 'other_provider', 'none'];
  return ['OP', 'PHP', 'residential', 'inpatient', 'other_provider', 'none'];
}

const RANK: Record<string, number> = { none: 0, OP: 1, IOP: 2, PHP: 3, residential: 4, inpatient: 5 };

/** Is moving from this program to `to` a step down (lower intensity)? */
export function isStepDown(type: ProgramType, to: CareLevel): boolean {
  const from = type === 'PHP' ? RANK.PHP : RANK.IOP;
  return to in RANK && to !== 'none' && RANK[to] < from;
}
export function isStepUp(type: ProgramType, to: CareLevel): boolean {
  const from = type === 'PHP' ? RANK.PHP : RANK.IOP;
  return to in RANK && RANK[to] > from;
}

export type DischargeInput = {
  dischargeDate: string | null;
  admissionDate: string | null;
  reason: string | null;
  stepDownLevel: string | null;
  aftercarePlan: string | null;
  today: string;
};

/** Problems that block saving a discharge. */
export function dischargeProblems(type: ProgramType, i: DischargeInput): string[] {
  const out: string[] = [];
  if (!i.dischargeDate) out.push('Discharge date is required');
  else {
    if (i.admissionDate && i.dischargeDate < i.admissionDate) out.push('Discharge date is before the admission date');
    if (i.dischargeDate > i.today) out.push('Discharge date cannot be in the future');
  }
  if (!i.reason || !(DISCHARGE_REASONS as readonly string[]).includes(i.reason)) out.push('Choose a discharge reason');
  const level = i.stepDownLevel as CareLevel | null;
  const options = stepDownOptions(type);
  if (!level || !options.includes(level)) out.push(`Choose the next level of care (${options.map((o) => CARE_LEVEL_LABEL[o]).join(', ')})`);
  else {
    const reason = i.reason as DischargeReason;
    if (reason === 'step_down' && !isStepDown(type, level)) out.push(`"Stepped down" needs a lower level of care than ${type === 'PHP' ? 'PHP' : 'IOP'}`);
    if (reason === 'step_up' && !isStepUp(type, level)) out.push(`"Needs a higher level of care" needs a higher level than ${type === 'PHP' ? 'PHP' : 'IOP'}`);
    if (reason === 'transferred' && level !== 'other_provider' && !isStepDown(type, level) && !isStepUp(type, level)) {
      out.push('A transfer names where the client goes');
    }
  }
  if (!i.aftercarePlan?.trim()) out.push('Aftercare plan is required (services, appointments, crisis resources including 988)');
  return out;
}

/** Is a 7-day (setting) follow-up expected after this discharge? Not when the client goes to inpatient / residential / none. */
export function followUpExpected(stepDownLevel: string | null | undefined): boolean {
  return !['inpatient', 'residential', 'none'].includes(String(stepDownLevel ?? ''));
}

export type FollowUpState = 'met' | 'scheduled' | 'outside_window' | 'open' | 'missed' | 'not_expected';

/**
 * Post-discharge follow-up (HEDIS FUH-style): a follow-up visit within `windowDays` after the
 * discharge date (the discharge day itself does not count, as in FUH). 'met' = the visit date is
 * in the window and has passed; 'scheduled' = booked in the window, not yet happened.
 */
export function followUpStatus(i: { dischargeDate: string; followUpDate: string | null; windowDays: number; today: string; expected: boolean }): {
  state: FollowUpState;
  windowEnd: string;
} {
  const windowEnd = addDays(i.dischargeDate, i.windowDays);
  if (!i.expected) return { state: 'not_expected', windowEnd };
  if (i.followUpDate) {
    if (i.followUpDate <= i.dischargeDate || i.followUpDate > windowEnd) return { state: 'outside_window', windowEnd };
    return { state: i.followUpDate <= i.today ? 'met' : 'scheduled', windowEnd };
  }
  return { state: i.today > windowEnd ? 'missed' : 'open', windowEnd };
}

// ─── Billing units and charge drafts ────────────────────────────────────────

/** Units for minutes under a rule. 0 = not billable (below the minimum or under one unit). */
export function unitsFor(rule: UnitRule, minutes: number): number {
  const m = Math.max(0, Math.round(minutes));
  if (rule.minMinutes !== null && m < rule.minMinutes) return 0;
  switch (rule.unit) {
    case 'per_diem':
    case 'per_session':
      return m > 0 ? 1 : 0;
    case 'per_15_min':
      return rule.rounding === 'whole' ? Math.floor(m / 15) : Math.floor(m / 15) + (m % 15 >= 8 ? 1 : 0);
    case 'per_hour':
      return rule.rounding === 'whole' ? Math.floor(m / 60) : Math.floor(m / 60) + (m % 60 >= 30 ? 1 : 0);
    default:
      return 0;
  }
}

export type DraftAttendance = {
  id: string;
  sessionType: SessionType;
  status: string;
  minutes: number | null;
  scheduledMinutes: number | null;
  progressNoteId: string | null;
  /** The linked group session bills its own per-session line through the note claim builder */
  billedByGroupNote: boolean;
};

export type DraftContext = {
  programType: ProgramType;
  billingMode: BillingMode;
  perDiemCode: string;
  serviceCodes: ServiceCodes;
  unitRules: UnitRule[];
  policyConfirmed: boolean;
  serviceDate: string;
  admissionDate: string | null;
  dischargeDate: string | null;
  psychEvalDate: string | null;
  auth: { id: string; startDate: string | null; endDate: string | null; remaining: number; approved: number } | null;
};

export type DraftLine = { code: string; units: number; minutes: number; sourceKey: string; status: 'draft' | 'held'; holdReasons: string[] };
export type DraftSkip = { sourceKey: string; reason: string };

/**
 * Charge drafts for one client-day. Nothing is drafted outside the admission (admission date to
 * discharge date). A draft is 'held' (with reasons) when it cannot go to billing as is; billing
 * clears holds by fixing the cause and regenerating. Per-service lines for group sessions that bill
 * through the group note (per-session groups) are skipped so a session is never billed twice.
 */
export function draftsForDay(ctx: DraftContext, rows: DraftAttendance[]): { lines: DraftLine[]; skipped: DraftSkip[] } {
  const lines: DraftLine[] = [];
  const skipped: DraftSkip[] = [];
  const d = ctx.serviceDate;
  if (!ctx.admissionDate || d < ctx.admissionDate || (ctx.dischargeDate && d > ctx.dischargeDate)) {
    return { lines, skipped: [{ sourceKey: 'day', reason: 'Not within the admission' }] };
  }
  const common: string[] = [];
  if (!ctx.policyConfirmed) common.push('policy_unconfirmed');
  if (ctx.programType === 'PHP' && !ctx.psychEvalDate) common.push('php_psych_eval_missing');
  if (!ctx.auth) common.push('no_auth');
  else {
    if ((ctx.auth.startDate && d < ctx.auth.startDate) || (ctx.auth.endDate && d > ctx.auth.endDate)) common.push('auth_out_of_dates');
    if (ctx.auth.approved > 0 && ctx.auth.remaining <= 0) common.push('auth_exhausted');
  }
  const ruleFor = (code: string): UnitRule => ctx.unitRules.find((r) => r.code === code) ?? { code, unit: 'per_session', minMinutes: null, rounding: 'midpoint' };

  if (ctx.billingMode === 'per_diem') {
    const minutes = rows.reduce((s, r) => s + attendedMinutes(r), 0);
    if (minutes <= 0) return { lines, skipped: [{ sourceKey: 'per_diem', reason: 'No attended minutes' }] };
    const rule = ruleFor(ctx.perDiemCode);
    const holds = [...common];
    if (rule.unit === 'per_diem' && rule.minMinutes === null) holds.push('per_diem_minimum_not_set');
    const units = rule.minMinutes === null ? (rule.unit === 'per_diem' ? 1 : unitsFor(rule, minutes)) : unitsFor(rule, minutes);
    if (units <= 0) return { lines, skipped: [{ sourceKey: 'per_diem', reason: `Below the ${rule.minMinutes}-minute minimum for ${rule.code}` }] };
    lines.push({ code: ctx.perDiemCode, units, minutes, sourceKey: 'per_diem', status: holds.length ? 'held' : 'draft', holdReasons: holds });
    return { lines, skipped };
  }

  for (const r of rows) {
    const minutes = attendedMinutes(r);
    if (minutes <= 0) continue;
    if (r.billedByGroupNote) {
      skipped.push({ sourceKey: r.id, reason: 'Billed from the group session note (per-session group)' });
      continue;
    }
    const code = ctx.serviceCodes[r.sessionType];
    const holds = [...common];
    if (!code) {
      lines.push({ code: 'UNSET', units: 0, minutes, sourceKey: r.id, status: 'held', holdReasons: [...holds, 'code_not_set'] });
      continue;
    }
    const rule = ruleFor(code);
    const units = unitsFor(rule, minutes);
    if (units <= 0) {
      skipped.push({ sourceKey: r.id, reason: rule.minMinutes ? `Below the ${rule.minMinutes}-minute minimum for ${code}` : 'Under one unit' });
      continue;
    }
    if (!r.progressNoteId) holds.push('note_missing');
    lines.push({ code, units, minutes, sourceKey: r.id, status: holds.length ? 'held' : 'draft', holdReasons: holds });
  }
  return { lines, skipped };
}

/** Per diem units a program week uses (for the auth renewal check). */
export function unitsPerWeek(mode: BillingMode, schedule: ScheduleTemplate): number {
  return mode === 'per_diem' ? schedule.days.length : schedule.days.length * schedule.blocks.length;
}

// ─── Outcomes ───────────────────────────────────────────────────────────────

export type OutcomePair = { clientId: string; first: number; latest: number };

export type OutcomeSummary = {
  n: number;
  suppressed: boolean;
  meanFirst: number | null;
  meanLatest: number | null;
  /** % of clients whose latest score is lower than their first */
  improvedPct: number | null;
};

/** Paired first / latest scores; suppressed (no numbers) when fewer than MIN_CELL clients. */
export function outcomeSummary(pairs: OutcomePair[]): OutcomeSummary {
  const n = pairs.length;
  if (n < MIN_CELL) return { n, suppressed: true, meanFirst: null, meanLatest: null, improvedPct: null };
  const mean = (xs: number[]) => Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10;
  return {
    n,
    suppressed: false,
    meanFirst: mean(pairs.map((p) => p.first)),
    meanLatest: mean(pairs.map((p) => p.latest)),
    improvedPct: Math.round((pairs.filter((p) => p.latest < p.first).length / n) * 1000) / 10,
  };
}

/** Pair each client's first score on/after (admission - lookbackDays) with their latest later score. */
export function pairScores(
  scores: Array<{ clientId: string; score: number; at: string }>,
  admissions: Map<string, string>,
  lookbackDays = 14,
): OutcomePair[] {
  const byClient = new Map<string, Array<{ score: number; at: string }>>();
  for (const s of scores) {
    const adm = admissions.get(s.clientId);
    if (!adm || s.at < addDays(adm, -lookbackDays)) continue;
    const list = byClient.get(s.clientId) ?? [];
    list.push({ score: s.score, at: s.at });
    byClient.set(s.clientId, list);
  }
  const out: OutcomePair[] = [];
  for (const [clientId, list] of byClient) {
    if (list.length < 2) continue;
    list.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    out.push({ clientId, first: list[0].score, latest: list[list.length - 1].score });
  }
  return out;
}

/** Rate with small-cell suppression (same MIN_CELL as population health). */
export function suppressedRate(num: number, den: number): { num: number | null; den: number; pct: number | null; suppressed: boolean } {
  if (den < MIN_CELL) return { num: null, den, pct: null, suppressed: true };
  return { num, den, pct: den ? Math.round((num / den) * 1000) / 10 : null, suppressed: false };
}
