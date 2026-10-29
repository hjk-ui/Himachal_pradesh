/**
 * Authorization forecast — deterministic math only (no AI, no Prisma).
 *
 * For one APPROVED prior authorization:
 *   visitsUsed   = max(unitsUsed recorded on the auth, attended visit days since the auth start that
 *                  match the auth's service). Both count the same visits, so they are never summed.
 *   remaining    = unitsApproved − visitsUsed
 *   pace         = attended matching visit days in the last 8 weeks (or since the auth start, if later)
 *                  ÷ (window days ÷ 7); the window is at least 7 days so a brand-new auth is not inflated
 *   run-out      = the first day either (a) the scheduled visits inside the window reach `remaining`
 *                  or (b) the pace reaches it: today + ceil(remaining × 7 ÷ pace).
 *                  Projected visits by day D = max(scheduled by D, pace × days ÷ 7), so the earlier of
 *                  the two dates is the first day the projection reaches the remaining visits.
 *   coverageEnd  = earlier of run-out and the auth end date
 *   renewBy      = coverageEnd − payer lead time
 * Status (first that applies): expired → runs_out (run-out before end, or nothing left) →
 * expiring_soon (end within lead time + 7 days) → no_usage (no recorded, attended or scheduled visits,
 * or no approved unit count) → on_track.
 */
import { SESSION_FREQUENCY_RULES, dayOf, daysBetween, frequencyKeyFromPlanText, serviceTypeForCpt, type ServiceType } from '@/lib/clinical/sessionFrequency';
import { addCalendarDays } from '@/lib/workflows/dates';
import {
  AT_RISK_STATUSES,
  FORECAST_STATUS_META,
  fmtForecastDay,
  type AuthForecast,
  type AuthForecastStatus,
  type AuthForecastSummary,
} from './labels';

export * from './labels';

// ─── Configuration ─────────────────────────────────────────────────────────────

export const PACE_WINDOW_DAYS = 56;
export const MIN_PACE_WINDOW_DAYS = 7;
/** "Expiring soon" starts this many days before the renewal lead time is reached */
export const EXPIRING_SOON_EXTRA_DAYS = 7;
/** Clinic default when neither the payer rule nor AUTH_RENEWAL_LEAD_DAYS sets one */
export const DEFAULT_RENEWAL_LEAD_DAYS = 14;
/** Approved auths that ended within this many days still show (as expired) */
export const EXPIRED_LOOKBACK_DAYS = 30;

export type PayerLeadRule = { match: RegExp; days: number; label: string; source: string; verified: boolean };

/**
 * Payer renewal lead times. Maryland PBHS (Medicaid behavioral health, ASO = Carelon Behavioral Health
 * of Maryland, formerly Optum Maryland / Beacon): no published "submit N days before expiry" figure was
 * found; the clinic default is used until confirmed against Chapter 5 (Authorizations) of the current
 * Carelon Maryland PBHS Provider Manual. Set `verified: true` and the days once confirmed.
 */
export const PAYER_LEAD_RULES: PayerLeadRule[] = [
  {
    match: /\b(pbhs|carelon|beacon|optum\s*maryland|public\s+behavioral|maryland\s+medicaid|medicaid\s*\(md\)|md\s+medicaid)/i,
    days: DEFAULT_RENEWAL_LEAD_DAYS,
    label: 'Maryland PBHS (Carelon Behavioral Health of Maryland)',
    source: 'Clinic default; confirm in the Carelon Maryland PBHS Provider Manual, Chapter 5 (Authorizations)',
    verified: false,
  },
];

export type LeadTimeConfig = {
  /** AUTH_RENEWAL_LEAD_DAYS */
  defaultDays?: number;
  /** AUTH_RENEWAL_LEAD_DAYS_BY_PAYER: {"payer substring": days}, case-insensitive; wins over PAYER_LEAD_RULES */
  overrides?: Record<string, number>;
};

const validDays = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 180;

/** Parses the env settings; bad values fall back to defaults */
export function leadTimeConfigFromEnv(env: Record<string, string | undefined>): LeadTimeConfig {
  const d = Number(env.AUTH_RENEWAL_LEAD_DAYS);
  const cfg: LeadTimeConfig = {};
  if (env.AUTH_RENEWAL_LEAD_DAYS && validDays(d)) cfg.defaultDays = d;
  if (env.AUTH_RENEWAL_LEAD_DAYS_BY_PAYER) {
    try {
      const raw = JSON.parse(env.AUTH_RENEWAL_LEAD_DAYS_BY_PAYER) as Record<string, unknown>;
      const overrides: Record<string, number> = {};
      for (const [k, v] of Object.entries(raw ?? {})) if (k.trim() && validDays(v)) overrides[k.trim()] = v;
      cfg.overrides = overrides;
    } catch {
      // ignore malformed JSON
    }
  }
  return cfg;
}

export function renewalLeadTime(payer: string, cfg: LeadTimeConfig = {}): { days: number; source: string } {
  const p = String(payer ?? '');
  for (const [k, days] of Object.entries(cfg.overrides ?? {})) {
    if (p.toLowerCase().includes(k.toLowerCase())) return { days, source: `Practice setting for "${k}"` };
  }
  const rule = PAYER_LEAD_RULES.find((r) => r.match.test(p));
  if (rule) {
    const days = rule.verified ? rule.days : cfg.defaultDays ?? rule.days;
    return { days, source: `${rule.label}: ${rule.source}` };
  }
  if (cfg.defaultDays != null) return { days: cfg.defaultDays, source: 'Practice default (AUTH_RENEWAL_LEAD_DAYS)' };
  return { days: DEFAULT_RENEWAL_LEAD_DAYS, source: `Clinic default (${DEFAULT_RENEWAL_LEAD_DAYS} days)` };
}

// ─── Service matching ──────────────────────────────────────────────────────────

/**
 * Service types an auth covers, from its CPT codes.
 * - null: no codes on file (e.g. Valant imports that cover any service for the payer) → any attended visit counts.
 * - empty set: only HCPCS / non-CPT codes (H2017 PRP, H0004 …), which the visit evidence does not
 *   classify → no visit matches and the forecast relies on the units recorded on the auth.
 */
export function authServiceTypes(cptCodes: string[]): Set<ServiceType> | null {
  const codes = cptCodes.map((c) => String(c ?? '').trim()).filter(Boolean);
  if (!codes.length) return null;
  return new Set(codes.map(serviceTypeForCpt).filter((t) => t !== 'unknown'));
}

export function visitMatchesAuth(serviceType: ServiceType, types: Set<ServiceType> | null, opts: { scheduled?: boolean } = {}) {
  if (types) return types.has(serviceType);
  // Any-service auth: unknown-type future visits still count; unknown past visits have no proof of service
  return serviceType !== 'unknown' || Boolean(opts.scheduled);
}

// ─── Forecast ──────────────────────────────────────────────────────────────────

export type ForecastAuthInput = {
  id: string;
  clientId: string;
  payer: string;
  authNumber: string | null;
  cptCodes: string[];
  unitsApproved: number;
  unitsUsed: number;
  status: string;
  startDate: Date | null;
  endDate: Date | null;
  vendor: string | null;
  notes: string | null;
};

export type ForecastVisitsInput = {
  /** Attended clinic days (YYYY-MM-DD) that match the auth's service; duplicates are collapsed */
  attendedDays: string[];
  /** Future scheduled visit days that match the auth's service */
  scheduledDays: string[];
  /**
   * Billed units per attended service (e.g. 4 units of a 15-minute code on one day). Auths are
   * approved in units, so when given these are counted instead of attended days.
   */
  attendedUnits?: Array<{ day: string; units: number }>;
};

export type ForecastPlanInput = { reviewDue: string | null; planEnd: string | null } | null;

const dateDay = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const minDay = (...days: (string | null)[]) => days.filter((d): d is string => Boolean(d)).sort()[0] ?? null;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

const DRAFTED_RE = /\[renewal-drafted:(\d{4}-\d{2}-\d{2})\]/g;
export const renewalDraftedMarker = (day: string) => `[renewal-drafted:${day}]`;

export function lastRenewalDrafted(notes: string | null | undefined): string | null {
  const hits = [...String(notes ?? '').matchAll(DRAFTED_RE)].map((m) => m[1]).sort();
  return hits.length ? hits[hits.length - 1] : null;
}

export function computeAuthForecast(input: {
  auth: ForecastAuthInput;
  visits: ForecastVisitsInput;
  plan?: ForecastPlanInput;
  lead: { days: number; source: string };
  now: Date;
}): AuthForecast {
  const { auth, visits, lead, now } = input;
  const today = dayOf(now);
  const start = dateDay(auth.startDate);
  const end = dateDay(auth.endDate);
  const daysToEnd = end ? daysBetween(today, end) : null;

  // Visits used: attended days inside [start, min(today, end)]
  const lastCountable = minDay(today, end) as string;
  const attended = [...new Set(visits.attendedDays)].filter((d) => (!start || d >= start) && d <= lastCountable).sort();
  // PriorAuth.unitsUsed is kept by claim submission (units of matching lines), so it is units
  const recorded = Math.max(0, auth.unitsUsed || 0);
  const attendedUnitCount = visits.attendedUnits
    ? visits.attendedUnits.filter((v) => (!start || v.day >= start) && v.day <= lastCountable).reduce((t, v) => t + Math.max(0, v.units || 0), 0)
    : attended.length;
  const visitsUsed = Math.max(recorded, attendedUnitCount);
  const usedSource: AuthForecast['usedSource'] =
    visitsUsed === 0 ? 'none' : recorded === attendedUnitCount ? 'both' : recorded > attendedUnitCount ? 'recorded' : 'attended';
  const approved = Math.max(0, auth.unitsApproved || 0);
  const remaining = approved - visitsUsed;

  // Pace over the last 8 weeks, or since the auth start if that is later
  const eightWeeksStart = addCalendarDays(today, -(PACE_WINDOW_DAYS - 1));
  const windowStart = start && start > eightWeeksStart ? start : eightWeeksStart;
  const windowDays = Math.max(MIN_PACE_WINDOW_DAYS, start && start > today ? MIN_PACE_WINDOW_DAYS : daysBetween(windowStart, today) + 1);
  const paceVisits = attended.filter((d) => d >= windowStart && d <= today).length;
  const pacePerWeek = Math.round((paceVisits / (windowDays / 7)) * 100) / 100;

  // Scheduled visits inside the auth window
  const scheduled = [...new Set(visits.scheduledDays)].filter((d) => d > today && (!end || d <= end) && (!start || d >= start)).sort();

  // Projection
  let projectedRunOut: string | null = null;
  let runOutBasis: AuthForecast['runOutBasis'] = null;
  if (approved > 0) {
    if (remaining <= 0) {
      projectedRunOut = today;
      runOutBasis = 'used_up';
    } else {
      const bySchedule = scheduled.length >= remaining ? scheduled[remaining - 1] : null;
      const byPace = pacePerWeek > 0 ? addCalendarDays(today, Math.ceil((remaining * 7) / pacePerWeek)) : null;
      if (bySchedule && (!byPace || bySchedule <= byPace)) {
        projectedRunOut = bySchedule;
        runOutBasis = 'scheduled';
      } else if (byPace) {
        projectedRunOut = byPace;
        runOutBasis = 'pace';
      }
    }
  }
  const runsOutEarly = projectedRunOut != null && (remaining <= 0 || !end || projectedRunOut < end);
  const coverageEnd = minDay(runsOutEarly ? projectedRunOut : null, end);

  // Treatment plan comparison
  const planDate = minDay(input.plan?.reviewDue ?? null, input.plan?.planEnd ?? null);
  const coverageEndsBeforePlan = planDate && coverageEnd ? coverageEnd < planDate : null;

  const renewBy = coverageEnd ? addCalendarDays(coverageEnd, -lead.days) : null;
  const renewalDue = renewBy != null && renewBy <= today;

  // Status
  const noUsage = visitsUsed === 0 && scheduled.length === 0;
  let status: AuthForecastStatus;
  let detail: string;
  if (end && end < today) {
    status = 'expired';
    detail = `Ended ${fmtForecastDay(end)} (${plural(-daysToEnd!, 'day')} ago) with ${plural(Math.max(remaining, 0), 'visit')} unused`;
  } else if (approved > 0 && runsOutEarly) {
    status = 'runs_out';
    detail =
      remaining <= 0
        ? `All ${approved} approved visits used${end ? `; auth runs to ${fmtForecastDay(end)}` : ''}`
        : `Projected to run out ${fmtForecastDay(projectedRunOut)}${end ? `, ${plural(daysBetween(projectedRunOut!, end), 'day')} before the auth ends ${fmtForecastDay(end)}` : ' (open-ended auth)'} — ${runOutBasis === 'scheduled' ? 'scheduled visits use the remaining units' : `at ${pacePerWeek}/week`}`;
  } else if (end && daysToEnd! <= lead.days + EXPIRING_SOON_EXTRA_DAYS) {
    status = 'expiring_soon';
    detail = `Ends ${fmtForecastDay(end)} (${daysToEnd === 0 ? 'today' : `in ${plural(daysToEnd!, 'day')}`}); ${plural(Math.max(remaining, 0), 'visit')} left`;
  } else if (approved <= 0) {
    status = 'no_usage';
    detail = 'No approved visit count on file; cannot project';
  } else if (noUsage) {
    status = 'no_usage';
    detail = 'No visits recorded, attended or scheduled since the auth started';
  } else {
    status = 'on_track';
    detail = projectedRunOut
      ? `${plural(remaining, 'visit')} left; at ${pacePerWeek}/week lasts to ${fmtForecastDay(projectedRunOut)}${end ? `, after the end date ${fmtForecastDay(end)}` : ''}`
      : `${plural(remaining, 'visit')} left; no recent pace to project`;
  }
  if (renewalDue && status !== 'expired') detail += `. Renewal due${renewBy! < today ? ` since ${fmtForecastDay(renewBy)}` : ' today'} (${lead.days}-day lead time)`;
  if (coverageEndsBeforePlan) detail += `. Coverage ends before the treatment plan ${input.plan?.reviewDue === planDate ? 'review' : 'end'} (${fmtForecastDay(planDate)})`;

  return {
    priorAuthId: auth.id,
    clientId: auth.clientId,
    source: auth.vendor === 'valant' ? 'valant' : 'native',
    payer: auth.payer,
    authNumber: auth.authNumber,
    cptCodes: auth.cptCodes,
    today,
    startDate: start,
    endDate: end,
    daysToEnd,
    unitsApproved: approved,
    unitsRecorded: recorded,
    visitsAttended: attended.length,
    visitsUsed,
    usedSource,
    remaining,
    pacePerWeek,
    paceVisits,
    paceWindowDays: windowDays,
    scheduledInWindow: scheduled.length,
    nextScheduled: scheduled[0] ?? null,
    projectedRunOut,
    runOutBasis,
    coverageEnd,
    planReviewDue: input.plan?.reviewDue ?? null,
    planEnd: input.plan?.planEnd ?? null,
    coverageEndsBeforePlan,
    leadTimeDays: lead.days,
    leadTimeSource: lead.source,
    renewBy,
    renewalDue,
    status,
    atRisk: AT_RISK_STATUSES.includes(status),
    statusLabel: FORECAST_STATUS_META[status].label,
    statusDetail: detail,
    renewalDraftedAt: lastRenewalDrafted(auth.notes),
  };
}

export function summarizeForecasts(items: AuthForecast[]): AuthForecastSummary {
  const s: AuthForecastSummary = { on_track: 0, runs_out: 0, expiring_soon: 0, expired: 0, no_usage: 0, total: items.length, atRisk: 0, renewalDue: 0 };
  for (const f of items) {
    s[f.status] += 1;
    if (f.atRisk) s.atRisk += 1;
    if (f.renewalDue && f.status !== 'expired') s.renewalDue += 1;
  }
  return s;
}

const STATUS_ORDER: AuthForecastStatus[] = ['runs_out', 'expiring_soon', 'expired', 'no_usage', 'on_track'];
export function sortForecasts(items: AuthForecast[]) {
  return [...items].sort(
    (a, b) =>
      STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) ||
      (a.coverageEnd ?? '9999-12-31').localeCompare(b.coverageEnd ?? '9999-12-31')
  );
}

// ─── Requested units (renewal) ─────────────────────────────────────────────────

/** Visits per week for each treatment plan frequency (daily = 5 clinic days) */
const PLAN_VISITS_PER_WEEK: Record<string, number> = {
  daily: 5,
  '3x_week': 3,
  '2x_week': 2,
  weekly: 1,
  biweekly: 0.5,
  monthly: 12 / 52,
};

export type RenewalRequest = {
  visitsPerWeek: number;
  frequencyLabel: string;
  frequencySource: 'treatment_plan' | 'pace' | 'current_auth' | 'default';
  periodStart: string;
  periodEnd: string;
  periodDays: number;
  units: number;
  /** Runs out before the end date: visits still needed from run-out to the current end date */
  additionalThroughCurrentEnd: number | null;
};

const EXPECTED_DURATION_DAYS: Record<string, number> = { '30 days': 30, '60 days': 60, '90 days': 90, '180 days': 180, '365 days': 365 };
export const expectedDurationDays = (text: string | null | undefined) => EXPECTED_DURATION_DAYS[String(text ?? '').trim()] ?? null;

export function renewalRequest(
  f: AuthForecast,
  plan: { serviceFrequency: string | null; expectedDuration: string | null } | null
): RenewalRequest {
  const key = frequencyKeyFromPlanText(plan?.serviceFrequency);
  let visitsPerWeek: number;
  let frequencyLabel: string;
  let frequencySource: RenewalRequest['frequencySource'];
  const authDays = f.startDate && f.endDate ? daysBetween(f.startDate, f.endDate) + 1 : null;
  if (key && key !== 'as_needed') {
    visitsPerWeek = PLAN_VISITS_PER_WEEK[key];
    frequencyLabel = `${SESSION_FREQUENCY_RULES[key].label} (treatment plan)`;
    frequencySource = 'treatment_plan';
  } else if (f.pacePerWeek > 0) {
    visitsPerWeek = f.pacePerWeek;
    frequencyLabel = `${f.pacePerWeek}/week (current 8-week pace)`;
    frequencySource = 'pace';
  } else if (authDays && authDays >= 7 && f.unitsApproved > 0) {
    visitsPerWeek = Math.round((f.unitsApproved / (authDays / 7)) * 100) / 100;
    frequencyLabel = `${visitsPerWeek}/week (current authorization rate)`;
    frequencySource = 'current_auth';
  } else {
    visitsPerWeek = 1;
    frequencyLabel = 'Weekly (clinic default)';
    frequencySource = 'default';
  }

  const periodStart = f.endDate && f.endDate >= f.today ? addCalendarDays(f.endDate, 1) : f.today;
  const periodDays = authDays && authDays >= 28 && authDays <= 366 ? authDays : expectedDurationDays(plan?.expectedDuration) ?? 90;
  const periodEnd = addCalendarDays(periodStart, periodDays - 1);
  const units = Math.max(1, Math.ceil((visitsPerWeek * periodDays) / 7));
  const additionalThroughCurrentEnd =
    f.status === 'runs_out' && f.endDate && f.projectedRunOut && f.projectedRunOut < f.endDate
      ? Math.max(1, Math.ceil((visitsPerWeek * daysBetween(f.projectedRunOut, f.endDate)) / 7))
      : null;
  return { visitsPerWeek, frequencyLabel, frequencySource, periodStart, periodEnd, periodDays, units, additionalThroughCurrentEnd };
}

// ─── Inbox ─────────────────────────────────────────────────────────────────────

/** Inbox title and priority for an at-risk (or renewal-due) forecast; null when nothing to do */
export function forecastInboxItem(f: AuthForecast): { title: string; priority: 'urgent' | 'high' | 'normal' } | null {
  if (!f.atRisk && !f.renewalDue) return null;
  const left = `${Math.max(f.remaining, 0)} of ${f.unitsApproved} visits left`;
  let title: string;
  if (f.status === 'expired') title = `Authorization ended ${fmtForecastDay(f.endDate)}`;
  else if (f.status === 'runs_out') title = f.remaining <= 0 ? `Authorization visits used up (${f.unitsApproved})` : `Authorization projected to run out ${fmtForecastDay(f.projectedRunOut)}, ${left}`;
  else if (f.status === 'expiring_soon') title = `Authorization ends ${fmtForecastDay(f.endDate)}, ${left}`;
  else title = `Authorization renewal due by ${fmtForecastDay(f.renewBy)}`;
  if (f.renewalDraftedAt) title += ` (renewal drafted ${fmtForecastDay(f.renewalDraftedAt)})`;
  const priority =
    f.status === 'expired' || f.remaining <= 0
      ? 'urgent'
      : (f.status === 'runs_out' && f.renewalDue) || (f.daysToEnd != null && f.daysToEnd <= 7)
        ? 'high'
        : 'normal';
  return { title, priority };
}
