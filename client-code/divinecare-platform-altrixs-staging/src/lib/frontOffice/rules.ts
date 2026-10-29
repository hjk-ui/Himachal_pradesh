/**
 * Front-office readiness rules (pure: no database, unit tested in tests/front-office.test.ts).
 *
 * Benchmarks: athenaOne check-in workflow (confirm, eligibility, demographics / insurance card,
 * forms, copay, check-in; check-out books the next visit and settles the balance; end-of-day
 * reconciliation), Valant front desk (consents, intake, copay), Tebra / AdvancedMD front office
 * (eligibility before every visit, authorization tracking, no-show outreach).
 *
 * Every status comes from data passed in, or from a staff mark. Nothing is guessed: when data is
 * missing the item says so and asks for action; it never reports "done" without evidence.
 */
import { claimReadiness, describeGaps, drfirstReadiness, normalizeUsPhone, type DemographicsInput } from '@/lib/clients/demographics';
import { isSelfPayPayer } from '@/lib/billing/patientLedgerMath';
import type {
  FoAction,
  FoApptStatus,
  FoDaySummary,
  FoItem,
  FoItemId,
  FoLevel,
  FoMark,
  FoPhase,
  FoReadiness,
  FoReconciliation,
  FoRow,
  FoStatus,
} from './types';

// ─── Settings (owner decisions; see the report) ──────────────────────────────

/**
 * Eligibility counts as current when the last successful check is at most this many days before the
 * visit. Industry practice: verify before every visit, and at least every 30 days for recurring
 * patients (athenaOne re-checks automatically 1-3 days before a visit).
 */
export const ELIGIBILITY_WINDOW_DAYS = 30;
/** Maryland Medicaid eligibility is month to month: the check must be in the visit's calendar month. */
export const MEDICAID_SAME_MONTH = true;
/** Authorization units at or below this are flagged (done, with a warning) */
export const AUTH_LOW_UNITS = 2;
/** A checked-in visit still open this long after its end time needs closing */
export const CLOSE_GRACE_MINUTES = 15;

export const FO_VISIT_KIND = 'front_office';
export const FO_STEP_PREFIX = 'fo_';
export const stepIdFor = (id: FoItemId) => `${FO_STEP_PREFIX}${id}`;
export function itemIdFromStep(stepId: string): FoItemId | null {
  if (!stepId.startsWith(FO_STEP_PREFIX)) return null;
  const id = stepId.slice(FO_STEP_PREFIX.length) as FoItemId;
  return FO_ITEM_IDS.includes(id) ? id : null;
}

export const FO_ITEM_IDS: readonly FoItemId[] = [
  'confirm', 'eligibility', 'authorization', 'demographics', 'consents', 'intake', 'carelon', 'balance',
  'telehealth', 'portal', 'no_show_call', 'identity', 'id_card', 'copay', 'check_in', 'next_appt',
  'documents', 'visit_closed', 'reschedule', 'outreach',
];

/** Items staff may mark (done / N/A with a reason). Data-proven items can still be overridden with a reason. */
const MARKABLE: ReadonlySet<FoItemId> = new Set<FoItemId>([
  'confirm', 'authorization', 'intake', 'portal', 'no_show_call', 'id_card', 'copay', 'next_appt', 'documents',
  'outreach', 'telehealth', 'balance', 'eligibility', 'demographics',
]);
/** Items whose "done" mark needs a note (what was done) */
const NOTE_REQUIRED: ReadonlySet<FoItemId> = new Set<FoItemId>(['outreach', 'eligibility', 'demographics', 'authorization', 'copay']);

/** Validation for a staff mark: a reason is required for N/A / deferred, and for "done" on items that need a note. */
export function markProblem(id: FoItemId, status: 'done' | 'not_applicable' | 'deferred', reason: string | null | undefined): string | null {
  if (!MARKABLE.has(id)) return 'This item is computed from the record and cannot be marked';
  const r = (reason ?? '').trim();
  if (status !== 'done' && r.length < 3) return 'A reason is required for not applicable or deferred';
  if (status === 'done' && NOTE_REQUIRED.has(id) && r.length < 3) return 'Add a short note on what was done';
  return null;
}

export const FO_LABELS: Record<FoItemId, string> = {
  confirm: 'Appointment confirmed',
  eligibility: 'Eligibility verified',
  authorization: 'Authorization on file',
  demographics: 'Demographics complete',
  consents: 'Consents signed',
  intake: 'Intake packet completed',
  carelon: 'Carelon attestation (Medicaid)',
  balance: 'Balance due',
  telehealth: 'Telehealth join link',
  portal: 'Portal account',
  no_show_call: 'Reminder call (high no-show risk)',
  identity: 'Identity verified (online booking)',
  id_card: 'Photo ID and insurance card checked',
  copay: 'Copay collected',
  check_in: 'Checked in',
  next_appt: 'Next appointment booked',
  documents: 'Visit documents given / sent',
  visit_closed: 'Visit closed (checked out)',
  reschedule: 'Rescheduled',
  outreach: 'Outreach logged',
};

// ─── Inputs ──────────────────────────────────────────────────────────────────

export type FoEligibilityFact = {
  status: 'PENDING' | 'ELIGIBLE' | 'INELIGIBLE' | 'ERROR';
  checkedAt: Date;
  payerName: string;
  awaitingResponse: boolean;
  priorAuthRequired: boolean;
  channel: string | null;
};

export type FoAuthFact = {
  payer: string;
  authNumber: string | null;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'DENIED' | 'EXPIRED';
  unitsApproved: number;
  unitsUsed: number;
  startDate: Date | null;
  endDate: Date | null;
};

export type FoFacts = {
  now: Date;
  /** practice calendar date of the visit and today (YYYY-MM-DD) */
  visitDate: string;
  today: string;
  appointment: {
    id: string;
    clientId: string;
    startsAt: Date;
    endsAt: Date;
    status: FoApptStatus;
    isVirtual: boolean;
    confirmedAt: Date | null;
    payer: string | null;
    isNewClient: boolean;
    hasJoinLink: boolean;
    /** program visit that Maryland Medicaid (Carelon) authorizes, e.g. PRP */
    authorizedProgram: boolean;
  };
  client: DemographicsInput & {
    identityVerifyRequired: boolean;
    smsConsent: boolean;
    smsOptedOut: boolean;
    hasEmail: boolean;
    medicaid: boolean;
  };
  /** latest eligibility checks for the client, newest first (undefined = role cannot see) */
  eligibility?: FoEligibilityFact[];
  auths?: FoAuthFact[];
  /** consents needed before the visit (undefined = role cannot see) */
  consents?: { needed: number; expiring: number; titles: string[] } | null;
  /** latest intake invite / intake packet */
  intake?: { status: 'none' | 'pending' | 'completed' | 'expired'; sentAt: Date | null; completedAt: Date | null };
  carelonNeeded?: boolean;
  /** expected copay (cents) and where it came from; null = no rule */
  copay?: { expectedCents: number | null; source: string | null; note: string | null };
  /** posted patient payments for the client on the visit date (cents, count) */
  collected?: { cents: number; count: number };
  balanceCents?: number | null;
  portal?: 'active' | 'invited' | 'none';
  noShow?: { level: 'low' | 'medium' | 'high'; score: number; reasons: string[] } | null;
  /** next kept visit after this one */
  nextAppointmentAt?: Date | null;
  /** clinician asked for a next visit (open Scribe follow-up) */
  followUpRequested?: boolean;
  /** protocol default follow-up interval for this visit kind (days), when known */
  followUpDays?: number | null;
  marks: Map<FoItemId, FoMark>;
  phone: string | null;
  settings?: { eligibilityWindowDays?: number; medicaidSameMonth?: boolean };
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const KEPT: ReadonlySet<FoApptStatus> = new Set(['CHECKED_IN', 'IN_SESSION', 'COMPLETED']);
const MISSED: ReadonlySet<FoApptStatus> = new Set(['NO_SHOW', 'LATE_CANCEL']);
const DEAD: ReadonlySet<FoApptStatus> = new Set(['CANCELLED', 'NO_SHOW', 'LATE_CANCEL']);

export const isKept = (s: FoApptStatus) => KEPT.has(s);
export const isMissed = (s: FoApptStatus) => MISSED.has(s);

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const norm = (s: string | null | undefined) => (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/** Payer names match when equal or one contains the other (e.g. "Aetna" / "Aetna Better Health") */
export function payerMatches(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

export function wholeDaysBetween(earlier: Date, later: Date): number {
  return Math.floor((later.getTime() - earlier.getTime()) / DAY_MS);
}

function item(
  id: FoItemId,
  phase: FoPhase,
  level: FoLevel,
  status: FoStatus,
  reason: string,
  extra: Partial<Pick<FoItem, 'warning' | 'stop' | 'action'>> = {}
): FoItem {
  return { id, phase, label: FO_LABELS[id], level, status, reason, markable: MARKABLE.has(id), noteRequired: NOTE_REQUIRED.has(id), ...extra };
}

/** A staff mark wins over a computed "needs action" (done / N/A with a reason); 'deferred' stays open. */
export function applyMark(it: FoItem, mark: FoMark | undefined): FoItem {
  if (!mark) return { ...it, mark: null };
  const who = mark.byName ? ` (${mark.byName})` : '';
  if (mark.status === 'deferred') {
    return { ...it, mark, reason: `${it.reason} · Deferred${who}: ${mark.reason ?? ''}`.trim() };
  }
  if (it.status === 'done' && mark.status === 'done') return { ...it, mark };
  const status: FoStatus = mark.status === 'done' ? 'done' : 'not_applicable';
  const prefix = mark.status === 'done' ? 'Marked done' : 'Not applicable';
  return { ...it, status, mark, warning: false, stop: false, reason: `${prefix}${who}${mark.reason ? `: ${mark.reason}` : ''}` };
}

// ─── Individual rules ───────────────────────────────────────────────────────

export function confirmItem(f: FoFacts): FoItem {
  const a = f.appointment;
  if (DEAD.has(a.status)) return item('confirm', 'prep', 'required', 'not_applicable', 'Visit is not going ahead');
  if (KEPT.has(a.status)) return item('confirm', 'prep', 'required', 'done', 'Client arrived');
  if (a.confirmedAt) return item('confirm', 'prep', 'required', 'done', `Confirmed ${ymd(a.confirmedAt)}`);
  const channels: string[] = [];
  channels.push(f.client.smsOptedOut ? 'SMS opted out' : f.client.smsConsent ? 'SMS reminders on' : 'no SMS consent');
  channels.push(f.client.hasEmail ? 'email on file' : 'no email');
  return item('confirm', 'prep', 'required', 'needs_action', `Not confirmed (${channels.join(', ')})`, {
    action: { kind: 'call', phone: f.phone },
  });
}

export type EligibilityVerdict =
  | { state: 'self_pay' }
  | { state: 'none' }
  | { state: 'current'; check: FoEligibilityFact; ageDays: number }
  | { state: 'stale'; check: FoEligibilityFact; ageDays: number; why: string }
  | { state: 'payer_mismatch'; check: FoEligibilityFact }
  | { state: 'inactive'; check: FoEligibilityFact }
  | { state: 'error'; check: FoEligibilityFact }
  | { state: 'awaiting'; check: FoEligibilityFact };

/**
 * Eligibility for a visit: the newest check for the visit's payer. Current = ELIGIBLE and checked at
 * most `windowDays` before the visit (and, for Medicaid, in the visit's calendar month).
 */
export function eligibilityVerdict(input: {
  payer: string | null;
  medicaid: boolean;
  visitAt: Date;
  checks: readonly FoEligibilityFact[];
  windowDays?: number;
  medicaidSameMonth?: boolean;
}): EligibilityVerdict {
  if (isSelfPayPayer(input.payer) && !input.medicaid) return { state: 'self_pay' };
  const windowDays = input.windowDays ?? ELIGIBILITY_WINDOW_DAYS;
  const sameMonth = input.medicaidSameMonth ?? MEDICAID_SAME_MONTH;
  const sorted = [...input.checks].sort((x, y) => y.checkedAt.getTime() - x.checkedAt.getTime());
  if (!sorted.length) return { state: 'none' };
  const forPayer = input.payer ? sorted.filter((c) => payerMatches(c.payerName, input.payer)) : sorted;
  if (!forPayer.length) return { state: 'payer_mismatch', check: sorted[0] };
  const latest = forPayer[0];
  if (latest.status === 'PENDING') {
    // An earlier answer can still be current while a new 270 is out
    const prior = forPayer.find((c) => c.status === 'ELIGIBLE');
    if (!prior) return { state: 'awaiting', check: latest };
    return eligibilityVerdict({ ...input, checks: forPayer.filter((c) => c !== latest) });
  }
  if (latest.status === 'INELIGIBLE') return { state: 'inactive', check: latest };
  if (latest.status === 'ERROR') {
    const prior = forPayer.find((c) => c.status === 'ELIGIBLE');
    if (!prior) return { state: 'error', check: latest };
    return eligibilityVerdict({ ...input, checks: forPayer.filter((c) => c !== latest) });
  }
  const ageDays = Math.max(0, wholeDaysBetween(latest.checkedAt, input.visitAt));
  if (latest.checkedAt.getTime() > input.visitAt.getTime() + DAY_MS) {
    // Checked after the visit (retro check): still proves coverage for the date of service
    return { state: 'current', check: latest, ageDays: 0 };
  }
  if (ageDays > windowDays) return { state: 'stale', check: latest, ageDays, why: `older than ${windowDays} days` };
  if (input.medicaid && sameMonth && latest.checkedAt.toISOString().slice(0, 7) !== input.visitAt.toISOString().slice(0, 7)) {
    return { state: 'stale', check: latest, ageDays, why: 'Medicaid eligibility is monthly: check again for the visit month' };
  }
  return { state: 'current', check: latest, ageDays };
}

export function eligibilityItem(f: FoFacts): FoItem | null {
  if (!f.eligibility) return null;
  const a = f.appointment;
  if (DEAD.has(a.status)) return item('eligibility', 'prep', 'required', 'not_applicable', 'Visit is not going ahead');
  const v = eligibilityVerdict({
    payer: a.payer,
    medicaid: f.client.medicaid,
    visitAt: a.startsAt,
    checks: f.eligibility,
    windowDays: f.settings?.eligibilityWindowDays,
    medicaidSameMonth: f.settings?.medicaidSameMonth,
  });
  const run: FoAction = { kind: 'run_eligibility' };
  const via = (c: FoEligibilityFact) => (c.channel ? ` (${c.channel === 'waystar' ? 'Waystar' : c.channel === 'availity' ? 'Availity' : c.channel})` : '');
  switch (v.state) {
    case 'self_pay':
      return item('eligibility', 'prep', 'required', 'not_applicable', 'Self-pay: no insurance on the visit');
    case 'none':
      return item('eligibility', 'prep', 'required', 'needs_action', `Never verified for ${a.payer || 'this payer'}`, { action: run });
    case 'payer_mismatch':
      return item('eligibility', 'prep', 'required', 'needs_action', `Last check was for ${v.check.payerName}; visit payer is ${a.payer}`, { action: run });
    case 'awaiting':
      return item('eligibility', 'prep', 'required', 'needs_action', `Sent ${ymd(v.check.checkedAt)}${via(v.check)}: awaiting the payer response (271)`, { action: run });
    case 'error':
      return item('eligibility', 'prep', 'required', 'needs_action', `Last check failed ${ymd(v.check.checkedAt)}${via(v.check)}: run again or call the payer`, { action: run });
    case 'inactive':
      return item('eligibility', 'prep', 'required', 'needs_action', `Payer returned inactive coverage ${ymd(v.check.checkedAt)}${via(v.check)}: update insurance or self-pay`, { action: run, stop: true });
    case 'stale':
      return item('eligibility', 'prep', 'required', 'needs_action', `Last verified ${ymd(v.check.checkedAt)} (${v.ageDays} days before the visit; ${v.why})`, { action: run });
    case 'current':
      return item('eligibility', 'prep', 'required', 'done', `Verified ${ymd(v.check.checkedAt)}${via(v.check)}: active`);
  }
}

export type AuthVerdict =
  | { needed: false; why: string }
  | { needed: true; why: string; auth: FoAuthFact | null; remaining: number | null; problem: string | null; low: boolean };

/**
 * Authorization need: the payer's 271 said prior auth is required, the visit is a program service
 * Maryland Medicaid authorizes (PRP through Carelon), or the client already has an authorization on
 * file for this payer (so units are being tracked). Otherwise not applicable.
 */
export function authorizationVerdict(input: {
  payer: string | null;
  visitAt: Date;
  medicaid: boolean;
  authorizedProgram: boolean;
  priorAuthRequired: boolean;
  auths: readonly FoAuthFact[];
}): AuthVerdict {
  const forPayer = input.auths.filter((x) => !input.payer || payerMatches(x.payer, input.payer));
  const reasons: string[] = [];
  if (input.priorAuthRequired) reasons.push('the payer response says prior authorization is required');
  if (input.authorizedProgram && input.medicaid) reasons.push('Medicaid program service (Carelon authorizes PRP)');
  if (!reasons.length && forPayer.some((x) => x.status === 'APPROVED' || x.status === 'SUBMITTED')) reasons.push('an authorization is on file for this payer');
  if (!reasons.length) return { needed: false, why: 'No authorization on file for this payer and none requested by the payer' };
  const t = input.visitAt.getTime();
  const covers = (x: FoAuthFact) => (!x.startDate || x.startDate.getTime() <= t + DAY_MS) && (!x.endDate || x.endDate.getTime() + DAY_MS > t);
  const approved = forPayer.filter((x) => x.status === 'APPROVED' && covers(x));
  const why = reasons.join('; ');
  if (approved.length) {
    const best = [...approved].sort((x, y) => (y.unitsApproved - y.unitsUsed) - (x.unitsApproved - x.unitsUsed))[0];
    const remaining = best.unitsApproved - best.unitsUsed;
    if (best.unitsApproved > 0 && remaining <= 0) return { needed: true, why, auth: best, remaining, problem: 'No units left on the authorization', low: false };
    return { needed: true, why, auth: best, remaining: best.unitsApproved > 0 ? remaining : null, problem: null, low: best.unitsApproved > 0 && remaining <= AUTH_LOW_UNITS };
  }
  const submitted = forPayer.find((x) => x.status === 'SUBMITTED');
  if (submitted) return { needed: true, why, auth: submitted, remaining: null, problem: 'Authorization submitted, not approved yet', low: false };
  const expired = forPayer.find((x) => x.status === 'EXPIRED' || (x.status === 'APPROVED' && !covers(x)));
  if (expired) return { needed: true, why, auth: expired, remaining: null, problem: `Authorization does not cover the visit date${expired.endDate ? ` (ended ${ymd(expired.endDate)})` : ''}`, low: false };
  return { needed: true, why, auth: null, remaining: null, problem: 'No approved authorization on file', low: false };
}

export function authorizationItem(f: FoFacts): FoItem | null {
  if (!f.auths) return null;
  const a = f.appointment;
  if (DEAD.has(a.status)) return item('authorization', 'prep', 'required', 'not_applicable', 'Visit is not going ahead');
  const latestForPayer = (f.eligibility ?? []).find((c) => !a.payer || payerMatches(c.payerName, a.payer));
  const v = authorizationVerdict({
    payer: a.payer,
    visitAt: a.startsAt,
    medicaid: f.client.medicaid,
    authorizedProgram: a.authorizedProgram,
    priorAuthRequired: Boolean(latestForPayer?.priorAuthRequired),
    auths: f.auths,
  });
  const action: FoAction = { kind: 'link', href: `/dashboard/billing/authorizations?clientId=${encodeURIComponent(a.clientId)}`, label: 'Authorizations' };
  if (!v.needed) return item('authorization', 'prep', 'required', 'not_applicable', v.why);
  if (v.problem) return item('authorization', 'prep', 'required', 'needs_action', `${v.problem} (needed: ${v.why})`, { action });
  const num = v.auth?.authNumber ? `#${v.auth.authNumber} ` : '';
  const units = v.remaining != null && v.auth ? `${v.remaining} of ${v.auth.unitsApproved} units left` : 'units not tracked';
  const through = v.auth?.endDate ? `, through ${ymd(v.auth.endDate)}` : '';
  return item('authorization', 'prep', 'required', 'done', `Auth ${num}${units}${through}${v.low ? ' (low: request renewal)' : ''}`, { warning: v.low, action: v.low ? action : undefined });
}

/** Front office completeness: claim fields (X12) for insured visits, e-prescribing fields + phone for self-pay. */
export function demographicsGaps(c: DemographicsInput, payer: string | null, medicaid: boolean, now: Date): string[] {
  const insured = medicaid || !isSelfPayPayer(payer);
  const r = insured ? claimReadiness({ ...c, insurancePayer: c.insurancePayer || payer }, now) : drfirstReadiness(c, now);
  const gaps = r.missing.filter((g) => g.severity === 'required');
  const labels = gaps.map((g) => g.label);
  if (!labels.some((l) => /^phone/i.test(l))) {
    if (!c.phone?.trim()) labels.push('Phone');
    else if (!normalizeUsPhone(c.phone)) labels.push('Phone is not a valid 10-digit US number');
  }
  return labels;
}

export function demographicsItem(f: FoFacts): FoItem {
  const a = f.appointment;
  const gaps = demographicsGaps(f.client, a.payer, f.client.medicaid, f.now);
  const action: FoAction = { kind: 'link', href: `/dashboard/clients/${encodeURIComponent(a.clientId)}`, label: 'Edit demographics' };
  if (!gaps.length) return item('demographics', 'prep', 'required', 'done', 'Name, DOB, sex, address, phone and insurance ID on file');
  const text = gaps.length <= 4 ? describeGaps(gaps.map((label) => ({ field: label, label, severity: 'required' }))) : `${gaps.slice(0, 3).join(', ')} and ${gaps.length - 3} more`;
  return item('demographics', 'prep', 'required', 'needs_action', `Missing: ${text}`, { action });
}

export function consentsItem(f: FoFacts): FoItem | null {
  if (f.consents === undefined) return null;
  const a = f.appointment;
  const action: FoAction = { kind: 'link', href: `/dashboard/ehr/consents/client/${encodeURIComponent(a.clientId)}`, label: 'Consents' };
  if (DEAD.has(a.status)) return item('consents', 'prep', 'required', 'not_applicable', 'Visit is not going ahead');
  const d = f.consents;
  if (d && d.needed > 0) {
    const titles = d.titles.length ? `: ${d.titles.slice(0, 3).join('; ')}${d.needed > 3 ? '…' : ''}` : '';
    return item('consents', 'prep', 'required', 'needs_action', `${d.needed} needed before the visit${titles}`, { action, stop: true });
  }
  if (d && d.expiring > 0) return item('consents', 'prep', 'required', 'done', `${d.expiring} expiring within 30 days: send renewal`, { warning: true, action });
  return item('consents', 'prep', 'required', 'done', 'Required consents on file');
}

export function intakeItem(f: FoFacts): FoItem | null {
  const a = f.appointment;
  if (!a.isNewClient) return item('intake', 'prep', 'required', 'not_applicable', 'Established client');
  if (!f.intake) return null;
  const action: FoAction = { kind: 'link', href: '/dashboard/clients/intake', label: 'Intake' };
  const i = f.intake;
  if (i.status === 'completed') return item('intake', 'prep', 'required', 'done', `Completed${i.completedAt ? ` ${ymd(i.completedAt)}` : ''}`);
  if (DEAD.has(a.status)) return item('intake', 'prep', 'required', 'not_applicable', 'Visit is not going ahead');
  if (i.status === 'pending') return item('intake', 'prep', 'required', 'needs_action', `Sent${i.sentAt ? ` ${ymd(i.sentAt)}` : ''}, not completed: remind or complete at check-in`, { action });
  if (i.status === 'expired') return item('intake', 'prep', 'required', 'needs_action', 'Intake link expired: resend', { action });
  return item('intake', 'prep', 'required', 'needs_action', 'New client: no intake packet sent', { action });
}

export function carelonItem(f: FoFacts): FoItem | null {
  if (f.carelonNeeded === undefined) return null;
  const a = f.appointment;
  if (!f.client.medicaid && !f.carelonNeeded) return item('carelon', 'prep', 'required', 'not_applicable', 'Not Maryland Medicaid');
  if (f.carelonNeeded) {
    if (DEAD.has(a.status)) return item('carelon', 'prep', 'required', 'not_applicable', 'Visit is not going ahead');
    return item('carelon', 'prep', 'required', 'needs_action', 'Maryland Medicaid: non-overlap attestation needed (complete at check-in)', {
      action: { kind: 'link', href: `/dashboard/ehr/consents/carelon/${encodeURIComponent(a.clientId)}`, label: 'Attestation' },
    });
  }
  return item('carelon', 'prep', 'required', 'done', 'Current attestation on file');
}

export function balanceItem(f: FoFacts, phase: 'prep' | 'check_out'): FoItem | null {
  if (f.balanceCents === undefined || f.balanceCents === null) return null;
  const a = f.appointment;
  const action: FoAction = { kind: 'link', href: `/dashboard/billing/payments?clientId=${encodeURIComponent(a.clientId)}`, label: 'Payments' };
  if (f.balanceCents > 0) return item('balance', phase, 'recommended', 'needs_action', `Patient balance ${money(f.balanceCents)}: collect or set up a payment plan`, { action });
  if (f.balanceCents < 0) return item('balance', phase, 'recommended', 'done', `Credit on account ${money(-f.balanceCents)}`);
  return item('balance', phase, 'recommended', 'done', 'No patient balance');
}

export function telehealthItem(f: FoFacts): FoItem {
  const a = f.appointment;
  if (!a.isVirtual) return item('telehealth', 'prep', 'required', 'not_applicable', 'In-person visit');
  if (DEAD.has(a.status)) return item('telehealth', 'prep', 'required', 'not_applicable', 'Visit is not going ahead');
  if (a.hasJoinLink) return item('telehealth', 'prep', 'required', 'done', 'Join link ready (sent with the confirmation)');
  return item('telehealth', 'prep', 'required', 'needs_action', 'No join link on the appointment: edit the visit to set the video room', {
    action: { kind: 'link', href: `/dashboard/appointments?appt=${encodeURIComponent(a.id)}`, label: 'Edit visit' },
  });
}

export function portalItem(f: FoFacts): FoItem | null {
  if (!f.portal) return null;
  const a = f.appointment;
  const level: FoLevel = a.isVirtual ? 'required' : 'optional';
  const action: FoAction = { kind: 'link', href: `/dashboard/clients/${encodeURIComponent(a.clientId)}`, label: 'Send portal invite' };
  if (f.portal === 'active') return item('portal', 'prep', level, 'done', 'Portal account active');
  if (!a.isVirtual) return item('portal', 'prep', 'optional', 'info', f.portal === 'invited' ? 'Portal invite not accepted yet' : 'No portal account');
  if (DEAD.has(a.status)) return item('portal', 'prep', level, 'not_applicable', 'Visit is not going ahead');
  return item('portal', 'prep', 'recommended', 'needs_action', f.portal === 'invited' ? 'Portal invite not accepted: resend before the video visit' : 'No portal account: send an invite for the video visit', { action });
}

export function noShowCallItem(f: FoFacts): FoItem | null {
  const a = f.appointment;
  if (a.status !== 'SCHEDULED' || !f.noShow) return null;
  if (f.noShow.level !== 'high') return null;
  if (a.confirmedAt) return item('no_show_call', 'prep', 'recommended', 'done', `High no-show risk, but the visit is confirmed (${ymd(a.confirmedAt)})`);
  const why = f.noShow.reasons.slice(0, 2).join('; ');
  return item('no_show_call', 'prep', 'recommended', 'needs_action', `High no-show risk (score ${f.noShow.score})${why ? `: ${why}` : ''}. Call to confirm`, {
    action: { kind: 'call', phone: f.phone },
  });
}

export function identityItem(f: FoFacts): FoItem | null {
  if (!f.client.identityVerifyRequired) return null;
  return item('identity', 'check_in', 'required', 'needs_action', 'Booked online: check photo ID and date of birth, then confirm identity on the chart', {
    stop: true,
    action: { kind: 'link', href: `/dashboard/clients/${encodeURIComponent(f.appointment.clientId)}`, label: 'Verify identity' },
  });
}

export function idCardItem(f: FoFacts): FoItem {
  const a = f.appointment;
  const insured = f.client.medicaid || !isSelfPayPayer(a.payer);
  if (DEAD.has(a.status)) return item('id_card', 'check_in', 'required', 'not_applicable', 'Visit is not going ahead');
  if (a.isVirtual) return item('id_card', 'check_in', 'recommended', 'needs_action', insured ? 'Video visit: confirm insurance on file is unchanged' : 'Video visit: confirm identity on camera');
  return item('id_card', 'check_in', 'required', 'needs_action', insured ? 'Scan or check photo ID and the insurance card (front and back)' : 'Check photo ID');
}

export function copayItem(f: FoFacts): FoItem | null {
  if (!f.copay) return null;
  const a = f.appointment;
  const expected = f.copay.expectedCents;
  const collected = f.collected?.cents ?? 0;
  const action: FoAction = { kind: 'link', href: `/dashboard/billing/payments?clientId=${encodeURIComponent(a.clientId)}`, label: 'Payments' };
  if (DEAD.has(a.status)) return item('copay', 'check_in', 'required', 'not_applicable', 'Visit is not going ahead (missed-visit fees follow practice policy)');
  if (expected == null || expected <= 0) {
    return item('copay', 'check_in', 'required', 'not_applicable', f.copay.note || 'No copay rule for this payer');
  }
  const src = f.copay.source ? ` (${f.copay.source})` : '';
  if (collected >= expected) return item('copay', 'check_in', 'required', 'done', `Posted ${money(collected)} today; expected ${money(expected)}${src}`);
  if (collected > 0) return item('copay', 'check_in', 'required', 'needs_action', `Posted ${money(collected)} of ${money(expected)} expected${src}`, { action });
  return item('copay', 'check_in', 'required', 'needs_action', `Expected ${money(expected)}${src}; no payment posted today`, { action });
}

export function checkInItem(f: FoFacts): FoItem {
  const a = f.appointment;
  if (DEAD.has(a.status)) return item('check_in', 'check_in', 'required', 'not_applicable', a.status === 'CANCELLED' ? 'Cancelled' : a.status === 'NO_SHOW' ? 'No-show' : 'Late cancel');
  if (KEPT.has(a.status)) return item('check_in', 'check_in', 'required', 'done', a.status === 'COMPLETED' ? 'Completed' : a.status === 'IN_SESSION' ? 'In session' : 'Checked in');
  if (f.visitDate > f.today) return item('check_in', 'check_in', 'required', 'info', 'Upcoming');
  return item('check_in', 'check_in', 'required', 'needs_action', f.now.getTime() > a.endsAt.getTime() ? 'Still Scheduled after the end time: check in or mark no-show' : 'Not checked in yet', {
    action: { kind: 'check_in' },
  });
}

export function nextApptItem(f: FoFacts): FoItem | null {
  const a = f.appointment;
  if (!KEPT.has(a.status)) return null;
  if (f.nextAppointmentAt) return item('next_appt', 'check_out', 'recommended', 'done', `Next visit ${ymd(f.nextAppointmentAt)}`);
  const days = f.followUpDays ?? null;
  const after = days != null ? new Date(a.startsAt.getTime() + days * DAY_MS) : null;
  const href = `/dashboard/appointments?new=1&client=${encodeURIComponent(a.clientId)}${after ? `&after=${ymd(after)}` : ''}`;
  const action: FoAction = { kind: 'link', href, label: 'Book follow-up' };
  if (f.followUpRequested) {
    return item('next_appt', 'check_out', 'required', 'needs_action', `Clinician asked for a next visit; none booked${days != null ? ` (usual interval ${days} days)` : ''}`, { action });
  }
  return item('next_appt', 'check_out', 'recommended', 'needs_action', `No future visit booked${days != null ? ` (usual interval for this visit type: ${days} days)` : ''}`, { action });
}

export function documentsItem(f: FoFacts): FoItem | null {
  if (!KEPT.has(f.appointment.status)) return null;
  return item('documents', 'check_out', 'optional', 'needs_action', 'Visit summary, work / school note or receipt if asked');
}

export function visitClosedItem(f: FoFacts): FoItem | null {
  const a = f.appointment;
  if (a.status === 'COMPLETED') return item('visit_closed', 'check_out', 'required', 'done', 'Completed');
  if (a.status !== 'CHECKED_IN' && a.status !== 'IN_SESSION') return null;
  const late = f.now.getTime() - a.endsAt.getTime();
  if (late > CLOSE_GRACE_MINUTES * 60_000) {
    return item('visit_closed', 'check_out', 'required', 'needs_action', `Still ${a.status === 'IN_SESSION' ? 'in session' : 'checked in'} ${Math.round(late / 60_000)} min after the end time: mark completed`, {
      action: { kind: 'link', href: `/dashboard/appointments?d=${f.visitDate}&appt=${encodeURIComponent(a.id)}`, label: 'Open visit' },
    });
  }
  return item('visit_closed', 'check_out', 'required', 'info', 'Visit in progress');
}

export function rescheduleItem(f: FoFacts): FoItem | null {
  const a = f.appointment;
  if (!MISSED.has(a.status)) return null;
  if (f.nextAppointmentAt) return item('reschedule', 'end_of_day', 'required', 'done', `Rebooked for ${ymd(f.nextAppointmentAt)}`);
  return item('reschedule', 'end_of_day', 'required', 'needs_action', `${a.status === 'NO_SHOW' ? 'No-show' : 'Late cancel'}: no future visit booked`, {
    action: { kind: 'link', href: `/dashboard/appointments?new=1&client=${encodeURIComponent(a.clientId)}`, label: 'Reschedule' },
  });
}

export function outreachItem(f: FoFacts): FoItem | null {
  const a = f.appointment;
  if (!MISSED.has(a.status)) return null;
  return item('outreach', 'end_of_day', 'required', 'needs_action', 'Log the call / text / letter (what was done and the outcome)', {
    action: { kind: 'call', phone: f.phone },
  });
}

// ─── Assembly ───────────────────────────────────────────────────────────────

/** Every item for one appointment, staff marks applied, in workflow order. */
export function buildItems(f: FoFacts): FoItem[] {
  const raw: (FoItem | null)[] = [
    confirmItem(f),
    eligibilityItem(f),
    authorizationItem(f),
    demographicsItem(f),
    consentsItem(f),
    intakeItem(f),
    carelonItem(f),
    balanceItem(f, 'prep'),
    telehealthItem(f),
    portalItem(f),
    noShowCallItem(f),
    identityItem(f),
    idCardItem(f),
    copayItem(f),
    checkInItem(f),
    visitClosedItem(f),
    nextApptItem(f),
    documentsItem(f),
    rescheduleItem(f),
    outreachItem(f),
  ];
  return raw
    .filter((x): x is FoItem => x !== null)
    // In-person visits: hide items that do not apply at all (keeps the list short)
    .filter((x) => !(x.status === 'not_applicable' && (x.id === 'telehealth' || x.id === 'intake')))
    .map((x) => applyMark(x, f.marks.get(x.id)));
}

/** Items that count as work: required or recommended, still needing action. */
export const isOpen = (x: FoItem) => x.status === 'needs_action' && x.level !== 'optional';

export function openByPhase(items: readonly FoItem[]): Record<FoPhase, number> {
  const out: Record<FoPhase, number> = { prep: 0, check_in: 0, check_out: 0, end_of_day: 0 };
  for (const x of items) if (isOpen(x) && x.level === 'required') out[x.phase] += 1;
  return out;
}

/** Phases that decide readiness: before arrival the prep list; after arrival check-in + check-out; missed visits end of day */
export function readinessPhases(status: FoApptStatus): FoPhase[] {
  if (KEPT.has(status)) return ['check_in', 'check_out'];
  if (DEAD.has(status)) return ['end_of_day'];
  return ['prep'];
}

/** ready = no required item open in the current phases; stop = a suggested hard-stop item open; closed = cancelled / missed and handled */
export function readinessOf(status: FoApptStatus, items: readonly FoItem[]): FoReadiness {
  const phases = readinessPhases(status);
  const open = items.filter((x) => isOpen(x) && x.level === 'required' && (phases.includes(x.phase) || (x.stop && status === 'SCHEDULED')));
  if (DEAD.has(status) && !open.length) return 'closed';
  if (open.some((x) => x.stop)) return 'stop';
  return open.length ? 'attention' : 'ready';
}

/**
 * End-of-day copay reconciliation. Expected = kept visits with an expected copay. Collected = posted
 * patient payments that day for those clients, counted once per client. A visit is covered when its
 * client's payments that day reach the sum of that client's expected copays.
 */
export function reconcileCopays(rows: ReadonlyArray<Pick<FoRow, 'clientId' | 'status' | 'copay'>>): FoReconciliation {
  const kept = rows.filter((r) => isKept(r.status) && r.copay);
  const byClient = new Map<string, { expected: number; collected: number; visits: number; marked: number }>();
  for (const r of kept) {
    const c = r.copay!;
    const e = byClient.get(r.clientId) ?? { expected: 0, collected: c.collectedCents, visits: 0, marked: 0 };
    if (c.expectedCents && c.expectedCents > 0) {
      e.expected += c.expectedCents;
      e.visits += 1;
      if (c.markedCollected) e.marked += 1;
    }
    e.collected = Math.max(e.collected, c.collectedCents);
    byClient.set(r.clientId, e);
  }
  const out: FoReconciliation = { expectedCount: 0, expectedCents: 0, collectedCount: 0, collectedCents: 0, missingCount: 0, missingCents: 0, markedNotPostedCount: 0 };
  for (const e of byClient.values()) {
    out.collectedCents += e.collected;
    if (!e.visits) continue;
    out.expectedCount += e.visits;
    out.expectedCents += e.expected;
    if (e.collected >= e.expected) {
      out.collectedCount += e.visits;
    } else {
      out.missingCount += e.visits;
      out.missingCents += e.expected - e.collected;
      if (e.collected === 0) out.markedNotPostedCount += e.marked;
    }
  }
  return out;
}

export function summarizeDay(date: string, rows: readonly FoRow[], withReconciliation: boolean, now: Date): FoDaySummary {
  const day = rows.filter((r) => r.date === date);
  const live = day.filter((r) => r.status !== 'CANCELLED');
  const byItem: FoDaySummary['byItem'] = {};
  for (const r of day) for (const x of r.items) if (isOpen(x)) byItem[x.id] = (byItem[x.id] ?? 0) + 1;
  return {
    date,
    total: live.length,
    kept: day.filter((r) => isKept(r.status)).length,
    ready: live.filter((r) => r.readiness === 'ready').length,
    attention: live.filter((r) => r.readiness === 'attention').length,
    stop: live.filter((r) => r.readiness === 'stop').length,
    byItem,
    noShows: day.filter((r) => r.status === 'NO_SHOW').length,
    lateCancels: day.filter((r) => r.status === 'LATE_CANCEL').length,
    cancelled: day.filter((r) => r.status === 'CANCELLED').length,
    notClosed: day.filter((r) => (r.status === 'SCHEDULED' || r.status === 'CHECKED_IN' || r.status === 'IN_SESSION') && Date.parse(r.endsAt) + CLOSE_GRACE_MINUTES * 60_000 < now.getTime()).length,
    unsignedNotes: day.filter((r) => isKept(r.status) && r.noteSigned === false).length,
    reconciliation: withReconciliation ? reconcileCopays(day) : null,
  };
}
