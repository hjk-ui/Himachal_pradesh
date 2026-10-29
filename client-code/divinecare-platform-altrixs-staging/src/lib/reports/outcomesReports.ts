/**
 * Outcomes & Reports (/dashboard/reports/outcomes): pure aggregation for GET /api/reports/outcomes.
 *
 * Everything here works on rows / groupBy results the route already loaded, so it is unit tested
 * without a database. Rules the owner set: no fabricated numbers. A metric without data is null
 * (shown as "no data"), never 0 standing in for "unknown"; rates carry their numerator and denominator.
 */
import type { Prisma, Role } from '@prisma/client';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { isCaseloadScoped } from '@/lib/auth/medicalDirector';
import { toCsv } from '@/lib/browser/downloadFile';
import { splitPayers } from '@/lib/migration/valantTransactionJournal';

export const REPORTS_PATH = '/dashboard/reports/outcomes';
export const REPORT_TZ = 'America/New_York';
export const REPORT_TABS = ['clinical', 'quality', 'financial', 'utilization', 'medications'] as const;
export type ReportTab = (typeof REPORT_TABS)[number];

const DAY_MS = 86_400_000;
export const FOLLOW_UP_MIN_DAYS = 28;
export const DEFAULT_RANGE_DAYS = 90;
export const MAX_RANGE_DAYS = 3 * 366;
/** Response / remission are only judged for clients who started at moderate or worse (score ≥ 10). */
export const ELEVATED_BASELINE = 10;
export const REMISSION_BELOW = 5;

// ─── Filters ─────────────────────────────────────────────────────────────────

export type ReportFilters = {
  /** YYYY-MM-DD, inclusive, clinic time zone */
  fromDate: string;
  toDate: string;
  from: Date;
  /** start of the day after toDate (queries use lt) */
  toExclusive: Date;
  locationId: string | null;
  clinicianId: string | null;
  tab: ReportTab;
  format: 'json' | 'csv';
};

function tzOffsetMs(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - at.getTime();
}

/** Midnight of a calendar day in the clinic time zone, as a UTC instant. */
export function zonedStartOfDay(ymd: string, tz: string = REPORT_TZ): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  return new Date(guess - tzOffsetMs(new Date(guess), tz));
}

/** Calendar date (YYYY-MM-DD) of an instant in the clinic time zone. */
export function zonedYmd(at: Date, tz: string = REPORT_TZ): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

/** YYYY-MM of an instant in the clinic time zone. */
export function monthKey(at: Date, tz: string = REPORT_TZ): string {
  return zonedYmd(at, tz).slice(0, 7);
}

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}

function validYmd(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function parseReportFilters(
  sp: URLSearchParams,
  now: Date
): { ok: true; filters: ReportFilters } | { ok: false; error: string } {
  const fromRaw = (sp.get('from') ?? '').trim();
  const toRaw = (sp.get('to') ?? '').trim();
  if (fromRaw && !validYmd(fromRaw)) return { ok: false, error: 'from must be YYYY-MM-DD' };
  if (toRaw && !validYmd(toRaw)) return { ok: false, error: 'to must be YYYY-MM-DD' };
  const toDate = toRaw || zonedYmd(now);
  const fromDate = fromRaw || addDaysYmd(toDate, -(DEFAULT_RANGE_DAYS - 1));
  if (fromDate > toDate) return { ok: false, error: 'from must be on or before to' };
  const from = zonedStartOfDay(fromDate);
  const toExclusive = zonedStartOfDay(addDaysYmd(toDate, 1));
  if (toExclusive.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY_MS) {
    return { ok: false, error: 'Date range is limited to 3 years' };
  }
  const locationId = (sp.get('location') ?? '').trim() || null;
  const clinicianId = (sp.get('clinician') ?? '').trim() || null;
  if (locationId && !ID_RE.test(locationId)) return { ok: false, error: 'Invalid location' };
  if (clinicianId && !ID_RE.test(clinicianId)) return { ok: false, error: 'Invalid clinician' };
  const tabRaw = (sp.get('tab') ?? '').trim() || 'clinical';
  if (!(REPORT_TABS as readonly string[]).includes(tabRaw)) return { ok: false, error: 'Unknown tab' };
  const formatRaw = (sp.get('format') ?? '').trim() || 'json';
  if (formatRaw !== 'json' && formatRaw !== 'csv') return { ok: false, error: 'format must be json or csv' };
  return {
    ok: true,
    filters: {
      fromDate, toDate, from, toExclusive, locationId, clinicianId,
      tab: tabRaw as ReportTab, format: formatRaw,
    },
  };
}

// ─── Scope (org + caseload + location + clinician + Part 2) ──────────────────

export type ReportScope = {
  organizationId: string;
  userId: string;
  role: string;
  locationId: string | null;
  clinicianId: string | null;
  /** Sensitive (Part 2 / protected) clients this viewer may not open — excluded everywhere */
  lockedClientIds: string[];
  /** Valant facility text the location filter matches (location city, else name) */
  facilityTerm: string | null;
};

/** Caseload roles report on their own clients; a verified Medical Director on the organization. */
export function isCaseloadScope(scope: Pick<ReportScope, 'role' | 'userId' | 'organizationId'>): boolean {
  return isCaseloadScoped({ role: scope.role, userId: scope.userId, organizationId: scope.organizationId });
}

/**
 * Clients the viewer may report on. Org scope always; caseload roles only their assigned clients;
 * location filter on the client's home location; locked sensitive clients removed.
 * byAssignee: also apply the clinician filter as "assigned clinician" (client-centric metrics).
 */
export function reportClientWhere(scope: ReportScope, opts: { byAssignee: boolean }): Prisma.ClientWhereInput {
  const and: Prisma.ClientWhereInput[] = [
    clientAccessWhere({ organizationId: scope.organizationId, actorUserId: scope.userId, actorRole: scope.role as Role }),
  ];
  if (scope.locationId) and.push({ locationId: scope.locationId });
  if (opts.byAssignee && scope.clinicianId) and.push({ assignedToId: scope.clinicianId });
  if (scope.lockedClientIds.length) and.push({ id: { notIn: scope.lockedClientIds } });
  return { AND: and };
}

/**
 * Imported Valant transactions in range (by date of service). Leadership also sees rows Valant could not
 * match to a client (org-level money); caseload roles only rows on their own clients.
 */
export function valantReportWhere(
  scope: ReportScope,
  range: { from: Date; toExclusive: Date }
): Prisma.ValantTransactionWhereInput {
  const and: Prisma.ValantTransactionWhereInput[] = [
    { organizationId: scope.organizationId },
    { serviceDate: { gte: range.from, lt: range.toExclusive } },
  ];
  if (isCaseloadScope(scope)) {
    and.push({
      client: clientAccessWhere({ organizationId: scope.organizationId, actorUserId: scope.userId, actorRole: scope.role as Role }),
    });
  }
  if (scope.lockedClientIds.length) {
    and.push({ OR: [{ clientId: null }, { clientId: { notIn: scope.lockedClientIds } }] });
  }
  if (scope.clinicianId) and.push({ providerUserId: scope.clinicianId });
  if (scope.facilityTerm) and.push({ facility: { contains: scope.facilityTerm, mode: 'insensitive' } });
  return { AND: and };
}

// ─── Small helpers ───────────────────────────────────────────────────────────

export type Rate = { numerator: number; denominator: number; pct: number | null };

export function rate(numerator: number, denominator: number): Rate {
  return { numerator, denominator, pct: denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : null };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function avg(values: number[]): number | null {
  return values.length ? round1(values.reduce((s, v) => s + v, 0) / values.length) : null;
}

// ─── Overview ────────────────────────────────────────────────────────────────

export type AppointmentStatusSummary = {
  total: number;
  scheduled: number;
  completed: number;
  noShow: number;
  cancelled: number;
  lateCancel: number;
  /** no-shows ÷ (completed + no-shows) */
  noShowRate: Rate;
};

export function summarizeAppointmentStatuses(groups: { status: string; count: number }[]): AppointmentStatusSummary {
  const by = (s: string[]) => groups.filter((g) => s.includes(g.status)).reduce((n, g) => n + g.count, 0);
  const completed = by(['COMPLETED']);
  const noShow = by(['NO_SHOW']);
  return {
    total: groups.reduce((n, g) => n + g.count, 0),
    scheduled: by(['SCHEDULED', 'CHECKED_IN', 'IN_SESSION']),
    completed,
    noShow,
    cancelled: by(['CANCELLED']),
    lateCancel: by(['LATE_CANCEL']),
    noShowRate: rate(noShow, completed + noShow),
  };
}

export type ClaimStatusSummary = {
  total: number;
  draft: number;
  billed: number;
  billedCents: number;
  paid: number;
  paidCents: number;
  denied: number;
};

const BILLED_STATUSES = ['SUBMITTED', 'ACCEPTED', 'DENIED', 'PAID'];

export function summarizeClaims(
  groups: { status: string; count: number; amountCents: number | null; paidAmount: number | null }[]
): ClaimStatusSummary {
  const out: ClaimStatusSummary = { total: 0, draft: 0, billed: 0, billedCents: 0, paid: 0, paidCents: 0, denied: 0 };
  for (const g of groups) {
    out.total += g.count;
    if (g.status === 'DRAFT' || g.status === 'READY') out.draft += g.count;
    if (BILLED_STATUSES.includes(g.status)) {
      out.billed += g.count;
      out.billedCents += g.amountCents ?? 0;
    }
    if (g.status === 'PAID') {
      out.paid += g.count;
      out.paidCents += Math.round((g.paidAmount ?? 0) * 100);
    }
    if (g.status === 'DENIED') out.denied += g.count;
  }
  return out;
}

/**
 * Valant money buckets. Valant stores payments and credits NEGATIVE; these are shown positive
 * ("collected", "adjusted") so they read like Valant's own reports. fees = no-show / late-cancel fees.
 */
export type ValantMoney = {
  rows: number;
  chargeCount: number;
  chargesCents: number;
  feesCents: number;
  insurancePaymentsCents: number;
  patientPaymentsCents: number;
  adjustmentsCents: number;
  otherCents: number;
};

export function emptyValantMoney(): ValantMoney {
  return { rows: 0, chargeCount: 0, chargesCents: 0, feesCents: 0, insurancePaymentsCents: 0, patientPaymentsCents: 0, adjustmentsCents: 0, otherCents: 0 };
}

export function addValantGroup(m: ValantMoney, g: { category: string; cents: number; count: number }): void {
  m.rows += g.count;
  switch (g.category) {
    case 'charge':
      m.chargeCount += g.count;
      m.chargesCents += g.cents;
      break;
    case 'fee':
      m.feesCents += g.cents;
      break;
    case 'insurance_payment':
      m.insurancePaymentsCents -= g.cents;
      break;
    case 'patient_payment':
      m.patientPaymentsCents -= g.cents;
      break;
    case 'insurance_adjustment':
    case 'patient_adjustment':
      m.adjustmentsCents -= g.cents;
      break;
    default:
      // transfers move money between dates of service; "other" = codes the import could not classify
      m.otherCents += g.cents;
  }
}

export type ValantGroup = { key: string | null; category: string; cents: number; count: number };

/** Fold groupBy(key × category) rows into one money row per key, largest charges first. */
export function foldValantByKey(
  groups: ValantGroup[],
  keyOf: (raw: string | null) => string
): (ValantMoney & { key: string })[] {
  const map = new Map<string, ValantMoney & { key: string }>();
  for (const g of groups) {
    const key = keyOf(g.key);
    const row = map.get(key) ?? { key, ...emptyValantMoney() };
    addValantGroup(row, g);
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => b.chargesCents - a.chargesCents || a.key.localeCompare(b.key));
}

export const NO_PAYER = 'No insurance listed (self-pay or blank)';
export const NO_FACILITY = 'No facility on row';

/** Valant's insurance cell lists payers comma-joined; the report credits the first one listed. */
export function firstPayer(raw: string | null): string {
  return splitPayers(raw)[0] ?? NO_PAYER;
}

// ─── Clinical outcomes (PHQ-9 / GAD-7) ───────────────────────────────────────

export type InstrumentSpec = {
  id: string;
  label: string;
  max: number;
  bands: { min: number; max: number; label: string }[];
};

export const PHQ9: InstrumentSpec = {
  id: 'phq-9', label: 'PHQ-9', max: 27,
  bands: [
    { min: 0, max: 4, label: 'Minimal (0–4)' },
    { min: 5, max: 9, label: 'Mild (5–9)' },
    { min: 10, max: 14, label: 'Moderate (10–14)' },
    { min: 15, max: 19, label: 'Moderately severe (15–19)' },
    { min: 20, max: 27, label: 'Severe (20–27)' },
  ],
};

export const GAD7: InstrumentSpec = {
  id: 'gad-7', label: 'GAD-7', max: 21,
  bands: [
    { min: 0, max: 4, label: 'Minimal (0–4)' },
    { min: 5, max: 9, label: 'Mild (5–9)' },
    { min: 10, max: 14, label: 'Moderate (10–14)' },
    { min: 15, max: 21, label: 'Severe (15–21)' },
  ],
};

export type ScorePoint = { clientId: string; score: number; at: Date };

export type OutcomeStatus = 'Remission' | 'Response' | 'Improving' | 'No change' | 'Worsening' | 'Under 4 weeks' | 'Baseline only';

export type ClientInstrumentOutcome = {
  clientId: string;
  baseline: number;
  baselineAt: string;
  latest: number;
  latestAt: string;
  scores: number;
  /** latest − baseline (negative = improvement) */
  change: number;
  daysBetween: number;
  /** ≥ 2 scores with latest ≥ 28 days after baseline */
  followUpEligible: boolean;
  /** followUpEligible and baseline ≥ 10 */
  elevatedBaseline: boolean;
  response: boolean | null;
  remission: boolean | null;
  status: OutcomeStatus;
  severity: string;
};

export type InstrumentOutcomes = {
  instrument: string;
  /** clients with ≥ 1 score in the period */
  clientsMeasured: number;
  scoresInPeriod: number;
  invalidScoresDropped: number;
  /** measured clients with a baseline→latest pair ≥ 28 days apart */
  clientsWithFollowUp: number;
  /** of those, baseline ≥ 10 — the denominator for response / remission */
  clientsElevatedBaseline: number;
  response: Rate;
  remission: Rate;
  avgBaseline: number | null;
  avgLatest: number | null;
  /** mean (latest − baseline) over clientsWithFollowUp */
  avgChange: number | null;
  monthlyTrend: { month: string; avg: number; n: number }[];
  severity: { label: string; clients: number }[];
  clients: ClientInstrumentOutcome[];
};

export function severityBand(spec: InstrumentSpec, score: number): string {
  return spec.bands.find((b) => score >= b.min && score <= b.max)?.label ?? 'Out of range';
}

/**
 * Baseline = the client's FIRST recorded score (any date before the period end), latest = the most
 * recent score before the period end. Only clients with a score inside the period are reported.
 * Response = latest ≤ 50 % of baseline; remission = latest < 5; both judged only when the pair is
 * ≥ 28 days apart and the baseline was ≥ 10.
 */
export function computeInstrumentOutcomes(
  points: ScorePoint[],
  spec: InstrumentSpec,
  range: { from: Date; toExclusive: Date }
): InstrumentOutcomes {
  let invalid = 0;
  const byClient = new Map<string, ScorePoint[]>();
  for (const p of points) {
    if (!Number.isFinite(p.score) || p.score < 0 || p.score > spec.max) {
      invalid++;
      continue;
    }
    if (p.at >= range.toExclusive) continue;
    const list = byClient.get(p.clientId) ?? [];
    list.push(p);
    byClient.set(p.clientId, list);
  }
  const inPeriod = (p: ScorePoint) => p.at >= range.from && p.at < range.toExclusive;

  const clients: ClientInstrumentOutcome[] = [];
  const monthly = new Map<string, number[]>();
  let scoresInPeriod = 0;
  for (const [clientId, list] of byClient) {
    list.sort((a, b) => a.at.getTime() - b.at.getTime());
    const periodScores = list.filter(inPeriod);
    for (const p of periodScores) {
      const k = monthKey(p.at);
      const arr = monthly.get(k) ?? [];
      arr.push(p.score);
      monthly.set(k, arr);
    }
    scoresInPeriod += periodScores.length;
    if (!periodScores.length) continue;
    const first = list[0];
    const last = list[list.length - 1];
    const daysBetween = Math.floor((last.at.getTime() - first.at.getTime()) / DAY_MS);
    const followUpEligible = list.length >= 2 && daysBetween >= FOLLOW_UP_MIN_DAYS;
    const elevated = followUpEligible && first.score >= ELEVATED_BASELINE;
    const response = elevated ? last.score <= first.score * 0.5 : null;
    const remission = elevated ? last.score < REMISSION_BELOW : null;
    let status: OutcomeStatus;
    if (list.length < 2) status = 'Baseline only';
    else if (!followUpEligible) status = 'Under 4 weeks';
    else if (remission) status = 'Remission';
    else if (response) status = 'Response';
    else if (last.score < first.score) status = 'Improving';
    else if (last.score > first.score) status = 'Worsening';
    else status = 'No change';
    clients.push({
      clientId,
      baseline: first.score,
      baselineAt: first.at.toISOString(),
      latest: last.score,
      latestAt: last.at.toISOString(),
      scores: list.length,
      change: round1(last.score - first.score),
      daysBetween,
      followUpEligible,
      elevatedBaseline: elevated,
      response,
      remission,
      status,
      severity: severityBand(spec, last.score),
    });
  }

  const followed = clients.filter((c) => c.followUpEligible);
  const elevated = clients.filter((c) => c.elevatedBaseline);
  clients.sort((a, b) => a.latestAt < b.latestAt ? 1 : a.latestAt > b.latestAt ? -1 : 0);
  return {
    instrument: spec.label,
    clientsMeasured: clients.length,
    scoresInPeriod,
    invalidScoresDropped: invalid,
    clientsWithFollowUp: followed.length,
    clientsElevatedBaseline: elevated.length,
    response: rate(elevated.filter((c) => c.response).length, elevated.length),
    remission: rate(elevated.filter((c) => c.remission).length, elevated.length),
    avgBaseline: avg(followed.map((c) => c.baseline)),
    avgLatest: avg(followed.map((c) => c.latest)),
    avgChange: avg(followed.map((c) => c.change)),
    monthlyTrend: [...monthly.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => ({ month, avg: avg(v) as number, n: v.length })),
    severity: spec.bands.map((b) => ({
      label: b.label,
      clients: clients.filter((c) => c.latest >= b.min && c.latest <= b.max).length,
    })),
    clients,
  };
}

/** Summary without the per-client list (the route merges PHQ-9 / GAD-7 clients into one table). */
export function outcomeSummary(o: InstrumentOutcomes): Omit<InstrumentOutcomes, 'clients'> {
  const rest: Partial<InstrumentOutcomes> = { ...o };
  delete rest.clients;
  return rest as Omit<InstrumentOutcomes, 'clients'>;
}

/** C-SSRS screens: positive = any "yes" answer (stored score > 0) or the safety flag. */
export function summarizeCssrs(rows: { clientId: string; totalScore: number | null; safetyFlagged: boolean }[]) {
  const positive = rows.filter((r) => r.safetyFlagged || (r.totalScore ?? 0) > 0);
  return {
    screens: rows.length,
    clientsScreened: new Set(rows.map((r) => r.clientId)).size,
    positiveScreens: positive.length,
    clientsPositive: new Set(positive.map((r) => r.clientId)).size,
  };
}

// ─── Quality measures (internal) ─────────────────────────────────────────────

export type IndexEvent = { clientId: string; at: Date; kind: 'risk_alert' | 'crisis_episode' };

export type FollowUpResult = {
  /** raw events found in the period */
  events: number;
  /** after merging repeat events for the same client within 30 days */
  indexEvents: number;
  byKind: { risk_alert: number; crisis_episode: number };
  within7: Rate;
  within30: Rate;
  /** index events whose 7 / 30-day window has not closed yet (left out of that denominator) */
  windowOpen7: number;
  windowOpen30: number;
};

/**
 * FUH-style internal measure: share of high-severity risk alerts / crisis episodes followed by a
 * COMPLETED appointment within 7 and 30 days. Repeat events for a client within 30 days of an index
 * event fold into it. Events whose window is still open are excluded from that window's denominator.
 */
export function computeFollowUp(events: IndexEvent[], visits: { clientId: string; at: Date }[], now: Date): FollowUpResult {
  const sorted = [...events].sort((a, b) => a.clientId.localeCompare(b.clientId) || a.at.getTime() - b.at.getTime());
  const index: IndexEvent[] = [];
  const lastIndex = new Map<string, Date>();
  for (const e of sorted) {
    const prev = lastIndex.get(e.clientId);
    if (prev && e.at.getTime() - prev.getTime() <= 30 * DAY_MS) continue;
    index.push(e);
    lastIndex.set(e.clientId, e.at);
  }
  const visitsByClient = new Map<string, number[]>();
  for (const v of visits) {
    const arr = visitsByClient.get(v.clientId) ?? [];
    arr.push(v.at.getTime());
    visitsByClient.set(v.clientId, arr);
  }
  const tally = (days: number) => {
    let num = 0;
    let den = 0;
    let open = 0;
    for (const e of index) {
      const start = e.at.getTime();
      const end = start + days * DAY_MS;
      if (end > now.getTime()) {
        open++;
        continue;
      }
      den++;
      if ((visitsByClient.get(e.clientId) ?? []).some((t) => t > start && t <= end)) num++;
    }
    return { r: rate(num, den), open };
  };
  const t7 = tally(7);
  const t30 = tally(30);
  return {
    events: events.length,
    indexEvents: index.length,
    byKind: {
      risk_alert: index.filter((e) => e.kind === 'risk_alert').length,
      crisis_episode: index.filter((e) => e.kind === 'crisis_episode').length,
    },
    within7: t7.r,
    within30: t30.r,
    windowOpen7: t7.open,
    windowOpen30: t30.open,
  };
}

/** Share of clients in `denominatorIds` that are also in `numeratorIds`. */
export function coverageRate(denominatorIds: Iterable<string>, numeratorIds: Iterable<string>): Rate {
  const num = new Set(numeratorIds);
  const den = [...new Set(denominatorIds)];
  return rate(den.filter((id) => num.has(id)).length, den.length);
}

/** NCQA HEDIS behavioral-health measures Altrixs cannot compute from its own records. */
export const UNAVAILABLE_HEDIS = [
  { code: 'FUH', name: 'Follow-Up After Hospitalization for Mental Illness', needs: 'Inpatient discharge data (hospital / payer claims)' },
  { code: 'FUM', name: 'Follow-Up After Emergency Department Visit for Mental Illness', needs: 'Emergency department visit data (hospital / payer claims)' },
  { code: 'AMR', name: 'Antidepressant Medication Management', needs: 'Pharmacy fill (dispensing) claims; DrFirst prescriptions are not fills' },
  { code: 'SAA', name: 'Adherence to Antipsychotic Medications for Individuals With Schizophrenia', needs: 'Pharmacy fill (proportion of days covered) claims' },
  { code: 'ADD-E', name: 'Follow-Up Care for Children Prescribed ADHD Medication', needs: 'Pharmacy dispensing claims to find the index prescription start' },
  { code: 'SMC', name: 'Cardiovascular Monitoring for People With Cardiovascular Disease and Schizophrenia', needs: 'LDL-C lab results and cardiovascular diagnoses from medical claims' },
] as const;

// ─── Claims by payer ─────────────────────────────────────────────────────────

export type ClaimPayerRow = ClaimStatusSummary & { payer: string };

export function foldClaimsByPayer(
  groups: { payer: string | null; status: string; count: number; amountCents: number | null; paidAmount: number | null }[]
): ClaimPayerRow[] {
  const byPayer = new Map<string, typeof groups>();
  for (const g of groups) {
    const k = g.payer?.trim() || 'No payer on claim';
    byPayer.set(k, [...(byPayer.get(k) ?? []), g]);
  }
  return [...byPayer.entries()]
    .map(([payer, gs]) => ({ payer, ...summarizeClaims(gs) }))
    .sort((a, b) => b.billedCents - a.billedCents || b.total - a.total);
}

// ─── Utilization / productivity ──────────────────────────────────────────────

export type CompletedVisit = { type: string; startsAt: Date; endsAt: Date; clinicianId: string | null; clientId: string };

function visitHours(v: CompletedVisit): number {
  const h = (v.endsAt.getTime() - v.startsAt.getTime()) / 3_600_000;
  // A booking longer than 12 h is a data-entry error; count it as zero hours rather than inflate totals.
  return h > 0 && h <= 12 ? h : 0;
}

export function utilizationByType(visits: CompletedVisit[]) {
  const map = new Map<string, { sessions: number; hours: number; clinicians: Set<string>; clients: Set<string> }>();
  for (const v of visits) {
    const k = v.type?.trim() || 'Unspecified';
    const row = map.get(k) ?? { sessions: 0, hours: 0, clinicians: new Set<string>(), clients: new Set<string>() };
    row.sessions++;
    row.hours += visitHours(v);
    if (v.clinicianId) row.clinicians.add(v.clinicianId);
    row.clients.add(v.clientId);
    map.set(k, row);
  }
  return [...map.entries()]
    .map(([type, r]) => ({ type, sessions: r.sessions, hours: round1(r.hours), clinicians: r.clinicians.size, clients: r.clients.size }))
    .sort((a, b) => b.sessions - a.sessions);
}

export type ProductivityRow = {
  clinicianId: string;
  name: string;
  completed: number;
  noShow: number;
  cancelled: number;
  noShowRate: Rate;
  hours: number;
  notesSigned: number;
  avgHoursToSign: number | null;
  unsignedNotes: number;
};

export function clinicianProductivity(input: {
  statusGroups: { clinicianId: string | null; status: string; count: number }[];
  visits: CompletedVisit[];
  signedNotes: { clinicianId: string | null; createdAt: Date; signedAt: Date }[];
  unsignedGroups: { clinicianId: string | null; count: number }[];
  names: Map<string, string | null>;
}): ProductivityRow[] {
  const rows = new Map<string, ProductivityRow>();
  const get = (id: string | null) => {
    const k = id ?? 'unassigned';
    let r = rows.get(k);
    if (!r) {
      r = {
        clinicianId: k,
        name: id ? input.names.get(id) || 'Unknown staff' : 'No clinician on record',
        completed: 0, noShow: 0, cancelled: 0, noShowRate: rate(0, 0), hours: 0,
        notesSigned: 0, avgHoursToSign: null, unsignedNotes: 0,
      };
      rows.set(k, r);
    }
    return r;
  };
  for (const g of input.statusGroups) {
    const r = get(g.clinicianId);
    if (g.status === 'COMPLETED') r.completed += g.count;
    else if (g.status === 'NO_SHOW') r.noShow += g.count;
    else if (g.status === 'CANCELLED' || g.status === 'LATE_CANCEL') r.cancelled += g.count;
  }
  for (const v of input.visits) get(v.clinicianId).hours += visitHours(v);
  const signHours = new Map<string, number[]>();
  for (const n of input.signedNotes) {
    const r = get(n.clinicianId);
    r.notesSigned++;
    const h = Math.max(0, (n.signedAt.getTime() - n.createdAt.getTime()) / 3_600_000);
    signHours.set(r.clinicianId, [...(signHours.get(r.clinicianId) ?? []), h]);
  }
  for (const u of input.unsignedGroups) get(u.clinicianId).unsignedNotes += u.count;
  for (const r of rows.values()) {
    r.hours = round1(r.hours);
    r.noShowRate = rate(r.noShow, r.completed + r.noShow);
    r.avgHoursToSign = avg(signHours.get(r.clinicianId) ?? []);
  }
  return [...rows.values()].sort((a, b) => b.completed - a.completed || a.name.localeCompare(b.name));
}

// ─── Medications ─────────────────────────────────────────────────────────────

/** Simple name lists (generic + common brand, lower case). A medication goes to the first class that matches. */
export const DRUG_CLASSES: { id: string; label: string; terms: string[] }[] = [
  {
    id: 'antipsychotic', label: 'Antipsychotics',
    terms: ['aripiprazole', 'abilify', 'asenapine', 'saphris', 'brexpiprazole', 'rexulti', 'cariprazine', 'vraylar',
      'chlorpromazine', 'thorazine', 'clozapine', 'clozaril', 'versacloz', 'fluphenazine', 'prolixin', 'haloperidol', 'haldol',
      'iloperidone', 'fanapt', 'loxapine', 'lurasidone', 'latuda', 'olanzapine', 'zyprexa', 'paliperidone', 'invega',
      'perphenazine', 'pimavanserin', 'nuplazid', 'quetiapine', 'seroquel', 'risperidone', 'risperdal', 'thioridazine',
      'thiothixene', 'trifluoperazine', 'ziprasidone', 'geodon', 'lumateperone', 'caplyta'],
  },
  {
    id: 'mood_stabilizer', label: 'Mood stabilizers',
    terms: ['lithium', 'lithobid', 'lamotrigine', 'lamictal', 'valproate', 'valproic', 'divalproex', 'depakote',
      'carbamazepine', 'tegretol', 'equetro', 'oxcarbazepine', 'trileptal'],
  },
  {
    id: 'ssri', label: 'SSRIs',
    terms: ['sertraline', 'zoloft', 'escitalopram', 'lexapro', 'citalopram', 'celexa', 'fluoxetine', 'prozac',
      'paroxetine', 'paxil', 'fluvoxamine', 'luvox'],
  },
  {
    id: 'snri', label: 'SNRIs',
    terms: ['venlafaxine', 'effexor', 'desvenlafaxine', 'pristiq', 'duloxetine', 'cymbalta', 'levomilnacipran', 'fetzima', 'milnacipran'],
  },
  {
    id: 'other_antidepressant', label: 'Other antidepressants',
    terms: ['bupropion', 'wellbutrin', 'mirtazapine', 'remeron', 'trazodone', 'vilazodone', 'viibryd', 'vortioxetine',
      'trintellix', 'amitriptyline', 'nortriptyline', 'imipramine', 'doxepin', 'clomipramine', 'esketamine', 'spravato',
      'phenelzine', 'tranylcypromine', 'selegiline', 'emsam', 'zuranolone'],
  },
  {
    id: 'adhd', label: 'ADHD medications',
    terms: ['amphetamine', 'adderall', 'lisdexamfetamine', 'vyvanse', 'methylphenidate', 'ritalin', 'concerta',
      'dexmethylphenidate', 'focalin', 'atomoxetine', 'strattera', 'viloxazine', 'qelbree', 'guanfacine', 'intuniv', 'mydayis'],
  },
  {
    id: 'benzodiazepine', label: 'Benzodiazepines',
    terms: ['alprazolam', 'xanax', 'clonazepam', 'klonopin', 'lorazepam', 'ativan', 'diazepam', 'valium',
      'chlordiazepoxide', 'librium', 'temazepam', 'restoril', 'oxazepam', 'clorazepate'],
  },
  {
    id: 'anxiolytic_hypnotic', label: 'Other anxiolytics / sleep',
    terms: ['buspirone', 'buspar', 'hydroxyzine', 'vistaril', 'atarax', 'zolpidem', 'ambien', 'eszopiclone', 'lunesta',
      'zaleplon', 'ramelteon', 'suvorexant', 'belsomra', 'lemborexant', 'daridorexant', 'prazosin'],
  },
  {
    id: 'sud', label: 'Substance use treatment',
    terms: ['buprenorphine', 'suboxone', 'subutex', 'sublocade', 'zubsolv', 'naltrexone', 'vivitrol', 'methadone',
      'acamprosate', 'disulfiram', 'antabuse', 'naloxone', 'narcan'],
  },
];

export const OTHER_CLASS = { id: 'other', label: 'Other / not classified' };

export function drugClassOf(name: string): { id: string; label: string } {
  const lower = name.toLowerCase();
  return DRUG_CLASSES.find((c) => c.terms.some((t) => lower.includes(t))) ?? OTHER_CLASS;
}

/** "Sertraline HCl 50 mg tablet" -> "sertraline" (grouping key for top-drug counts). */
export function drugKey(name: string): string {
  const first = name.trim().toLowerCase().split(/[\s,/(]+/)[0] ?? '';
  return first.replace(/[^a-z-]/g, '') || name.trim().toLowerCase();
}

export type ActiveMedRow = {
  clientId: string;
  medicationName: string;
  drugName: string | null;
  genericName: string | null;
  isAntipsychotic: boolean;
};

export function summarizeMedications(rows: ActiveMedRow[]) {
  const nameOf = (r: ActiveMedRow) => (r.genericName || r.drugName || r.medicationName || '').trim();
  const classes = new Map<string, { label: string; meds: number; clients: Set<string> }>();
  const drugs = new Map<string, { label: string; className: string; meds: number; clients: Set<string> }>();
  const antipsychotic = new Set<string>();
  const lithium = new Set<string>();
  const clozapine = new Set<string>();
  for (const r of rows) {
    const name = nameOf(r);
    if (!name) continue;
    const fullText = `${name} ${r.medicationName ?? ''} ${r.drugName ?? ''}`;
    const cls = drugClassOf(fullText);
    const c = classes.get(cls.id) ?? { label: cls.label, meds: 0, clients: new Set<string>() };
    c.meds++;
    c.clients.add(r.clientId);
    classes.set(cls.id, c);
    const key = drugKey(name);
    const d = drugs.get(key) ?? { label: key.charAt(0).toUpperCase() + key.slice(1), className: cls.label, meds: 0, clients: new Set<string>() };
    d.meds++;
    d.clients.add(r.clientId);
    drugs.set(key, d);
    const lower = fullText.toLowerCase();
    if (r.isAntipsychotic || cls.id === 'antipsychotic') antipsychotic.add(r.clientId);
    if (/lithium|lithobid/.test(lower)) lithium.add(r.clientId);
    if (/clozapine|clozaril|versacloz/.test(lower)) clozapine.add(r.clientId);
  }
  return {
    activeMedications: rows.length,
    clientsOnMedications: new Set(rows.map((r) => r.clientId)).size,
    byClass: [...classes.entries()]
      .map(([id, c]) => ({ id, label: c.label, medications: c.meds, clients: c.clients.size }))
      .sort((a, b) => b.clients - a.clients || a.label.localeCompare(b.label)),
    topDrugs: [...drugs.values()]
      .map((d) => ({ drug: d.label, drugClass: d.className, medications: d.meds, clients: d.clients.size }))
      .sort((a, b) => b.clients - a.clients || a.drug.localeCompare(b.drug))
      .slice(0, 20),
    clientsOnAntipsychotics: antipsychotic.size,
    clientsOnLithium: lithium.size,
    clientsOnClozapine: clozapine.size,
  };
}

// ─── Response shape (shared with the page) ───────────────────────────────────

export type OverviewSection = {
  activeClients: number;
  newClients: number;
  importedClients: number;
  appointments: AppointmentStatusSummary;
  notes: { inPeriod: number; signed: number; unsigned: number; unsignedOver24h: number; unsignedOver48h: number };
  claims: ClaimStatusSummary;
  valant: ValantMoney & { undatedRows: number };
};

export type ClinicalSection = {
  phq9: Omit<InstrumentOutcomes, 'clients'>;
  gad7: Omit<InstrumentOutcomes, 'clients'>;
  cssrs: ReturnType<typeof summarizeCssrs>;
  clients: {
    clientId: string;
    name: string;
    mrn: string | null;
    phq9: ClientInstrumentOutcome | null;
    gad7: ClientInstrumentOutcome | null;
  }[];
  clientsTruncated: boolean;
};

export type QualitySection = {
  measurementBasedCare: Rate & { windowStart: string };
  depressionScreening: Rate & { windowStart: string };
  followUp: FollowUpResult & { crisisEpisodesWithoutClient: number };
  unavailable: typeof UNAVAILABLE_HEDIS;
};

export type FinancialSection = {
  claimsByPayer: ClaimPayerRow[];
  claimsByMonth: { month: string; claims: number; billedCents: number; paidCents: number }[];
  valantByPayer: (ValantMoney & { key: string })[];
  valantByFacility: (ValantMoney & { key: string })[];
  valantByMonth: (ValantMoney & { key: string })[];
  valantTotals: ValantMoney;
};

export type UtilizationSection = {
  appointmentTypes: ReturnType<typeof utilizationByType>;
  claimCpt: { cptCode: string; claims: number; units: number; billedCents: number }[];
  valantCpt: { codeBase: string; charges: number; chargesCents: number }[];
  productivity: ProductivityRow[];
  valantByProvider: { provider: string; matchedStaff: boolean; charges: number; chargesCents: number }[];
};

export type MedicationsSection = ReturnType<typeof summarizeMedications> & {
  rcopiaPrescriptionsSigned: number;
};

export type OutcomesReport = {
  generatedAt: string;
  filters: { from: string; to: string; locationId: string | null; clinicianId: string | null; tab: ReportTab; timeZone: string };
  scope: 'organization' | 'caseload';
  hiddenSensitiveClients: number;
  facilityTerm: string | null;
  options: { locations: { id: string; name: string }[]; clinicians: { id: string; name: string }[] };
  overview: OverviewSection;
  clinical?: ClinicalSection;
  quality?: QualitySection;
  financial?: FinancialSection;
  utilization?: UtilizationSection;
  medications?: MedicationsSection;
};

// ─── CSV ─────────────────────────────────────────────────────────────────────

const money = (cents: number | null | undefined) => (cents == null ? '' : (cents / 100).toFixed(2));
const pct = (r: Rate) => (r.pct == null ? 'no data' : `${r.pct}%`);
const n = (v: number | null | undefined) => (v == null ? 'no data' : v);

function valantRow(label: string, m: ValantMoney): unknown[] {
  return [label, m.chargeCount, money(m.chargesCents), money(m.insurancePaymentsCents), money(m.patientPaymentsCents),
    money(m.adjustmentsCents), money(m.feesCents)];
}
const VALANT_HEADER = ['Charges (count)', 'Charges $', 'Insurance payments $', 'Patient payments $', 'Adjustments $', 'Fees $'];

/** One CSV per tab: header block, overview KPIs, then the tab's tables. Client names only in the clinical table. */
export function buildReportCsv(report: OutcomesReport, orgName: string | null): string {
  const f = report.filters;
  const o = report.overview;
  const rows: unknown[][] = [
    ['Altrixs Outcomes & Reports', orgName ?? ''],
    ['Tab', f.tab],
    ['Period', `${f.from} to ${f.to} (${f.timeZone})`],
    ['Scope', report.scope === 'caseload' ? 'My caseload' : 'Organization'],
    ['Location filter', f.locationId ? (report.options.locations.find((l) => l.id === f.locationId)?.name ?? f.locationId) : 'All'],
    ['Clinician filter', f.clinicianId ? (report.options.clinicians.find((c) => c.id === f.clinicianId)?.name ?? f.clinicianId) : 'All'],
    ['Sensitive clients excluded', report.hiddenSensitiveClients],
    ['Generated', report.generatedAt],
    [],
    ['Overview', 'Value'],
    ['Active clients (current)', o.activeClients],
    ['New clients registered in Altrixs', o.newClients],
    ['Clients imported (migration) in period', o.importedClients],
    ['Appointments', o.appointments.total],
    ['Completed', o.appointments.completed],
    ['No-show', o.appointments.noShow],
    ['Cancelled', o.appointments.cancelled],
    ['Late cancel', o.appointments.lateCancel],
    ['No-show rate', pct(o.appointments.noShowRate)],
    ['Progress notes in period', o.notes.inPeriod],
    ['Unsigned notes', o.notes.unsigned],
    ['Unsigned > 24h', o.notes.unsignedOver24h],
    ['Unsigned > 48h', o.notes.unsignedOver48h],
    ['Altrixs claims', o.claims.total],
    ['Altrixs claims billed', o.claims.billed],
    ['Altrixs billed $', money(o.claims.billedCents)],
    ['Altrixs claims paid', o.claims.paid],
    ['Altrixs paid $', money(o.claims.paidCents)],
    ['Altrixs claims denied', o.claims.denied],
    ['Valant (imported) charges $', money(o.valant.chargesCents)],
    ['Valant (imported) insurance payments $', money(o.valant.insurancePaymentsCents)],
    ['Valant (imported) patient payments $', money(o.valant.patientPaymentsCents)],
    ['Valant (imported) adjustments $', money(o.valant.adjustmentsCents)],
    [],
  ];

  if (report.clinical) {
    const c = report.clinical;
    for (const s of [c.phq9, c.gad7]) {
      rows.push([`${s.instrument} summary`, 'Value']);
      rows.push(['Clients measured in period', s.clientsMeasured]);
      rows.push(['Scores in period', s.scoresInPeriod]);
      rows.push(['Clients with baseline and follow-up >= 4 weeks apart', s.clientsWithFollowUp]);
      rows.push([`Of those, baseline >= ${ELEVATED_BASELINE}`, s.clientsElevatedBaseline]);
      rows.push(['Response rate (>= 50% reduction)', pct(s.response)]);
      rows.push([`Remission rate (latest < ${REMISSION_BELOW})`, pct(s.remission)]);
      rows.push(['Average baseline', n(s.avgBaseline)]);
      rows.push(['Average latest', n(s.avgLatest)]);
      rows.push(['Average change', n(s.avgChange)]);
      rows.push([]);
      rows.push([`${s.instrument} month`, 'Average score', 'Scores']);
      for (const t of s.monthlyTrend) rows.push([t.month, t.avg, t.n]);
      rows.push([]);
    }
    rows.push(['C-SSRS screens', c.cssrs.screens], ['C-SSRS positive screens', c.cssrs.positiveScreens], ['Clients with a positive C-SSRS', c.cssrs.clientsPositive], []);
    rows.push(['Client', 'MRN', 'PHQ-9 baseline', 'PHQ-9 latest', 'PHQ-9 change', 'PHQ-9 status', 'GAD-7 baseline', 'GAD-7 latest', 'GAD-7 change', 'GAD-7 status']);
    for (const cl of c.clients) {
      rows.push([cl.name, cl.mrn ?? '',
        cl.phq9?.baseline ?? '', cl.phq9?.latest ?? '', cl.phq9?.change ?? '', cl.phq9?.status ?? '',
        cl.gad7?.baseline ?? '', cl.gad7?.latest ?? '', cl.gad7?.change ?? '', cl.gad7?.status ?? '']);
    }
  }

  if (report.quality) {
    const q = report.quality;
    rows.push(['Internal quality measure', 'Numerator', 'Denominator', 'Rate']);
    rows.push(['Measurement-based care (PHQ-9/GAD-7 in last 90 days, clients seen in last 90 days)', q.measurementBasedCare.numerator, q.measurementBasedCare.denominator, pct(q.measurementBasedCare)]);
    rows.push(['Depression screening (PHQ-9/PHQ-2 in last 12 months, clients seen in period)', q.depressionScreening.numerator, q.depressionScreening.denominator, pct(q.depressionScreening)]);
    rows.push(['Follow-up visit within 7 days of high risk alert / crisis episode', q.followUp.within7.numerator, q.followUp.within7.denominator, pct(q.followUp.within7)]);
    rows.push(['Follow-up visit within 30 days of high risk alert / crisis episode', q.followUp.within30.numerator, q.followUp.within30.denominator, pct(q.followUp.within30)]);
    rows.push([]);
    rows.push(['HEDIS measure', 'Name', 'Status']);
    for (const m of q.unavailable) rows.push([m.code, m.name, `Not available: needs ${m.needs}`]);
  }

  if (report.financial) {
    const fin = report.financial;
    rows.push(['Altrixs claims by payer', 'Claims', 'Billed', 'Billed $', 'Paid', 'Paid $', 'Denied']);
    for (const p of fin.claimsByPayer) rows.push([p.payer, p.total, p.billed, money(p.billedCents), p.paid, money(p.paidCents), p.denied]);
    rows.push([]);
    rows.push(['Valant (imported) by payer', ...VALANT_HEADER]);
    for (const r of fin.valantByPayer) rows.push(valantRow(r.key, r));
    rows.push([]);
    rows.push(['Valant (imported) by facility', ...VALANT_HEADER]);
    for (const r of fin.valantByFacility) rows.push(valantRow(r.key, r));
    rows.push([]);
    rows.push(['Valant (imported) by month of service', ...VALANT_HEADER]);
    for (const r of fin.valantByMonth) rows.push(valantRow(r.key, r));
  }

  if (report.utilization) {
    const u = report.utilization;
    rows.push(['Completed appointments by type', 'Sessions', 'Hours', 'Clinicians', 'Clients']);
    for (const r of u.appointmentTypes) rows.push([r.type, r.sessions, r.hours, r.clinicians, r.clients]);
    rows.push([]);
    rows.push(['Altrixs claim CPT', 'Claims', 'Units', 'Billed $']);
    for (const r of u.claimCpt) rows.push([r.cptCode, r.claims, r.units, money(r.billedCents)]);
    rows.push([]);
    rows.push(['Valant (imported) charge code', 'Charges', 'Charges $']);
    for (const r of u.valantCpt) rows.push([r.codeBase, r.charges, money(r.chargesCents)]);
    rows.push([]);
    rows.push(['Clinician', 'Completed', 'No-show', 'Cancelled', 'No-show rate', 'Hours', 'Notes signed', 'Avg hours to sign', 'Unsigned notes']);
    for (const r of u.productivity) {
      rows.push([r.name, r.completed, r.noShow, r.cancelled, pct(r.noShowRate), r.hours, r.notesSigned, n(r.avgHoursToSign), r.unsignedNotes]);
    }
    rows.push([]);
    rows.push(['Valant (imported) provider', 'Charges', 'Charges $']);
    for (const r of u.valantByProvider) rows.push([r.provider, r.charges, money(r.chargesCents)]);
  }

  if (report.medications) {
    const m = report.medications;
    rows.push(['Active medications', m.activeMedications], ['Clients on medications', m.clientsOnMedications],
      ['Clients on antipsychotics (name match or flag)', m.clientsOnAntipsychotics], ['Clients on lithium', m.clientsOnLithium],
      ['Clients on clozapine', m.clientsOnClozapine], ['DrFirst prescriptions signed in period', m.rcopiaPrescriptionsSigned], []);
    rows.push(['Drug class (name match)', 'Medications', 'Clients']);
    for (const c of m.byClass) rows.push([c.label, c.medications, c.clients]);
    rows.push([]);
    rows.push(['Drug', 'Class', 'Medications', 'Clients']);
    for (const d of m.topDrugs) rows.push([d.drug, d.drugClass, d.medications, d.clients]);
  }

  return toCsv(rows);
}
