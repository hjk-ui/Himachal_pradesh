/**
 * Authorization forecast: shared types and labels (no imports, safe for client components).
 * The math lives in forecast.ts; the loader in data.ts.
 */

export type AuthForecastStatus = 'on_track' | 'runs_out' | 'expiring_soon' | 'expired' | 'no_usage';

export type AuthForecast = {
  priorAuthId: string;
  clientId: string;
  source: 'valant' | 'native';
  payer: string;
  authNumber: string | null;
  cptCodes: string[];
  /** Clinic day (YYYY-MM-DD) the forecast was computed for */
  today: string;
  startDate: string | null;
  endDate: string | null;
  /** Whole days from today to the end date (0 = ends today); null when open-ended */
  daysToEnd: number | null;

  unitsApproved: number;
  /** PriorAuth.unitsUsed as recorded (Valant import or "Use units") */
  unitsRecorded: number;
  /** Attended visit days since the auth start that match the auth's service */
  visitsAttended: number;
  /** max(recorded, attended): the two count the same visits, so they are never added */
  visitsUsed: number;
  usedSource: 'recorded' | 'attended' | 'both' | 'none';
  remaining: number;

  /** Attended visits per week over the pace window */
  pacePerWeek: number;
  paceVisits: number;
  paceWindowDays: number;
  /** Future SCHEDULED visits that match the service, inside the auth window */
  scheduledInWindow: number;
  nextScheduled: string | null;

  /** First day the remaining visits are projected to be used (null = not within any projection) */
  projectedRunOut: string | null;
  runOutBasis: 'used_up' | 'scheduled' | 'pace' | null;
  /** Earlier of projected run-out and end date: the last day the auth is expected to cover */
  coverageEnd: string | null;

  planReviewDue: string | null;
  planEnd: string | null;
  /** Coverage ends before the treatment plan review / end date */
  coverageEndsBeforePlan: boolean | null;

  leadTimeDays: number;
  leadTimeSource: string;
  /** coverageEnd minus the payer lead time */
  renewBy: string | null;
  renewalDue: boolean;

  status: AuthForecastStatus;
  atRisk: boolean;
  statusLabel: string;
  statusDetail: string;
  /** Last "[renewal-drafted:YYYY-MM-DD]" marker in the auth's notes */
  renewalDraftedAt: string | null;
};

export type AuthForecastSummary = Record<AuthForecastStatus, number> & { total: number; atRisk: number; renewalDue: number };

export const FORECAST_STATUS_META: Record<AuthForecastStatus, { label: string; tone: 'emerald' | 'rose' | 'amber' | 'slate' }> = {
  on_track: { label: 'On track', tone: 'emerald' },
  runs_out: { label: 'Will run out', tone: 'rose' },
  expiring_soon: { label: 'Expiring soon', tone: 'amber' },
  expired: { label: 'Expired', tone: 'slate' },
  no_usage: { label: 'No usage data', tone: 'slate' },
};

export const AT_RISK_STATUSES: readonly AuthForecastStatus[] = ['runs_out', 'expiring_soon', 'expired'];

/** Short date for UI: "Nov 3, 2026" from YYYY-MM-DD (no timezone shift) */
export function fmtForecastDay(day: string | null): string {
  if (!day) return '—';
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) return day;
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
