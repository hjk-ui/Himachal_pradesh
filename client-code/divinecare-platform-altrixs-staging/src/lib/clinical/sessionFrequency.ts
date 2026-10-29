/**
 * Session frequency: recommended cadence, actual cadence and the overdue alert.
 *
 * Pure logic only (no Prisma) so the rules can be tested. The loader in
 * sessionFrequencyData.ts reads the rows and calls buildSessionFrequencyItem for each client.
 * The alert count and the alert list both come from summarizeSessionFrequency(items) over the
 * same items array, so they cannot disagree.
 */
import type { Prisma, Role } from '@prisma/client';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { addCalendarDays, clinicDate, parseDateOnly } from '@/lib/workflows/dates';

// ─── Configuration (the one place to change the rules) ─────────────────────────

export type FrequencyKey = 'daily' | '3x_week' | '2x_week' | 'weekly' | 'biweekly' | 'monthly';

/**
 * intervalDays: expected days between sessions. graceDays: extra days before "overdue".
 * Overdue when days since the last attended session > intervalDays + graceDays.
 */
export const SESSION_FREQUENCY_RULES: Record<FrequencyKey, { label: string; intervalDays: number; graceDays: number }> = {
  daily: { label: 'Daily', intervalDays: 1, graceDays: 1 },
  '3x_week': { label: '3x / week', intervalDays: 2, graceDays: 2 },
  '2x_week': { label: '2x / week', intervalDays: 4, graceDays: 2 },
  weekly: { label: 'Weekly', intervalDays: 7, graceDays: 3 },
  biweekly: { label: 'Every 2 weeks', intervalDays: 14, graceDays: 3 },
  monthly: { label: 'Monthly', intervalDays: 30, graceDays: 5 },
};

/** Clinic standard when nothing on file sets a frequency. Labelled as a default in the UI. */
export const DEFAULT_THERAPY_FREQUENCY: FrequencyKey = 'weekly';
/** Window for "actual cadence" */
export const CADENCE_WINDOW_DAYS = 56;
/** How far back attended sessions are read for "last attended" */
export const ATTENDANCE_LOOKBACK_DAYS = 400;
export const CLINIC_TIME_ZONE = 'America/New_York';
/**
 * No appointment (any status except cancelled) and no note in this many days, and nothing
 * booked: the client is "likely inactive". They leave the overdue alert for a collapsed
 * "Overdue more than 180 days — likely inactive" group with a discharge-review action
 * (never discharged automatically).
 */
export const LIKELY_INACTIVE_DAYS = 180;

/** Appointment statuses that mean the client attended */
export const ATTENDED_APPOINTMENT_STATUSES = ['COMPLETED', 'CHECKED_IN', 'IN_SESSION'] as const;

/** Individual psychotherapy (telehealth = same code with T suffix / modifier 95 / GT) */
export const THERAPY_CPT = ['90832', '90834', '90837'] as const;
/** E/M med management, and the psychotherapy add-ons billed with an E/M visit */
export const MED_MANAGEMENT_CPT = ['99212', '99213', '99214', '99215', '90833', '90836', '90838'] as const;

/** Treatment plan types whose service frequency applies to individual therapy */
const THERAPY_PLAN_TYPES = ['Individual Therapy', 'Substance Use Disorder (SUD)'];
const MED_PLAN_TYPES = ['Psychiatric Medical'];

// ─── Service type ──────────────────────────────────────────────────────────────

export type ServiceType = 'therapy' | 'med_management' | 'other' | 'unknown';

/** "90837T", "90834-95", "99214 GT" → base CPT */
export function cptBase(code: string | null | undefined): string | null {
  const m = String(code ?? '').trim().match(/^(\d{4}[0-9A-Z])/i);
  return m ? m[1].toUpperCase() : null;
}

export function serviceTypeForCpt(code: string | null | undefined): ServiceType {
  const base = cptBase(code);
  if (!base) return 'unknown';
  if ((THERAPY_CPT as readonly string[]).includes(base)) return 'therapy';
  if ((MED_MANAGEMENT_CPT as readonly string[]).includes(base)) return 'med_management';
  return 'other';
}

/** Appointment type text when no CPT is known. Ambiguous types ("Telehealth") stay unknown. */
export function serviceTypeForAppointmentType(type: string | null | undefined): ServiceType {
  const t = String(type ?? '').trim().toLowerCase();
  if (!t) return 'unknown';
  if (t === 'individual therapy' || t === 'individual psychotherapy') return 'therapy';
  if (t.includes('medication management') || t.includes('medication review') || t === 'med management') {
    return 'med_management';
  }
  if (t === 'telehealth' || t === 'appointment' || t === 'telehealth check-in') return 'unknown';
  return 'other';
}

/** "Valant code: 90837T" written into Appointment.notes by the Valant appointment import */
export function valantCodeFromNotes(notes: string | null | undefined): string | null {
  const m = String(notes ?? '').match(/Valant code:\s*(\d{5}[A-Z]?)/i);
  return m ? m[1].toUpperCase() : null;
}

/** Claim CPT, then the Valant code, then the appointment type */
export function appointmentServiceType(a: {
  type: string | null;
  notes?: string | null;
  claimCpts?: string[];
}): ServiceType {
  const codes = [...(a.claimCpts ?? []), valantCodeFromNotes(a.notes)].filter(Boolean) as string[];
  const types = codes.map(serviceTypeForCpt);
  // A visit billed with E/M + psychotherapy add-on is med management, not therapy
  if (types.includes('med_management')) return 'med_management';
  if (types.includes('therapy')) return 'therapy';
  if (types.includes('other')) return 'other';
  return serviceTypeForAppointmentType(a.type);
}

// ─── Recommendation ────────────────────────────────────────────────────────────

/** Treatment plan serviceFrequency values (SERVICE_FREQUENCIES) → rule key */
export function frequencyKeyFromPlanText(text: string | null | undefined): FrequencyKey | 'as_needed' | null {
  const t = String(text ?? '').trim().toLowerCase().replace(/\s+/g, '');
  if (!t) return null;
  if (t === 'weekly') return 'weekly';
  if (t === 'bi-weekly' || t === 'biweekly' || t === 'every2weeks') return 'biweekly';
  if (t === '2x/week') return '2x_week';
  if (t === '3x/week') return '3x_week';
  if (t === 'monthly') return 'monthly';
  if (t === 'daily') return 'daily';
  if (t === 'asneeded' || t === 'prn') return 'as_needed';
  return null;
}

export type PlanInput = {
  id: string;
  title: string;
  status: string;
  createdAt: Date;
  planType: string;
  serviceFrequency: string;
};

export type AuthInput = {
  id: string;
  authNumber: string | null;
  payer: string;
  status: string;
  cptCodes: string[];
  unitsApproved: number;
  unitsUsed: number;
  startDate: Date | null;
  endDate: Date | null;
};

export type Recommendation = {
  serviceType: 'therapy' | 'med_management';
  /** null = no frequency tracked (as needed, or nothing on file for med management) */
  key: FrequencyKey | null;
  label: string;
  source: 'treatment_plan' | 'authorization' | 'default' | 'as_needed' | 'none';
  sourceDetail: string;
  sourceId: string | null;
};

const fmtDay = (d: Date) => d.toISOString().slice(0, 10);

function pickPlan(plans: PlanInput[], types: string[], allowUntyped: boolean) {
  const usable = plans.filter(
    (p) => (p.status === 'ACTIVE' || p.status === 'NEEDS_REVIEW') && frequencyKeyFromPlanText(p.serviceFrequency)
  );
  for (const t of types) {
    const hit = usable.filter((p) => p.planType === t).sort((a, b) => +b.createdAt - +a.createdAt)[0];
    if (hit) return hit;
  }
  if (allowUntyped) {
    return usable.filter((p) => !p.planType).sort((a, b) => +b.createdAt - +a.createdAt)[0] ?? null;
  }
  return null;
}

function fromPlan(plan: PlanInput, serviceType: Recommendation['serviceType']): Recommendation {
  const key = frequencyKeyFromPlanText(plan.serviceFrequency)!;
  const typeNote = plan.planType ? '' : ' (plan type not set)';
  const where = `treatment plan "${plan.title}" dated ${fmtDay(plan.createdAt)}${typeNote}`;
  if (key === 'as_needed') {
    return { serviceType, key: null, label: 'As needed', source: 'as_needed', sourceDetail: `As needed — from ${where}; not tracked for overdue`, sourceId: plan.id };
  }
  const label = SESSION_FREQUENCY_RULES[key].label;
  return { serviceType, key, label, source: 'treatment_plan', sourceDetail: `${label} — from ${where}`, sourceId: plan.id };
}

/** Visits per week an authorization allows, or null if the auth cannot set a therapy frequency */
export function authVisitsPerWeek(a: AuthInput, now: Date): number | null {
  if (a.status !== 'APPROVED') return null;
  if (!a.startDate || !a.endDate || a.unitsApproved <= 0) return null;
  if (a.endDate < now || a.startDate > now) return null;
  if (!a.cptCodes.some((c) => serviceTypeForCpt(c) === 'therapy')) return null;
  const weeks = (a.endDate.getTime() - a.startDate.getTime()) / (7 * 86_400_000);
  if (weeks < 1) return null;
  return a.unitsApproved / weeks;
}

export function frequencyKeyFromVisitsPerWeek(perWeek: number): FrequencyKey {
  if (perWeek >= 1.75) return '2x_week';
  if (perWeek >= 0.9) return 'weekly';
  if (perWeek >= 0.4) return 'biweekly';
  return 'monthly';
}

export function resolveTherapyRecommendation(plans: PlanInput[], auths: AuthInput[], now: Date): Recommendation {
  const plan = pickPlan(plans, THERAPY_PLAN_TYPES, true);
  if (plan) return fromPlan(plan, 'therapy');

  const withRate = auths
    .map((a) => ({ a, perWeek: authVisitsPerWeek(a, now) }))
    .filter((x): x is { a: AuthInput; perWeek: number } => x.perWeek != null)
    .sort((x, y) => +(y.a.startDate ?? 0) - +(x.a.startDate ?? 0));
  if (withRate[0]) {
    const { a, perWeek } = withRate[0];
    const key = frequencyKeyFromVisitsPerWeek(perWeek);
    const label = SESSION_FREQUENCY_RULES[key].label;
    return {
      serviceType: 'therapy',
      key,
      label,
      source: 'authorization',
      sourceDetail: `${label} — authorization ${a.authNumber || '(no number)'} (${a.payer}) allows ${a.unitsApproved} visits ${fmtDay(a.startDate!)} to ${fmtDay(a.endDate!)} (${perWeek.toFixed(1)}/week)`,
      sourceId: a.id,
    };
  }

  const label = SESSION_FREQUENCY_RULES[DEFAULT_THERAPY_FREQUENCY].label;
  return {
    serviceType: 'therapy',
    key: DEFAULT_THERAPY_FREQUENCY,
    label,
    source: 'default',
    sourceDetail: `Default: ${label.toLowerCase()} individual therapy (no plan frequency on file)`,
    sourceId: null,
  };
}

/** Med management is only tracked when a psychiatric plan sets a frequency — no default */
export function resolveMedRecommendation(plans: PlanInput[]): Recommendation {
  const plan = pickPlan(plans, MED_PLAN_TYPES, false);
  if (plan) return fromPlan(plan, 'med_management');
  return {
    serviceType: 'med_management',
    key: null,
    label: 'Not set',
    source: 'none',
    sourceDetail: 'No med-management frequency on file (set one on a Psychiatric Medical treatment plan)',
    sourceId: null,
  };
}

// ─── Attendance and status ─────────────────────────────────────────────────────

export type SessionEvidence = {
  /** Instant of the service (dates without time use noon UTC) */
  at: Date;
  serviceType: ServiceType;
  source: 'appointment' | 'claim' | 'signed_note' | 'valant_charge';
};

export type ScheduledVisit = { at: Date; serviceType: ServiceType; appointmentId: string };

export type CadenceStatus =
  | 'on_track'
  | 'due_soon'
  | 'scheduled'
  | 'overdue'
  | 'no_sessions'
  | 'not_tracked';

export type ServiceCadence = {
  recommendation: Recommendation;
  lastAttended: string | null;
  daysSinceLast: number | null;
  /** Date the next session is due (last attended + interval) */
  dueBy: string | null;
  /** Date after which it is overdue (last attended + interval + grace) */
  overdueAfter: string | null;
  daysOverdue: number;
  nextScheduled: string | null;
  nextScheduledAppointmentId: string | null;
  sessionsLast8Weeks: number;
  sessionsPerWeek: number;
  /** Sessions expected in 8 weeks at the recommended frequency (null when not tracked) */
  expectedLast8Weeks: number | null;
  status: CadenceStatus;
  statusDetail: string;
};

export function dayOf(at: Date, timeZone = CLINIC_TIME_ZONE) {
  return clinicDate(at, timeZone);
}

export function daysBetween(from: string, to: string) {
  return Math.round((parseDateOnly(to).getTime() - parseDateOnly(from).getTime()) / 86_400_000);
}

/** Unique attended days for one service type (several sources on the same day = one session) */
export function attendedDays(evidence: SessionEvidence[], serviceType: ServiceType, now: Date): string[] {
  const today = dayOf(now);
  const days = new Set(
    evidence.filter((e) => e.serviceType === serviceType && e.at <= now).map((e) => dayOf(e.at))
  );
  return [...days].filter((d) => d <= today).sort();
}

/**
 * What the cadence needs per client and service type. The org-wide summary gets these straight
 * from SQL aggregates (sessionFrequencyData.ts); the chart reads rows and reduces them here.
 */
export type CadenceFacts = {
  /** Last attended clinic day (YYYY-MM-DD) */
  lastAttended: string | null;
  /** Unique attended days in the last CADENCE_WINDOW_DAYS */
  sessionsLast8Weeks: number;
  /** Next SCHEDULED visit after now */
  next: { at: Date; appointmentId: string } | null;
};

export function cadenceFactsFromEvidence(
  evidence: SessionEvidence[],
  scheduled: ScheduledVisit[],
  serviceType: ServiceType,
  now: Date
): CadenceFacts {
  const today = dayOf(now);
  const days = attendedDays(evidence, serviceType, now);
  const windowStart = addCalendarDays(today, -CADENCE_WINDOW_DAYS);
  const next = scheduled
    .filter((s) => s.serviceType === serviceType && s.at > now)
    .sort((a, b) => +a.at - +b.at)[0];
  return {
    lastAttended: days.length ? days[days.length - 1] : null,
    sessionsLast8Weeks: days.filter((d) => d > windowStart).length,
    next: next ? { at: next.at, appointmentId: next.appointmentId } : null,
  };
}

export function computeServiceCadence(input: {
  recommendation: Recommendation;
  evidence: SessionEvidence[];
  scheduled: ScheduledVisit[];
  now: Date;
}): ServiceCadence {
  return cadenceFromFacts(
    input.recommendation,
    cadenceFactsFromEvidence(input.evidence, input.scheduled, input.recommendation.serviceType, input.now),
    input.now
  );
}

/** What a cadence counts, in words */
export function serviceNoun(t: Recommendation['serviceType']): string {
  return t === 'med_management' ? 'medication management visit' : 'therapy session';
}

export function cadenceFromFacts(rec: Recommendation, facts: CadenceFacts, now: Date): ServiceCadence {
  const today = dayOf(now);
  const last = facts.lastAttended;
  const inWindow = facts.sessionsLast8Weeks;
  const next = facts.next;
  const nextDay = next ? dayOf(next.at) : null;
  const rule = rec.key ? SESSION_FREQUENCY_RULES[rec.key] : null;

  const base = {
    recommendation: rec,
    lastAttended: last,
    daysSinceLast: last ? daysBetween(last, today) : null,
    nextScheduled: nextDay,
    nextScheduledAppointmentId: next?.appointmentId ?? null,
    sessionsLast8Weeks: inWindow,
    sessionsPerWeek: Math.round((inWindow / (CADENCE_WINDOW_DAYS / 7)) * 100) / 100,
    expectedLast8Weeks: rule ? Math.round((CADENCE_WINDOW_DAYS / rule.intervalDays) * 10) / 10 : null,
  };

  if (!rule) {
    return { ...base, dueBy: null, overdueAfter: null, daysOverdue: 0, status: 'not_tracked', statusDetail: rec.sourceDetail };
  }

  if (!last) {
    return {
      ...base,
      dueBy: null,
      overdueAfter: null,
      daysOverdue: 0,
      status: nextDay ? 'scheduled' : 'no_sessions',
      // Say what is counted: a therapy cadence never claims "no sessions" when only med visits exist
      statusDetail: nextDay
        ? `No attended ${serviceNoun(rec.serviceType)} on record yet; next scheduled ${nextDay}`
        : `No attended ${serviceNoun(rec.serviceType)} on record and nothing scheduled`,
    };
  }

  const daysSince = daysBetween(last, today);
  const dueBy = addCalendarDays(last, rule.intervalDays);
  const overdueAfter = addCalendarDays(last, rule.intervalDays + rule.graceDays);
  const withBase = { ...base, dueBy, overdueAfter };

  if (daysSince > rule.intervalDays + rule.graceDays) {
    // A visit already booked within the grace window clears the alert
    if (nextDay && nextDay <= addCalendarDays(today, rule.graceDays)) {
      return { ...withBase, daysOverdue: 0, status: 'scheduled', statusDetail: `Past the ${rule.label.toLowerCase()} window; next session booked ${nextDay}` };
    }
    const daysOverdue = daysBetween(overdueAfter, today);
    return {
      ...withBase,
      daysOverdue,
      status: 'overdue',
      statusDetail: `${daysSince} days since last session (${rule.label.toLowerCase()} allows ${rule.intervalDays} + ${rule.graceDays} grace)${nextDay ? `; next booked ${nextDay}` : '; nothing scheduled'}`,
    };
  }
  if (daysSince >= rule.intervalDays) {
    if (nextDay && nextDay <= overdueAfter) {
      return { ...withBase, daysOverdue: 0, status: 'scheduled', statusDetail: `Due ${dueBy}; next session booked ${nextDay}` };
    }
    return { ...withBase, daysOverdue: 0, status: 'due_soon', statusDetail: `Due ${dueBy}; overdue after ${overdueAfter}${nextDay ? `; next booked ${nextDay}` : '; nothing scheduled'}` };
  }
  return { ...withBase, daysOverdue: 0, status: 'on_track', statusDetail: `Last session ${last}; next due ${dueBy}` };
}

// ─── Per-client item and summary ───────────────────────────────────────────────

export type ClientCadenceInput = {
  clientId: string;
  clientName: string;
  locked: boolean;
  assignedToId: string | null;
  assignedToName: string | null;
  locationId: string | null;
  locationName: string | null;
  riskLevel: string;
  plans: PlanInput[];
  auths: AuthInput[];
  evidence: SessionEvidence[];
  scheduled: ScheduledVisit[];
  /** Past appointments still SCHEDULED with nothing proving attendance (not counted) */
  unconfirmedPastAppointments: number;
  /** Attended appointments whose service type could not be determined (not counted) */
  unknownTypeVisits: number;
  /** Authorizations that could not set a therapy frequency (shown, not used) */
  authNotes: string[];
  /** Pre-aggregated facts (org-wide summary); when set, evidence/scheduled are not read */
  facts?: Record<'therapy' | 'med_management', CadenceFacts>;
  /**
   * Latest appointment (not cancelled; future ones count) or progress note day within
   * LIKELY_INACTIVE_DAYS, null when there is none. Undefined = not loaded (never "likely inactive").
   */
  lastContact?: string | null;
};

export type AlertBucket =
  | 'overdue'
  | 'due_soon'
  | 'scheduled'
  | 'on_track'
  | 'no_sessions'
  | 'not_tracked'
  | 'unassigned'
  /** Overdue / no sessions / unassigned with no appointment or note in LIKELY_INACTIVE_DAYS */
  | 'likely_inactive';

export const ALERT_BUCKETS: AlertBucket[] = ['overdue', 'due_soon', 'scheduled', 'on_track', 'no_sessions', 'not_tracked', 'unassigned', 'likely_inactive'];

/**
 * Likely no longer in active care: contact data was loaded, there has been no appointment or note
 * in the last LIKELY_INACTIVE_DAYS, and nothing is booked (therapy or med management).
 */
export function isLikelyInactive(
  lastContact: string | null | undefined,
  next: { therapy: string | null; medManagement: string | null },
  now: Date
): boolean {
  if (lastContact === undefined) return false;
  if (next.therapy || next.medManagement) return false;
  if (!lastContact) return true;
  return daysBetween(lastContact, dayOf(now)) > LIKELY_INACTIVE_DAYS;
}

export type SessionFrequencyItem = {
  clientId: string;
  clientName: string;
  locked: boolean;
  assignedToId: string | null;
  assignedToName: string | null;
  locationId: string | null;
  locationName: string | null;
  riskLevel: string;
  therapy: ServiceCadence;
  medManagement: ServiceCadence;
  /**
   * Therapy status, except clients without an assigned clinician go to "unassigned", and
   * overdue / no sessions / unassigned clients with no contact in 180 days to "likely_inactive"
   */
  bucket: AlertBucket;
  /** Latest appointment or note day in the last 180 days (null: none; undefined: not loaded) */
  lastContact?: string | null;
  dataNotes: string[];
};

export function buildSessionFrequencyItem(input: ClientCadenceInput, now: Date): SessionFrequencyItem {
  const factsFor = (t: 'therapy' | 'med_management') =>
    input.facts?.[t] ?? cadenceFactsFromEvidence(input.evidence, input.scheduled, t, now);
  const therapy = cadenceFromFacts(resolveTherapyRecommendation(input.plans, input.auths, now), factsFor('therapy'), now);
  const medManagement = cadenceFromFacts(resolveMedRecommendation(input.plans), factsFor('med_management'), now);
  const dataNotes: string[] = [];
  if (input.unconfirmedPastAppointments > 0) {
    dataNotes.push(
      `${input.unconfirmedPastAppointments} past appointment(s) have no attendance status (not checked out, no claim or signed note, or imported from Valant without a billed charge) — not counted as attended`
    );
  }
  if (input.unknownTypeVisits > 0) {
    dataNotes.push(
      `${input.unknownTypeVisits} attended visit(s) have no CPT and an unspecific type (e.g. "Telehealth") — not counted toward therapy or med management`
    );
  }
  dataNotes.push(...input.authNotes);
  const base: AlertBucket = input.assignedToId ? therapy.status : 'unassigned';
  const inactive =
    (base === 'overdue' || base === 'no_sessions' || base === 'unassigned') &&
    isLikelyInactive(input.lastContact, { therapy: therapy.nextScheduled, medManagement: medManagement.nextScheduled }, now);
  return {
    clientId: input.clientId,
    clientName: input.clientName,
    locked: input.locked,
    assignedToId: input.assignedToId,
    assignedToName: input.assignedToName,
    locationId: input.locationId,
    locationName: input.locationName,
    riskLevel: input.riskLevel,
    therapy,
    medManagement,
    bucket: inactive ? 'likely_inactive' : base,
    ...(input.lastContact !== undefined ? { lastContact: input.lastContact } : {}),
    dataNotes,
  };
}

export type SessionFrequencySummary = Record<AlertBucket, number> & { total: number };

/** The alert count. Always computed from the same items the list shows. */
export function summarizeSessionFrequency(items: SessionFrequencyItem[]): SessionFrequencySummary {
  const summary: SessionFrequencySummary = {
    total: items.length,
    overdue: 0,
    due_soon: 0,
    scheduled: 0,
    on_track: 0,
    no_sessions: 0,
    not_tracked: 0,
    unassigned: 0,
    likely_inactive: 0,
  };
  for (const item of items) summary[item.bucket] += 1;
  return summary;
}

/** Sort for the alert list: most days overdue first, then name */
export function sortSessionFrequencyItems(items: SessionFrequencyItem[]) {
  return [...items].sort(
    (a, b) => b.therapy.daysOverdue - a.therapy.daysOverdue || a.clientName.localeCompare(b.clientName)
  );
}

// ─── Scope and evidence assembly (pure; used by the loader) ────────────────────

/**
 * Clients the alert covers: active clients in the org (caseload roles: only their own),
 * optionally one location or one client. Discharged / inactive clients are excluded.
 */
export function sessionFrequencyClientWhere(
  actor: { organizationId: string; actorUserId: string; actorRole: Role },
  opts: { clientId?: string; locationId?: string; clientIds?: string[] } = {}
): Prisma.ClientWhereInput {
  const and: Prisma.ClientWhereInput[] = [
    clientAccessWhere(actor),
    { status: 'ACTIVE' },
  ];
  if (opts.locationId) and.push({ locationId: opts.locationId });
  if (opts.clientId) and.push({ id: opts.clientId });
  if (opts.clientIds) and.push({ id: { in: opts.clientIds } });
  return { AND: and };
}

export type AppointmentRow = {
  id: string;
  type: string;
  notes: string | null;
  status: string;
  startsAt: Date;
  claimCpts: string[];
};
export type NoteRow = { cptCode: string | null; dateOfService: Date | null; createdAt: Date };
export type ChargeRow = { serviceDate: Date | null; codeBase: string | null; billingId: string | null; amountCents: number };

/** Turns one client's rows into attended evidence, future visits and the not-counted tallies */
export function assembleClientEvidence(
  rows: { appointments: AppointmentRow[]; notes: NoteRow[]; charges: ChargeRow[] },
  now: Date
) {
  const evidence: SessionEvidence[] = [];
  const scheduled: ScheduledVisit[] = [];
  const pendingPast: Date[] = [];
  const unknownAttended: Date[] = [];

  for (const a of rows.appointments) {
    const serviceType = appointmentServiceType(a);
    if (a.startsAt > now) {
      if (a.status === 'SCHEDULED') scheduled.push({ at: a.startsAt, serviceType, appointmentId: a.id });
      continue;
    }
    if ((ATTENDED_APPOINTMENT_STATUSES as readonly string[]).includes(a.status)) {
      if (serviceType === 'unknown') unknownAttended.push(a.startsAt);
      else evidence.push({ at: a.startsAt, serviceType, source: 'appointment' });
    } else if (a.status === 'SCHEDULED') {
      // Past and never checked out: a claim proves it happened, otherwise unconfirmed
      if (a.claimCpts.length && serviceType !== 'unknown') {
        evidence.push({ at: a.startsAt, serviceType, source: 'claim' });
      } else {
        pendingPast.push(a.startsAt);
      }
    }
    // CANCELLED, NO_SHOW, LATE_CANCEL never count
  }

  for (const n of rows.notes) {
    const serviceType = serviceTypeForCpt(n.cptCode);
    if (serviceType === 'unknown') continue;
    const at = n.dateOfService ? parseDateOnly(n.dateOfService.toISOString().slice(0, 10)) : n.createdAt;
    evidence.push({ at, serviceType, source: 'signed_note' });
  }

  // Valant charges: net per claim line so a reversed charge does not count
  const net = new Map<string, { at: Date; code: string; cents: number }>();
  for (const c of rows.charges) {
    if (!c.serviceDate || !c.codeBase) continue;
    const key = `${c.billingId ?? ''}|${c.serviceDate.toISOString().slice(0, 10)}|${c.codeBase}`;
    const cur = net.get(key) ?? { at: c.serviceDate, code: c.codeBase, cents: 0 };
    cur.cents += c.amountCents;
    net.set(key, cur);
  }
  for (const v of net.values()) {
    if (v.cents <= 0) continue;
    const serviceType = serviceTypeForCpt(v.code);
    if (serviceType === 'unknown') continue;
    evidence.push({ at: v.at, serviceType, source: 'valant_charge' });
  }

  // A day with other proof is not "unconfirmed" or "unknown"
  const provenDays = new Set(evidence.map((e) => dayOf(e.at)));
  const unconfirmedPastAppointments = new Set(pendingPast.map((d) => dayOf(d)).filter((d) => !provenDays.has(d))).size;
  const unknownTypeVisits = new Set(unknownAttended.map((d) => dayOf(d)).filter((d) => !provenDays.has(d))).size;

  return { evidence, scheduled, unconfirmedPastAppointments, unknownTypeVisits };
}

/** Authorizations that exist but cannot set a therapy frequency, explained */
export function authorizationNotes(auths: AuthInput[], now: Date): string[] {
  return auths
    .filter((a) => a.status === 'APPROVED' && (!a.endDate || a.endDate >= now) && authVisitsPerWeek(a, now) == null)
    .map((a) => {
      const id = `Authorization ${a.authNumber || '(no number)'} (${a.payer})`;
      if (!a.cptCodes.length) return `${id}: ${a.unitsApproved} visits approved with no CPT codes on file — not used to set therapy frequency`;
      if (!a.cptCodes.some((c) => serviceTypeForCpt(c) === 'therapy')) return `${id}: covers ${a.cptCodes.join(', ')} — not individual therapy`;
      return `${id}: no usable start/end dates — not used to set therapy frequency`;
    });
}

/** Protected (Part 2 / sensitive) rows without access: keep the alert status, drop the details */
export function redactLockedItem(item: SessionFrequencyItem): SessionFrequencyItem {
  if (!item.locked) return item;
  const blank = (c: ServiceCadence): ServiceCadence => ({
    ...c,
    recommendation: { ...c.recommendation, sourceDetail: 'Protected record — open the chart to view', sourceId: null },
    lastAttended: null,
    daysSinceLast: null,
    dueBy: null,
    overdueAfter: null,
    nextScheduled: null,
    nextScheduledAppointmentId: null,
    sessionsLast8Weeks: 0,
    sessionsPerWeek: 0,
    statusDetail: 'Protected record — open the chart to view',
  });
  const { lastContact: _lastContact, ...rest } = item;
  void _lastContact;
  return { ...rest, therapy: blank(item.therapy), medManagement: blank(item.medManagement), dataNotes: [] };
}

export type ClinicianCadenceRow = {
  id: string;
  name: string;
  counts: Record<AlertBucket, number>;
  total: number;
  /** (on track + scheduled) / tracked clients */
  compliancePct: number;
};

/** Per assigned clinician counts, from the same items as the summary */
export function summarizeByClinician(items: SessionFrequencyItem[]): ClinicianCadenceRow[] {
  const rows = new Map<string, Omit<ClinicianCadenceRow, 'compliancePct'>>();
  for (const item of items) {
    if (!item.assignedToId) continue;
    const row = rows.get(item.assignedToId) ?? {
      id: item.assignedToId,
      name: item.assignedToName || 'Clinician',
      counts: { overdue: 0, due_soon: 0, scheduled: 0, on_track: 0, no_sessions: 0, not_tracked: 0, unassigned: 0, likely_inactive: 0 },
      total: 0,
    };
    row.counts[item.bucket] += 1;
    row.total += 1;
    rows.set(item.assignedToId, row);
  }
  return [...rows.values()]
    .map((r) => {
      // Likely-inactive clients are a discharge review, not a cadence miss
      const tracked = r.total - r.counts.not_tracked - r.counts.likely_inactive;
      return { ...r, compliancePct: tracked ? Math.round(((r.counts.on_track + r.counts.scheduled) / tracked) * 100) : 100 };
    })
    .sort((a, b) => b.counts.overdue - a.counts.overdue || a.name.localeCompare(b.name));
}
