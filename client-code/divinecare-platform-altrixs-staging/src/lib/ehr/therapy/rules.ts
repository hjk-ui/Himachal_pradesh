/**
 * Workflow rules for the therapist templates. Pure functions (no Prisma, no React) so the
 * editor, the server and the tests apply the same rules:
 *  - CPT from session time (psychotherapy time rule)
 *  - treatment plan required before a therapy progress note is signed
 *  - when a treatment plan counts as "active"
 *  - treatment plan patient-signature status transitions
 *  - pre-licensed clinicians need a supervisor co-signature
 *  - default treatment plan review interval
 */

// ─── CPT by session time ────────────────────────────────────────────────────

export type TherapySessionType = 'individual' | 'family-with-patient' | 'family-without-patient';

export const SESSION_TYPE_LABELS: Record<TherapySessionType, string> = {
  individual: 'Individual psychotherapy',
  'family-with-patient': 'Family psychotherapy with patient present',
  'family-without-patient': 'Family psychotherapy without patient present',
};

/**
 * CPT psychotherapy time rule (CPT "time" convention: a unit is reported once the midpoint is
 * passed). Individual: 90832 = 16–37 min, 90834 = 38–52 min, 90837 = 53+ min; under 16 min is
 * not reported as psychotherapy. Family 90846 / 90847 describe 50 minutes and are reported
 * from 26 minutes.
 */
export const CPT_TIME_RULE_TEXT =
  'Individual psychotherapy by face-to-face time: 16–37 min = 90832, 38–52 min = 90834, 53+ min = 90837 (under 16 min is not billable as psychotherapy). Family psychotherapy (50 min codes) from 26 min: 90847 with the patient present, 90846 without.';

export type CptSuggestion =
  | { code: string; rule: string }
  | { code: null; rule: string };

export function suggestTherapyCpt(minutes: number | null | undefined, sessionType: TherapySessionType = 'individual'): CptSuggestion {
  const m = typeof minutes === 'number' && Number.isFinite(minutes) ? Math.floor(minutes) : null;
  if (m == null || m <= 0) return { code: null, rule: 'Enter the session start and end time to pick the code.' };
  if (sessionType === 'family-with-patient' || sessionType === 'family-without-patient') {
    const code = sessionType === 'family-with-patient' ? '90847' : '90846';
    if (m < 26) return { code: null, rule: `${m} min: family psychotherapy (${code}) needs at least 26 minutes.` };
    return { code, rule: `${m} min family psychotherapy ${sessionType === 'family-with-patient' ? 'with' : 'without'} the patient → ${code} (26+ min).` };
  }
  if (m < 16) return { code: null, rule: `${m} min: under 16 minutes is not billable as psychotherapy.` };
  if (m <= 37) return { code: '90832', rule: `${m} min → 90832 (16–37 min).` };
  if (m <= 52) return { code: '90834', rule: `${m} min → 90834 (38–52 min).` };
  return { code: '90837', rule: `${m} min → 90837 (53+ min).` };
}

/** Minutes between "HH:MM" start and end on the same day (null when either is missing or end <= start). */
export function minutesBetween(start: string | null | undefined, end: string | null | undefined): number | null {
  const parse = (t: string | null | undefined) => {
    const m = String(t ?? '').trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  };
  const s = parse(start);
  const e = parse(end);
  if (s == null || e == null || e <= s) return null;
  return e - s;
}

// ─── Treatment plan required for progress notes ─────────────────────────────

/**
 * Codes that need an active treatment plan before the note is signed: psychotherapy, group
 * psychotherapy (90853) and case management (T1016, T1017), as listed in the CPT catalog
 * (src/lib/constants/cpt.ts). PRP (H2016 / H2018) needs a current IRP instead (PrpWorkflow),
 * checked when a PRP claim is built.
 */
export const PLAN_REQUIRED_CPT = ['90832', '90834', '90837', '90846', '90847', '90853', 'T1016', 'T1017'] as const;
/** Never blocked: intake / evaluation and crisis psychotherapy. */
export const PLAN_EXEMPT_CPT = ['90791', '90792', '90839', '90840'] as const;

/** "90837-95", "90834 GT", "90837T" → "90837"; HCPCS "T1016-HO" → "T1016" */
export function cptBaseCode(code: string | null | undefined): string | null {
  const m = String(code ?? '').trim().match(/^([0-9A-Z]\d{3}[0-9A-Z])/i);
  return m ? m[1].toUpperCase() : null;
}

/**
 * Does signing this note need an active treatment plan? Psychotherapy codes (90832/90834/90837/
 * 90846/90847) on any note type, and the Therapy Progress template itself. Intake (90791/90792)
 * and crisis (90839/90840) are never blocked.
 */
export function noteRequiresTreatmentPlan(input: { noteType: string | null | undefined; cptCode: string | null | undefined }): boolean {
  const base = cptBaseCode(input.cptCode);
  if (base && (PLAN_EXEMPT_CPT as readonly string[]).includes(base)) return false;
  if (base && (PLAN_REQUIRED_CPT as readonly string[]).includes(base)) return true;
  return String(input.noteType ?? '').trim() === 'Therapy Progress';
}

export type PlanSignatureState = {
  id: string;
  title: string;
  status: string;
  reviewDueAt: Date | string | null;
  clinicianSignedAt: Date | string | null;
  supervisorRequired: boolean;
  supervisorSignedAt: Date | string | null;
  patientSignatureStatus: string | null;
  /** Imported from the prior EHR (signatures were recorded there) */
  imported: boolean;
};

export type PlanActivity = {
  active: boolean;
  /** Why the plan is or is not active, for the UI and the sign error */
  reason: string;
  state: 'active' | 'draft' | 'unsigned' | 'awaiting-supervisor' | 'awaiting-patient' | 'expired' | 'closed';
};

const dayOf = (v: Date | string | null | undefined): string | null => {
  if (!v) return null;
  const d = typeof v === 'string' ? new Date(v.length === 10 ? `${v}T12:00:00Z` : v) : v;
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

/**
 * "Active" = clinician-signed (and supervisor-signed when the author is pre-licensed), status
 * ACTIVE or NEEDS_REVIEW, and the review date not passed. The patient signature is tracked but
 * only required when `requirePatientSignature` is on (practice setting, default off).
 *
 * Plans imported from Valant count as signed there, but only while Valant's own review date is
 * current: an imported plan whose review date has passed, or that came over without one, is not
 * active. Same rule as a plan written here (the clinic's ITP form: review every 3 months for a
 * child, 6 for an adult; a Maryland OMHC must keep a current individual treatment plan, COMAR
 * 10.63.03.05), and payers expect billed psychotherapy to follow a current plan. Its reason points
 * to "Rewrite in Altrixs", since the Valant plan's goals are not in Altrixs to review.
 */
export function planActivity(plan: PlanSignatureState, opts: { today: string; requirePatientSignature: boolean }): PlanActivity {
  if (plan.status === 'CLOSED') return { active: false, state: 'closed', reason: `"${plan.title}" is closed.` };
  if (plan.status === 'DRAFT') return { active: false, state: 'draft', reason: `"${plan.title}" is a draft. Sign it to make it active.` };
  const due = dayOf(plan.reviewDueAt);
  if (plan.status === 'EXPIRED' || (due && due < opts.today)) {
    return {
      active: false,
      state: 'expired',
      reason: plan.imported
        ? `The plan imported from Valant passed its review date${due ? ` (${due})` : ''}. Rewrite it in Altrixs (Treatment Plans › Rewrite in Altrixs) and sign the new plan.`
        : `"${plan.title}" passed its review date${due ? ` (${due})` : ''}. Complete a Treatment Plan Review.`,
    };
  }
  if (plan.imported && !due) {
    return {
      active: false,
      state: 'expired',
      reason: 'The plan imported from Valant has no next review date in the Valant export, so it cannot be shown to be current. Rewrite it in Altrixs (Treatment Plans › Rewrite in Altrixs) and sign the new plan.',
    };
  }
  if (!plan.imported && !plan.clinicianSignedAt) {
    return { active: false, state: 'unsigned', reason: `"${plan.title}" has not been signed by the clinician.` };
  }
  if (!plan.imported && plan.supervisorRequired && !plan.supervisorSignedAt) {
    return { active: false, state: 'awaiting-supervisor', reason: `"${plan.title}" is waiting for the supervisor's co-signature (author is pre-licensed).` };
  }
  const patient = plan.patientSignatureStatus || 'NOT_SENT';
  if (opts.requirePatientSignature && !plan.imported && patient !== 'SIGNED' && patient !== 'VERBAL') {
    return { active: false, state: 'awaiting-patient', reason: `"${plan.title}" is waiting for the patient's signature.` };
  }
  return { active: true, state: 'active', reason: `"${plan.title}" is active${due ? ` (review due ${due})` : ''}.` };
}

/** Set when signing is allowed only by the go-live transition (no active plan on file). */
export type PlanGateTransition = {
  reason: 'golive_transition';
  /** YYYY-MM-DD: last day the allowance applies */
  until: string;
};

export type PlanGateResult =
  | { ok: true; required: boolean; planId: string | null; message: string; transition?: PlanGateTransition }
  | { ok: false; required: true; planId: string | null; message: string };

/** Chip / stamp text on a note signed under the go-live transition. */
export const PLAN_PENDING_LABEL = 'Treatment plan pending (go-live transition)';

/**
 * Did this client's care start in Valant? Valant imports set Client.sourcePlatform to 'valant'
 * (patient import) or 'VALANT_EXPORT' (export repair). Clients created in Altrixs have none.
 */
export function isValantClient(client: { sourcePlatform?: string | null } | null | undefined): boolean {
  return /valant/i.test(String(client?.sourcePlatform ?? ''));
}

/**
 * Can a note be signed given the client's treatment plans?
 *
 * Go-live transition: Valant exported plans for only a fraction of active clients, so for a
 * client whose care started in Valant, a therapy progress note may be signed without an active
 * plan until `transitionUntil` (inclusive). The result is ok with `transition` set, and the
 * caller stamps the note "Treatment plan pending", audits the override and lists the client
 * for a plan. Clients created in Altrixs follow the rule immediately; after the date it applies
 * to everyone. Intake and crisis codes never reach this (not plan-required).
 */
export function treatmentPlanGate(input: {
  noteType: string | null | undefined;
  cptCode: string | null | undefined;
  plans: PlanSignatureState[];
  today: string;
  settings: TherapyWorkflowSettings;
  /** Client came over from Valant (isValantClient); omitted = not eligible for the transition */
  valantClient?: boolean;
}): PlanGateResult {
  if (!input.settings.requirePlanForProgressNotes || !noteRequiresTreatmentPlan(input)) {
    return { ok: true, required: false, planId: null, message: 'No treatment plan needed for this note.' };
  }
  const evaluated = input.plans.map((p) => ({ plan: p, activity: planActivity(p, { today: input.today, requirePatientSignature: input.settings.requirePatientSignature }) }));
  const active = evaluated.find((e) => e.activity.active);
  if (active) return { ok: true, required: true, planId: active.plan.id, message: active.activity.reason };
  const closest =
    evaluated.find((e) => e.activity.state === 'awaiting-supervisor' || e.activity.state === 'awaiting-patient') ||
    evaluated.find((e) => e.activity.state === 'unsigned' || e.activity.state === 'draft') ||
    evaluated.find((e) => e.activity.state === 'expired');
  const detail = closest ? ` ${closest.activity.reason}` : ' No treatment plan is on file for this client.';
  const until = transitionUntilDate(input.settings);
  if (input.valantClient && until && input.today <= until) {
    return {
      ok: true,
      required: true,
      planId: closest?.plan.id ?? null,
      transition: { reason: 'golive_transition', until },
      message: `No active treatment plan — allowed until ${until} (go-live transition). Write the plan in Altrixs.${detail}`,
    };
  }
  return {
    ok: false,
    required: true,
    planId: closest?.plan.id ?? null,
    message: `A signed, active treatment plan is required before signing this note (${PLAN_REQUIRED_CPT.join('/')}, and every Therapy Progress note).${detail} Save this note as a draft, then create or finish the treatment plan (Treatment Plans). Crisis notes (90839/90840) and intakes are not blocked.`,
  };
}

// ─── Settings ───────────────────────────────────────────────────────────────

export type TherapyWorkflowSettings = {
  /** Block signing therapy progress notes without an active treatment plan (default ON) */
  requirePlanForProgressNotes: boolean;
  /** Treat the patient's signature as required for the plan to be active (default OFF) */
  requirePatientSignature: boolean;
  /** YYYY-MM-DD the practice goes live on Altrixs (Valant exit) */
  goLiveDate: string;
  /**
   * YYYY-MM-DD last day of the go-live transition for Valant clients without a plan. Null = the
   * default, go-live date + GO_LIVE_TRANSITION_DAYS (follows a changed go-live date).
   */
  transitionUntil: string | null;
  /** Providers can change the text of a library item added to a plan before it is active (default ON, as in Valant) */
  libraryEditBeforeActive: boolean;
  /** Providers can change the text of a library item on a plan that was active (copied into a review; default ON) */
  libraryEditAfterActive: boolean;
  /** Days before the review due date the plan owner gets an Inbox reminder (Valant: 7) */
  reviewReminderDays: number;
  /** Days before the review due date the supervisor gets a reminder; null = no supervisor reminder (Valant: blank) */
  supervisorReminderDays: number | null;
};

/** Valant exit date for this practice (owner's cutover plan). */
export const DEFAULT_GO_LIVE_DATE = '2026-11-01';
/** Default length of the go-live transition after the go-live date. */
export const GO_LIVE_TRANSITION_DAYS = 30;

export const DEFAULT_THERAPY_WORKFLOW_SETTINGS: TherapyWorkflowSettings = {
  requirePlanForProgressNotes: true,
  requirePatientSignature: false,
  goLiveDate: DEFAULT_GO_LIVE_DATE,
  transitionUntil: null,
  libraryEditBeforeActive: true,
  libraryEditAfterActive: true,
  reviewReminderDays: 7,
  supervisorReminderDays: null,
};

const reminderDays = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 90 ? v : null);

/** A real calendar date as YYYY-MM-DD, else null. */
export function asIsoDay(v: unknown): string | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : null;
}

function addDaysIso(day: string, days: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Last day (inclusive) of the go-live transition: the explicit setting, else go-live + 30 days. */
export function transitionUntilDate(settings: Pick<TherapyWorkflowSettings, 'goLiveDate' | 'transitionUntil'>): string | null {
  const explicit = asIsoDay(settings.transitionUntil);
  if (explicit) return explicit;
  const goLive = asIsoDay(settings.goLiveDate);
  return goLive ? addDaysIso(goLive, GO_LIVE_TRANSITION_DAYS) : null;
}

export function parseTherapyWorkflowSettings(raw: unknown): TherapyWorkflowSettings {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    requirePlanForProgressNotes:
      typeof o.requirePlanForProgressNotes === 'boolean' ? o.requirePlanForProgressNotes : DEFAULT_THERAPY_WORKFLOW_SETTINGS.requirePlanForProgressNotes,
    requirePatientSignature:
      typeof o.requirePatientSignature === 'boolean' ? o.requirePatientSignature : DEFAULT_THERAPY_WORKFLOW_SETTINGS.requirePatientSignature,
    goLiveDate: asIsoDay(o.goLiveDate) ?? DEFAULT_THERAPY_WORKFLOW_SETTINGS.goLiveDate,
    transitionUntil: asIsoDay(o.transitionUntil),
    libraryEditBeforeActive:
      typeof o.libraryEditBeforeActive === 'boolean' ? o.libraryEditBeforeActive : DEFAULT_THERAPY_WORKFLOW_SETTINGS.libraryEditBeforeActive,
    libraryEditAfterActive:
      typeof o.libraryEditAfterActive === 'boolean' ? o.libraryEditAfterActive : DEFAULT_THERAPY_WORKFLOW_SETTINGS.libraryEditAfterActive,
    reviewReminderDays: reminderDays(o.reviewReminderDays) ?? DEFAULT_THERAPY_WORKFLOW_SETTINGS.reviewReminderDays,
    supervisorReminderDays: reminderDays(o.supervisorReminderDays),
  };
}

// ─── Review reminders ───────────────────────────────────────────────────────

export type ReviewReminder = { due: string; remindFrom: string; daysLeft: number; overdue: boolean };

/**
 * Reminder for a plan's review date: shown from `days` before the due date (Valant: 7 days, to the
 * plan owner) and kept while overdue. Null when there is no review date, no reminder is set
 * (`days` null), or it is not time yet. Review cycles are per plan (the editable review date).
 */
export function planReviewReminder(reviewDueAt: Date | string | null | undefined, today: string, days: number | null | undefined): ReviewReminder | null {
  if (days == null || !Number.isFinite(days) || days < 0) return null;
  const due = dayOf(reviewDueAt);
  if (!due) return null;
  const remindFrom = addDaysIso(due, -Math.floor(days));
  if (today < remindFrom) return null;
  const daysLeft = Math.round((Date.parse(`${due}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
  return { due, remindFrom, daysLeft, overdue: daysLeft < 0 };
}

/** Claim scrubber warning for a claim whose note was signed under the go-live transition. */
export function planPendingClaimWarning(workflow: { planPendingUntil?: Date | string | null } | null | undefined): string | null {
  const until = workflow?.planPendingUntil;
  if (!until) return null;
  const day = typeof until === 'string' ? until.slice(0, 10) : until.toISOString().slice(0, 10);
  return `Treatment plan pending: the progress note was signed under the go-live transition without an active treatment plan (plan due by ${day}). Payers may ask for the plan covering this date of service.`;
}

// ─── Patient signature (portal) ─────────────────────────────────────────────

export const PATIENT_SIGNATURE_STATUSES = ['NOT_SENT', 'AWAITING', 'SIGNED', 'DECLINED', 'VERBAL'] as const;
export type PatientSignatureStatus = (typeof PATIENT_SIGNATURE_STATUSES)[number];

export const PATIENT_SIGNATURE_LABELS: Record<PatientSignatureStatus, string> = {
  NOT_SENT: 'Not sent to patient',
  AWAITING: 'Awaiting patient signature',
  SIGNED: 'Patient signed',
  DECLINED: 'Patient declined',
  VERBAL: 'Verbal consent documented',
};

export type PatientSignatureAction =
  | { type: 'send' }
  | { type: 'sign'; typedName: string }
  | { type: 'decline'; reason: string }
  | { type: 'verbal'; obtainedBy: string }
  | { type: 'void' };

export function asPatientSignatureStatus(v: string | null | undefined): PatientSignatureStatus {
  return (PATIENT_SIGNATURE_STATUSES as readonly string[]).includes(String(v)) ? (v as PatientSignatureStatus) : 'NOT_SENT';
}

/**
 * Patient signature transitions. The plan is sent only after the clinician signs; the patient
 * signs or declines (reason required) while it is awaiting; a plan the patient declined can be
 * re-sent; telehealth verbal consent (the clinic's ITP form) can be recorded instead of an
 * e-signature; "void" (plan reopened for edits) resets everything.
 */
export function patientSignatureTransition(
  current: PatientSignatureStatus,
  action: PatientSignatureAction,
  ctx: { clinicianSigned: boolean }
): { ok: true; next: PatientSignatureStatus } | { ok: false; error: string } {
  switch (action.type) {
    case 'send':
      if (!ctx.clinicianSigned) return { ok: false, error: 'Sign the plan before sending it to the patient.' };
      if (current === 'SIGNED' || current === 'VERBAL') return { ok: false, error: 'The patient has already signed this plan.' };
      return { ok: true, next: 'AWAITING' };
    case 'sign':
      if (current !== 'AWAITING') return { ok: false, error: current === 'SIGNED' ? 'You already signed this plan.' : 'This plan is not waiting for your signature.' };
      if (action.typedName.trim().length < 2) return { ok: false, error: 'Type your full name to sign.' };
      return { ok: true, next: 'SIGNED' };
    case 'decline':
      if (current !== 'AWAITING') return { ok: false, error: 'This plan is not waiting for your signature.' };
      if (action.reason.trim().length < 3) return { ok: false, error: 'Tell your clinician why you are declining.' };
      return { ok: true, next: 'DECLINED' };
    case 'verbal':
      if (!ctx.clinicianSigned) return { ok: false, error: 'Sign the plan before recording the patient’s verbal consent.' };
      if (current === 'SIGNED' || current === 'VERBAL') return { ok: false, error: 'The patient has already signed this plan.' };
      if (action.obtainedBy.trim().length < 2) return { ok: false, error: 'Enter who obtained the verbal consent.' };
      return { ok: true, next: 'VERBAL' };
    case 'void':
      return { ok: true, next: 'NOT_SENT' };
  }
}

// ─── Licensure level (supervisor co-signature) ──────────────────────────────

export type LicenseLevel = 'LICENSED' | 'PRE_LICENSED';

/**
 * Maryland pre-licensure / supervised credentials: LGPC (graduate professional counselor),
 * LMSW (master social worker — clinical work under supervision), LGSW (older title), LGMFT,
 * LGADC, alcohol & drug trainee (ADT) and CAC-AD trainee, and generic "pre-licensed" /
 * "supervisee" / "intern" / "trainee". Independent licenses are LCPC, LCSW-C, LCMFT, LCADC,
 * LCSW, psychologist, physician, nurse practitioner.
 */
const PRE_LICENSED_RE = /\b(LGPC|LMSW|LGSW|LGMFT|LGADC|ADT|CAC-?AD\s*trainee|pre-?licen[sc]ed|supervisee|intern|trainee|resident in counseling)\b/i;
// Short forms like "MD" / "NP" are left out on purpose: "MD" also means Maryland in titles.
const LICENSED_RE = /\b(LCPC|LCSW-?C|LCSW|LCMFT|LCADC|LCPAT|Ph\.D|Psy\.?D|M\.D|CRNP|PMHNP|APRN|licensed psychologist)\b/i;

/**
 * Level implied by credential titles (null when nothing recognizable is on file). Each title is
 * read on its own; a title naming a pre-licensure credential counts as pre-licensed even if it
 * also names the supervisor's license (e.g. "LGPC — supervised by an LCPC"). Any title that is
 * an independent license alone means licensed (a graduate license often stays on file after).
 */
export function licenseLevelFromCredentials(titles: readonly string[]): LicenseLevel | null {
  let pre = false;
  for (const raw of titles) {
    const t = (raw || '').trim();
    if (!t) continue;
    if (PRE_LICENSED_RE.test(t)) pre = true;
    else if (LICENSED_RE.test(t)) return 'LICENSED';
  }
  return pre ? 'PRE_LICENSED' : null;
}

/**
 * Is the clinician pre-licensed? An explicit HR setting wins; otherwise being a supervisee on a
 * licensure track (HR > Supervision) or holding a pre-licensure credential.
 */
export function resolveLicenseLevel(input: {
  explicit: string | null | undefined;
  credentialTitles: readonly string[];
  onSupervisionTrack: boolean;
}): { level: LicenseLevel; source: 'hr-setting' | 'supervision-track' | 'credential' | 'default' } {
  if (input.explicit === 'LICENSED' || input.explicit === 'PRE_LICENSED') return { level: input.explicit, source: 'hr-setting' };
  if (input.onSupervisionTrack) return { level: 'PRE_LICENSED', source: 'supervision-track' };
  const fromCreds = licenseLevelFromCredentials(input.credentialTitles);
  if (fromCreds) return { level: fromCreds, source: 'credential' };
  return { level: 'LICENSED', source: 'default' };
}

/** Supervisor signs treatment plans (and co-signs notes) only for pre-licensed authors. */
export function supervisorSignatureRequired(level: LicenseLevel): boolean {
  return level === 'PRE_LICENSED';
}

// ─── Review interval ────────────────────────────────────────────────────────

/**
 * Treatment plan review interval: ONE rule for every plan path (template editor, legacy
 * /api/ehr/treatment-plans, Valant rewrite). Owner decision 2026-10-21: adults at most 180 days,
 * under 18 at most 90 days, from Practice Settings (treatmentPlanReviewDays, 30–180, default 180;
 * a child plan never goes past 90). The clinic's ITP form says "3 months for child, 6 months for
 * adult". The value is both the default and the latest review date allowed.
 */
export const ADULT_REVIEW_MAX_DAYS = 180;
export const CHILD_REVIEW_MAX_DAYS = 90;
export const MIN_PRACTICE_REVIEW_DAYS = 30;

export function defaultReviewDays(age: number | null | undefined, practiceDays: number | null | undefined): number {
  const adult =
    typeof practiceDays === 'number' && practiceDays >= MIN_PRACTICE_REVIEW_DAYS && practiceDays <= ADULT_REVIEW_MAX_DAYS
      ? Math.round(practiceDays)
      : ADULT_REVIEW_MAX_DAYS;
  if (typeof age === 'number' && age < 18) return Math.min(CHILD_REVIEW_MAX_DAYS, adult);
  return adult;
}

/** Latest review date allowed, in days from today (same rule as the default). */
export function maxReviewDays(age: number | null | undefined, practiceDays: number | null | undefined): number {
  return defaultReviewDays(age, practiceDays);
}

/** Absolute ceiling for any plan (adult maximum). Per-client limits come from maxReviewDays. */
export const MAX_REVIEW_DAYS = ADULT_REVIEW_MAX_DAYS;

/**
 * The editor's note under the review date: says where the default came from, using the numbers
 * actually applied (never a fixed "6 months" when the practice interval is different).
 */
export function reviewDaysNoteText(days: number, age: number | null | undefined, practiceDays: number | null | undefined): string {
  const minor = typeof age === 'number' && age < 18;
  const practice = typeof practiceDays === 'number' ? `Practice Settings review interval ${practiceDays} days` : 'no practice review interval set (180 days)';
  return minor
    ? `Default ${days} days: child plans are reviewed at least every 90 days (clinic ITP form: 3 months for a child); ${practice}.`
    : `Default ${days} days from the ${practice} (clinic ITP form: 6 months for an adult).`;
}
