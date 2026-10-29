/**
 * Maryland PRP standard (COMAR 10.63 PRP program requirements; Maryland Medicaid PBHS through the
 * ASO, Carelon Behavioral Health of Maryland). Pure, client-safe rules used by the PRP hub, the
 * PRP APIs, the IRP builder and the referral form, so they can be unit tested.
 *
 * Nothing here invents a payer number. Where a value is not in the codebase or confirmed by the
 * practice, it is a practice setting labelled "practice policy — confirm":
 *  - billing model: PracticeSettings.prpBillingModel (null = not confirmed; no default chosen)
 *  - monthly contact minimum: PracticeSettings.prpMonthlyMinContacts (null = not set, no flag)
 *  - IRP review interval: PracticeSettings.prpIrpReviewDays (adult, default 180) with the same
 *    rule the owner confirmed for treatment plans on 2026-10-21 (adult at most 180 days, under 18
 *    at most 90 days; src/lib/ehr/therapy/rules.ts defaultReviewDays). The clinic's IRP form
 *    already says "3 months for adolescent clients; 6 months for adult clients".
 */
import { defaultReviewDays, ADULT_REVIEW_MAX_DAYS, CHILD_REVIEW_MAX_DAYS } from '@/lib/ehr/therapy/rules';
import { PRP_BILLING_SOURCES } from './billingRule';

export const PRACTICE_POLICY_CONFIRM = 'practice policy — confirm';

// ─── Billing model (practice-confirmed setting) ─────────────────────────────

export const PRP_BILLING_MODELS = ['per_encounter_h2017', 'monthly_case_rate_h2018_h2016'] as const;
export type PrpBillingModel = (typeof PRP_BILLING_MODELS)[number];

export const PRP_BILLING_MODEL_OPTIONS: Record<PrpBillingModel, { label: string; detail: string; encounterCodes: string[]; monthlyCodes: string[] }> = {
  per_encounter_h2017: {
    label: 'Per-encounter H2017 units',
    detail: 'Each PRP encounter is billed as H2017 units. Unit length and any visit thresholds come from the payer and are not set in Altrixs.',
    encounterCodes: ['H2017'],
    monthlyCodes: [],
  },
  monthly_case_rate_h2018_h2016: {
    label: 'Monthly case rate H2018 + H2016 encounter lines',
    detail: 'One H2018 case-rate line per participant per month (level modifier from the payer) plus one H2016 line per encounter, as described in the Optum Maryland PRP Adult guidance (Mar 2023) and the Oct 2024 ASO FAQ.',
    encounterCodes: ['H2016'],
    monthlyCodes: ['H2018'],
  },
};

export function isPrpBillingModel(v: unknown): v is PrpBillingModel {
  return typeof v === 'string' && (PRP_BILLING_MODELS as readonly string[]).includes(v);
}

export type PrpBillingState = {
  model: PrpBillingModel | null;
  confirmed: boolean;
  label: string;
  detail: string;
  confirmedBy: string | null;
  confirmedAt: string | null;
  /** Codes a single PRP encounter is documented under; empty until the practice confirms a model */
  encounterCodes: string[];
  monthlyCodes: string[];
  sources: typeof PRP_BILLING_SOURCES;
};

/** Billing model state from the stored setting. Unset (or an unknown stored value) = not confirmed. */
export function prpBillingState(s: { prpBillingModel?: string | null; prpBillingModelConfirmedBy?: string | null; prpBillingModelConfirmedAt?: Date | string | null } | null | undefined): PrpBillingState {
  const raw = s?.prpBillingModel ?? null;
  if (!isPrpBillingModel(raw)) {
    return {
      model: null,
      confirmed: false,
      label: `PRP billing model not confirmed (${PRACTICE_POLICY_CONFIRM})`,
      detail:
        'Choose per-encounter H2017 units or the monthly H2018 case rate with H2016 encounter lines once billing has confirmed it with Carelon / the PBHS fee schedule. Until then Altrixs reports encounter counts only and builds no PRP claim.',
      confirmedBy: null,
      confirmedAt: null,
      encounterCodes: [],
      monthlyCodes: [],
      sources: PRP_BILLING_SOURCES,
    };
  }
  const opt = PRP_BILLING_MODEL_OPTIONS[raw];
  const at = s?.prpBillingModelConfirmedAt ? new Date(s.prpBillingModelConfirmedAt) : null;
  return {
    model: raw,
    confirmed: true,
    label: `${opt.label} (confirmed by practice)`,
    detail: opt.detail,
    confirmedBy: s?.prpBillingModelConfirmedBy ?? null,
    confirmedAt: at && !Number.isNaN(at.getTime()) ? at.toISOString() : null,
    encounterCodes: [...opt.encounterCodes],
    monthlyCodes: [...opt.monthlyCodes],
    sources: PRP_BILLING_SOURCES,
  };
}

/** Visit Guide codes for a PRP contact: follow the confirmed model, none while unconfirmed. */
export function prpVisitCodes(model: string | null | undefined): string[] {
  return isPrpBillingModel(model) ? [...PRP_BILLING_MODEL_OPTIONS[model].encounterCodes] : [];
}

// ─── Monthly contact minimum (practice policy) ──────────────────────────────

export type MonthlyMinimumState =
  | { state: 'not_set'; minimum: null; contacts: number; label: string }
  | { state: 'met' | 'below'; minimum: number; contacts: number; short: number; label: string };

/**
 * Billing contacts this month vs the practice minimum. Unset minimum = no flag (labelled), never a
 * guessed payer number. Counts billable encounters only.
 */
export function monthlyMinimumState(billableContacts: number, minimum: number | null | undefined): MonthlyMinimumState {
  const contacts = Math.max(0, Math.floor(billableContacts || 0));
  if (minimum == null || !Number.isInteger(minimum) || minimum <= 0) {
    return { state: 'not_set', minimum: null, contacts, label: `Monthly minimum not set (${PRACTICE_POLICY_CONFIRM})` };
  }
  const short = Math.max(0, minimum - contacts);
  return short === 0
    ? { state: 'met', minimum, contacts, short: 0, label: `${contacts} of ${minimum} monthly contacts (practice minimum met)` }
    : { state: 'below', minimum, contacts, short, label: `${contacts} of ${minimum} monthly contacts: ${short} more needed (practice minimum)` };
}

// ─── IRP review interval and due date ───────────────────────────────────────

/** Days between IRP reviews for this participant: adult = practice setting (30-180, default 180), under 18 at most 90. */
export function prpIrpReviewDays(ageYears: number | null | undefined, practiceDays: number | null | undefined): number {
  return defaultReviewDays(ageYears, practiceDays);
}

export function prpIrpIntervalLabel(practiceDays: number | null | undefined): string {
  const adult = prpIrpReviewDays(null, practiceDays);
  return `IRP review every ${adult} days for adults, ${Math.min(CHILD_REVIEW_MAX_DAYS, adult)} for under 18 (Practice Settings; same rule as treatment plans, confirmed 2026-10-21)`;
}

function parseDay(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** IRP review due = effective date + interval (UTC calendar days). null without an effective date. */
export function computeIrpReviewDue(effectiveDate: Date | string | null | undefined, ageYears: number | null | undefined, practiceDays: number | null | undefined): Date | null {
  const start = parseDay(effectiveDate);
  if (!start) return null;
  return new Date(start.getTime() + prpIrpReviewDays(ageYears, practiceDays) * 86_400_000);
}

/**
 * Review date to store on finalize: the entered date when it is within the allowed interval, else an
 * error; the computed date when none was entered.
 */
export function resolveIrpReviewDue(input: {
  effectiveDate: Date | string | null | undefined;
  enteredReviewDate?: string | null;
  ageYears: number | null | undefined;
  practiceDays: number | null | undefined;
}): { ok: true; reviewDue: Date | null; computed: boolean } | { ok: false; error: string } {
  const max = computeIrpReviewDue(input.effectiveDate, input.ageYears, input.practiceDays);
  const entered = parseDay(input.enteredReviewDate ?? null);
  if (!entered) return { ok: true, reviewDue: max, computed: !!max };
  const start = parseDay(input.effectiveDate);
  if (start && entered.getTime() <= start.getTime()) return { ok: false, error: 'The next IRP review date must be after the IRP date' };
  if (max && entered.getTime() > max.getTime()) {
    const days = prpIrpReviewDays(input.ageYears, input.practiceDays);
    return { ok: false, error: `The next IRP review date can be at most ${days} days after the IRP date (${max.toISOString().slice(0, 10)})` };
  }
  return { ok: true, reviewDue: entered, computed: false };
}

// ─── IRP finalize requirements ──────────────────────────────────────────────

type Sig = { name?: unknown; signature?: unknown; date?: unknown } | null | undefined;
const filled = (v: unknown) => typeof v === 'string' && v.trim() !== '';
const signed = (s: Sig) => !!s && filled(s.signature) && filled(s.date);

/**
 * What blocks finalizing an IRP: an IRP date, at least one goal tied to a rehabilitation need area
 * with a goal statement, the participant's signature and date (or the guardian's for a minor), and
 * a PRP staff signature and date. Returns plain-language reasons; [] = may finalize.
 */
export function irpFinalizeBlockers(irp: Record<string, unknown> | null | undefined, opts: { minor?: boolean } = {}): string[] {
  const out: string[] = [];
  const d = irp ?? {};
  if (!filled(d.date)) out.push('IRP date');
  const goals = Array.isArray(d.goals) ? (d.goals as Record<string, unknown>[]) : [];
  const domainGoals = goals.filter((g) => g && filled(g.need) && (filled(g.longTermGoal) || filled(g.shortTermGoal)));
  if (!domainGoals.length) out.push('At least one goal with a rehabilitation need area and a goal statement');
  const sigs = (d.signatures && typeof d.signatures === 'object' ? d.signatures : {}) as Record<string, Sig>;
  const participantOk = signed(sigs.client) || (opts.minor === true && signed(sigs.guardian));
  if (!participantOk) out.push(opts.minor ? 'Participant or guardian signature and date' : 'Participant signature and date');
  if (!(signed(sigs.prpCounselor) || signed(sigs.prpCoordinator))) out.push('PRP staff signature and date');
  return out;
}

// ─── Encounter documentation ────────────────────────────────────────────────

export const PRP_LOCATIONS = ['onsite', 'offsite'] as const;
export type PrpLocation = (typeof PRP_LOCATIONS)[number];

export type EncounterDoc = {
  serviceDate?: Date | string | null;
  minutes?: number | null;
  serviceType?: string | null;
  location?: string | null;
  recordedById?: string | null;
  recordedByName?: string | null;
  irpGoal?: string | null;
  intervention?: string | null;
  response?: string | null;
};

/** Missing elements of one PRP service contact: date, minutes, service type, location, staff, IRP goal, intervention, response. */
export function encounterDocIssues(e: EncounterDoc): string[] {
  const out: string[] = [];
  if (!e.serviceDate) out.push('date');
  if (!(typeof e.minutes === 'number' && e.minutes > 0)) out.push('minutes');
  if (!filled(e.serviceType)) out.push('service type');
  if (!(PRP_LOCATIONS as readonly string[]).includes(String(e.location ?? ''))) out.push('location (onsite / offsite)');
  if (!filled(e.recordedById) && !filled(e.recordedByName)) out.push('staff');
  if (!filled(e.irpGoal)) out.push('IRP goal addressed');
  if (!filled(e.intervention)) out.push('intervention');
  if (!filled(e.response)) out.push('participant response');
  return out;
}

export function isEncounterComplete(e: EncounterDoc): boolean {
  return encounterDocIssues(e).length === 0;
}

/** Community services happen off site; group / individual default to on site. */
export function defaultLocation(serviceType: string | null | undefined): PrpLocation {
  return serviceType === 'community' ? 'offsite' : 'onsite';
}

// ─── MORS ───────────────────────────────────────────────────────────────────

/** MORS is rated monthly for every open enrollment (active, on hold, transitioning). */
export function morsDue(status: string, ratingThisMonth: number | null | undefined): boolean {
  return status !== 'discharged' && (ratingThisMonth == null);
}

// ─── Discharge / transition ─────────────────────────────────────────────────

export const PRP_DISCHARGE_TYPES = [
  { value: 'goals_met', label: 'IRP goals met / planned discharge' },
  { value: 'transfer', label: 'Transferred to another program or level of care' },
  { value: 'withdrew', label: 'Participant chose to stop services' },
  { value: 'no_contact', label: 'No contact / unable to reach' },
  { value: 'moved', label: 'Moved out of the service area' },
  { value: 'hospital_or_incarcerated', label: 'Extended hospitalization or incarceration' },
  { value: 'ineligible', label: 'No longer meets medical necessity / eligibility' },
  { value: 'deceased', label: 'Deceased' },
  { value: 'other', label: 'Other' },
] as const;
export type PrpDischargeType = (typeof PRP_DISCHARGE_TYPES)[number]['value'];

/** Reasons a status change cannot be saved: discharge needs type, reason and an aftercare plan (not for deceased); transitioning needs a transition plan. */
export function dischargeIssues(input: {
  status?: string | null;
  dischargeType?: string | null;
  dischargeReason?: string | null;
  transitionPlan?: string | null;
  aftercarePlan?: string | null;
}): string[] {
  const out: string[] = [];
  if (input.status === 'discharged') {
    if (!PRP_DISCHARGE_TYPES.some((t) => t.value === input.dischargeType)) out.push('Discharge type');
    if (!filled(input.dischargeReason)) out.push('Discharge reason');
    if (input.dischargeType !== 'deceased' && !filled(input.aftercarePlan)) out.push('Aftercare plan (referrals, appointments, crisis resources)');
  }
  if (input.status === 'transitioning' && !filled(input.transitionPlan)) out.push('Transition plan');
  return out;
}

// ─── Referral (licensed mental health professional) ─────────────────────────

/**
 * Credentials of a Maryland licensed mental health professional who may refer to PRP. Pre-licensed
 * credentials (LGPC, LMSW, LGMFT) are not on the list.
 */
export const PRP_REFERRER_CREDENTIALS = [
  { value: 'MD', label: 'MD (physician)' },
  { value: 'DO', label: 'DO (physician)' },
  { value: 'CRNP-PMH', label: 'CRNP / APRN, psychiatric mental health' },
  { value: 'CRNP', label: 'CRNP (other specialty)' },
  { value: 'PA', label: 'PA-C' },
  { value: 'PSYCHOLOGIST', label: 'Licensed psychologist' },
  { value: 'LCSW-C', label: 'LCSW-C' },
  { value: 'LCPC', label: 'LCPC' },
  { value: 'LCMFT', label: 'LCMFT' },
  { value: 'APRN-PMH', label: 'APRN-PMH / psychiatric clinical nurse specialist' },
] as const;
export type PrpReferrerCredential = (typeof PRP_REFERRER_CREDENTIALS)[number]['value'];

export function isReferrerCredential(v: unknown): v is PrpReferrerCredential {
  return PRP_REFERRER_CREDENTIALS.some((c) => c.value === v);
}

/**
 * Referral completeness for the licensed referrer and functional impairment: credential, license
 * number and state, treating relationship, NPI, and at least one rated impairment domain plus the
 * functional narrative.
 */
export function referralIssues(r: {
  referrerCredential?: string | null;
  licenseNumber?: string | null;
  referrerLicenseState?: string | null;
  referrerIsTreating?: boolean | null;
  prescriberNpi?: string | null;
  impairmentJson?: unknown;
  functionalNarrative?: string | null;
}): string[] {
  const out: string[] = [];
  if (!isReferrerCredential(r.referrerCredential)) out.push('Referrer credential (licensed mental health professional)');
  if (!filled(r.licenseNumber)) out.push('Referrer license number');
  if (!/^[A-Z]{2}$/.test(String(r.referrerLicenseState ?? ''))) out.push('Referrer license state');
  if (r.referrerIsTreating !== true) out.push('Referrer confirms they treat the participant');
  if (!/^\d{10}$/.test(String(r.prescriberNpi ?? ''))) out.push('Referrer NPI');
  const imp = r.impairmentJson && typeof r.impairmentJson === 'object' ? Object.values(r.impairmentJson as Record<string, unknown>) : [];
  if (!imp.some((v) => Number(v) >= 1 && Number(v) <= 5)) out.push('At least one rated functional impairment domain');
  if (!filled(r.functionalNarrative)) out.push('Functional impairment narrative');
  return out;
}

// ─── Authorization (Carelon) ────────────────────────────────────────────────

export const PRP_AUTH_CODES = ['H2016', 'H2017', 'H2017HK', 'H2018'] as const;

export function isPrpAuth(a: { cptCodes?: string[] | null; notes?: string | null }): boolean {
  return (a.cptCodes ?? []).some((c) => (PRP_AUTH_CODES as readonly string[]).includes(String(c).toUpperCase())) || /\bPRP\b/.test(a.notes ?? '');
}

export type PrpAuthSummary = {
  id: string;
  authNumber: string | null;
  status: string;
  payer: string;
  startDate: string | null;
  endDate: string | null;
  unitsApproved: number;
  unitsUsed: number;
  unitsRemaining: number | null;
  daysLeft: number | null;
  renewal: 'none' | 'active' | 'renew_now' | 'expired' | 'pending';
  renewalLabel: string;
};

/** Units / dates / renewal state of one authorization. leadDays comes from authForecast renewalLeadTime (clinic default, unverified). */
export function prpAuthSummary(
  a: { id: string; authNumber: string | null; status: string; payer: string; startDate: Date | null; endDate: Date | null; unitsApproved: number; unitsUsed: number },
  now: Date,
  leadDays: number,
): PrpAuthSummary {
  const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
  const daysLeft = a.endDate ? Math.floor((a.endDate.getTime() - now.getTime()) / 86_400_000) : null;
  let renewal: PrpAuthSummary['renewal'];
  let renewalLabel: string;
  if (a.status === 'DRAFT' || a.status === 'SUBMITTED') {
    renewal = 'pending';
    renewalLabel = a.status === 'DRAFT' ? 'Draft: not submitted to the ASO' : 'Awaiting ASO decision';
  } else if (a.status === 'EXPIRED') {
    renewal = 'expired';
    renewalLabel = a.endDate ? `Expired ${day(a.endDate)}` : 'Expired';
  } else if (a.status !== 'APPROVED') {
    renewal = 'none';
    renewalLabel = `Status ${a.status.toLowerCase()}`;
  } else if (daysLeft == null) {
    renewal = 'active';
    renewalLabel = 'Approved; no end date recorded';
  } else if (daysLeft < 0) {
    renewal = 'expired';
    renewalLabel = `Expired ${day(a.endDate)}`;
  } else if (daysLeft <= leadDays) {
    renewal = 'renew_now';
    renewalLabel = `Request renewal: ends ${day(a.endDate)} (${daysLeft} days)`;
  } else {
    renewal = 'active';
    renewalLabel = `Active through ${day(a.endDate)}`;
  }
  return {
    id: a.id,
    authNumber: a.authNumber,
    status: a.status,
    payer: a.payer,
    startDate: day(a.startDate),
    endDate: day(a.endDate),
    unitsApproved: a.unitsApproved,
    unitsUsed: a.unitsUsed,
    unitsRemaining: a.status === 'APPROVED' ? Math.max(0, a.unitsApproved - a.unitsUsed) : null,
    daysLeft,
    renewal,
    renewalLabel,
  };
}

export { ADULT_REVIEW_MAX_DAYS, CHILD_REVIEW_MAX_DAYS };
