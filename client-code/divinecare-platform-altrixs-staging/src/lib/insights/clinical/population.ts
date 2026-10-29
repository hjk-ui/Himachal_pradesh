/**
 * Clinical Insights — population view (pure; used by the API, the page and the check script).
 *
 * One InsightRow per client in the viewer's scope. Every tile and every drill-down list is
 * computed with the SAME predicate (matchesFilters), so a tile's number is always the length of
 * the list it opens (tests/clinical-insights.test.ts "tiles = lists").
 *
 * Small numbers: any rate whose denominator is under MIN_CELL (10) is suppressed ("n<10"),
 * and a shift is only flagged when both periods have n ≥ 10, the change is at least
 * SHIFT_MIN_POINTS percentage points AND a two-proportion z-test gives |z| ≥ 1.96 (p < 0.05,
 * two-sided, no multiple-comparison correction — it is a "look here" flag, not a finding).
 */
import { SIGNAL_META, tierRank } from './rules';
import type { Signal, SignalCategory, SignalKey, Tier } from './types';

export const MIN_CELL = 10;
export const SHIFT_MIN_POINTS = 5;
export const Z_CRITICAL = 1.96;
export const TREND_WEEKS = 12;
export const TREND_MONTHS = 6;

// ─── Rows ───────────────────────────────────────────────────────────────────

/** Compact per-client facts for trends and breakdowns (no free text) */
export type RowMetrics = {
  /** Attended visit in the last 90 days */
  seen90: boolean;
  /** PHQ-9 recorded in the last 90 days */
  phq9Current: boolean;
  /** Has a current trajectory (2+ scores on PHQ-9 / GAD-7 / PCL-5, latest within 90 days) */
  tracked: boolean;
  /** Any current trajectory reliably worsening / improving (same as the worsening / improving signals) */
  worsening: boolean;
  improving: boolean;
};

/** Per-client history for trends (oldest first) */
export type RowHistory = {
  /** Monday-start weeks: attended visits and missed (no-show + late cancel) appointments */
  weeks: { start: string; attended: number; missed: number }[];
  /** Calendar months: seen (attended visit), measured (PHQ-9 or GAD-7), trajectory as of month end */
  months: { month: string; seen: boolean; measured: boolean; tracked: boolean; worsening: boolean; improving: boolean }[];
};

export type InsightRow = {
  id: string;
  name: string;
  mrn: string | null;
  clinician: { id: string; name: string } | null;
  location: { id: string; name: string } | null;
  programs: string[];
  payer: string;
  dxGroup: string;
  tier: Tier;
  rank: number;
  rules: string[];
  signals: Signal[];
  nextAppointment: string | null;
  lastVisit: string | null;
  metrics: RowMetrics;
  coverage: RowCoverage;
  /** Included because of a recent discharge case (client may no longer be ACTIVE) */
  recentDischarge: boolean;
  scannedAt: string;
};

/** Which data sources have anything on file for this client (data-coverage panel) */
export const COVERAGE_KEYS = ['phq9', 'gad7', 'pcl5', 'cssrs', 'visit', 'futureAppt', 'plan', 'safetyPlan', 'sdoh', 'cadence', 'portal', 'medication'] as const;
export type CoverageKey = (typeof COVERAGE_KEYS)[number];
export type RowCoverage = Record<CoverageKey, boolean>;
export const COVERAGE_LABEL: Record<CoverageKey, string> = {
  phq9: 'Any PHQ-9 (12 months)', gad7: 'Any GAD-7 (12 months)', pcl5: 'Any PCL-5 (12 months)', cssrs: 'Any C-SSRS on file',
  visit: 'An attended visit on file', futureAppt: 'A future appointment', plan: 'Treatment plan (Altrixs or imported)', safetyPlan: 'Safety plan on file',
  sdoh: 'AHC HRSN screening (12 months)', cadence: 'Visit frequency computed', portal: 'Portal message (60 days)',
  medication: 'Monitored medication on file',
};

/** What is unavailable when a source has nothing on file for anyone in scope (page banners) */
const ZERO_COVERAGE_TEXT: Partial<Record<CoverageKey, string>> = {
  phq9: 'No PHQ-9 scores in the last 12 months — symptom tracking is not available until measures are recorded or imported.',
  gad7: 'No GAD-7 scores in the last 12 months — anxiety trajectory is not available until measures are recorded or imported.',
  pcl5: 'No PCL-5 scores in the last 12 months — PTSD symptom trajectory is not available until measures are recorded or imported.',
  cssrs: 'No C-SSRS screens on file — suicide-risk screening signals cannot fire until screens are recorded.',
  visit: 'No attended visits on file — engagement signals are not available until attendance is recorded or imported.',
  futureAppt: 'No future appointments on file — "no follow-up scheduled" cannot be judged.',
  plan: 'No treatment plans on file (Altrixs or imported from Valant) — plan signals are not available.',
  safetyPlan: 'No safety plans linked to clients — "risk indicator without a safety plan" may be over-reported.',
  sdoh: 'No AHC HRSN screenings in the last 12 months — social-needs signals are not available.',
  cadence: 'Visit frequency could not be computed for anyone — "below recommended frequency" is not available.',
};

/** One banner per data source with 0% coverage (portal and medication are not expected for everyone). */
export function zeroCoverageBanners(rows: InsightRow[]): { key: CoverageKey; text: string }[] {
  if (!rows.length) return [];
  return COVERAGE_KEYS.filter((k) => ZERO_COVERAGE_TEXT[k] && !rows.some((r) => r.coverage?.[k])).map((k) => ({ key: k, text: ZERO_COVERAGE_TEXT[k]! }));
}

export function buildCoverage(rows: InsightRow[]): { key: CoverageKey; label: string; rate: CellRate }[] {
  return COVERAGE_KEYS.map((key) => ({ key, label: COVERAGE_LABEL[key], rate: cellRate(rows.filter((r) => r.coverage?.[key]).length, rows.length) }));
}

// ─── Grouping helpers ───────────────────────────────────────────────────────

export const NO_PROGRAM = 'Outpatient only';
export const NO_PAYER = 'No insurance listed';
export const NO_DX = 'No diagnosis on file';

const DX_GROUPS: { label: string; test: RegExp }[] = [
  { label: 'Depressive disorders (F32–F34)', test: /^F3[234]/ },
  { label: 'Bipolar disorders (F30–F31)', test: /^F3[01]/ },
  { label: 'Anxiety disorders (F40–F41)', test: /^F4[01]/ },
  { label: 'OCD (F42)', test: /^F42/ },
  { label: 'Trauma and stressor (F43)', test: /^F43/ },
  { label: 'Psychotic disorders (F20–F29)', test: /^F2\d/ },
  { label: 'Substance use (F10–F19)', test: /^F1\d/ },
  { label: 'ADHD (F90)', test: /^F90/ },
];

/** Diagnosis group from the primary ICD-10 code (first code when several are listed). */
export function dxGroupOf(code: string | null | undefined): string {
  const first = String(code ?? '').toUpperCase().match(/[A-Z]\d{2}(?:\.[0-9A-Z]{1,4})?/)?.[0];
  if (!first) return NO_DX;
  return DX_GROUPS.find((g) => g.test.test(first))?.label ?? 'Other diagnoses';
}

export function payerOf(insurancePayer: string | null | undefined, insuranceType: string | null | undefined): string {
  const p = String(insurancePayer ?? '').split(/[;|]/)[0].trim();
  return p || String(insuranceType ?? '').trim() || NO_PAYER;
}

// ─── Care gaps ──────────────────────────────────────────────────────────────

export const CARE_GAPS = {
  not_in_care: { label: 'Possibly disengaged / inactive (no visit in 120 days, nothing scheduled)', signal: 'not_in_care' },
  phq9_overdue: { label: 'Seen in 90 days, no PHQ-9 in 90 days', signal: 'phq9_overdue' },
  plan_missing: { label: 'No treatment plan (Altrixs or imported)', signal: 'plan_missing' },
  valant_plan_not_imported: { label: 'Valant plan not imported (go-live transition)', signal: 'valant_plan_not_imported' },
  plan_review_overdue: { label: 'Treatment plan review overdue', signal: 'plan_review_overdue' },
  safety_plan_missing: { label: 'Risk indicator, no safety plan', signal: 'safety_plan_missing' },
  crisis_no_followup: { label: 'No follow-up within 7 days of a crisis', signal: 'crisis_no_followup' },
  discharge_no_followup: { label: 'Discharged without a follow-up appointment', signal: 'discharge_no_followup' },
  labs_due: { label: 'Monitoring labs due', signal: 'labs_due' },
} as const satisfies Record<string, { label: string; signal: SignalKey }>;
export type CareGapKey = keyof typeof CARE_GAPS;
export const CARE_GAP_KEYS = Object.keys(CARE_GAPS) as CareGapKey[];

// ─── Filters (one predicate for tiles and lists) ────────────────────────────

export type InsightFilters = {
  tiers: Tier[];
  clinicianId: string | null;
  locationId: string | null;
  program: string | null;
  payer: string | null;
  dxGroup: string | null;
  category: SignalCategory | null;
  signal: SignalKey | null;
  careGap: CareGapKey | null;
  myCaseload: boolean;
  /** Only clients with no future appointment */
  noFutureAppt: boolean;
  /** Name / MRN substring (client-side only; never sent to AI) */
  search: string;
};

export const EMPTY_FILTERS: InsightFilters = {
  tiers: [], clinicianId: null, locationId: null, program: null, payer: null, dxGroup: null,
  category: null, signal: null, careGap: null, myCaseload: false, noFutureAppt: false, search: '',
};

export function matchesFilters(r: InsightRow, f: InsightFilters, viewerId: string | null): boolean {
  if (f.tiers.length && !f.tiers.includes(r.tier)) return false;
  if (f.clinicianId && r.clinician?.id !== f.clinicianId) return false;
  if (f.locationId && r.location?.id !== f.locationId) return false;
  if (f.program && !(f.program === NO_PROGRAM ? r.programs.length === 0 : r.programs.includes(f.program))) return false;
  if (f.payer && r.payer !== f.payer) return false;
  if (f.dxGroup && r.dxGroup !== f.dxGroup) return false;
  if (f.category && !r.signals.some((s) => s.category === f.category && s.level !== 'positive')) return false;
  if (f.signal && !r.signals.some((s) => s.key === f.signal)) return false;
  if (f.careGap && !r.signals.some((s) => s.key === CARE_GAPS[f.careGap].signal)) return false;
  if (f.myCaseload && (!viewerId || r.clinician?.id !== viewerId)) return false;
  if (f.noFutureAppt && r.nextAppointment) return false;
  if (f.search.trim()) {
    const q = f.search.trim().toLowerCase();
    if (!r.name.toLowerCase().includes(q) && !(r.mrn ?? '').toLowerCase().includes(q)) return false;
  }
  return true;
}

export function filterRows(rows: InsightRow[], f: InsightFilters, viewerId: string | null): InsightRow[] {
  return rows.filter((r) => matchesFilters(r, f, viewerId));
}

/** Filters a tier tile applies when clicked (the rest of the filters stay) */
export function tierTileFilters(f: InsightFilters, tier: Tier): InsightFilters {
  return { ...f, tiers: [tier], careGap: null };
}

/** Filters a care-gap tile applies when clicked */
export function careGapTileFilters(f: InsightFilters, gap: CareGapKey): InsightFilters {
  return { ...f, tiers: [], careGap: gap };
}

/** Filters a KPI signal tile applies when clicked (worsening, improving, ...) */
export function signalTileFilters(f: InsightFilters, signal: SignalKey): InsightFilters {
  return { ...f, tiers: [], careGap: null, signal };
}

/** Filters the "no future appointment" KPI tile applies */
export function noFutureTileFilters(f: InsightFilters): InsightFilters {
  return { ...f, tiers: [], careGap: null, noFutureAppt: true };
}

export const KPI_SIGNALS = ['worsening', 'improving', 'phq9_overdue'] as const satisfies readonly SignalKey[];
export type KpiSignal = (typeof KPI_SIGNALS)[number];

export type TileCounts = {
  total: number;
  tiers: Record<Tier, number>;
  careGaps: Record<CareGapKey, number>;
  signals: Record<KpiSignal, number>;
  noFutureAppt: number;
};

/** Tile numbers: each is exactly filterRows(rows, <that tile's filters>).length */
export function tileCounts(rows: InsightRow[], f: InsightFilters, viewerId: string | null): TileCounts {
  const n = (x: InsightFilters) => filterRows(rows, x, viewerId).length;
  const tiers = { urgent: 0, high: 0, watch: 0, stable: 0 } as Record<Tier, number>;
  for (const t of Object.keys(tiers) as Tier[]) tiers[t] = n(tierTileFilters(f, t));
  const careGaps = {} as Record<CareGapKey, number>;
  for (const g of CARE_GAP_KEYS) careGaps[g] = n(careGapTileFilters(f, g));
  const signals = {} as Record<KpiSignal, number>;
  for (const k of KPI_SIGNALS) signals[k] = n(signalTileFilters(f, k));
  return { total: n({ ...f, tiers: [], careGap: null }), tiers, careGaps, signals, noFutureAppt: n(noFutureTileFilters(f)) };
}

export type SortKey = 'priority' | 'name' | 'lastVisit' | 'nextAppointment' | 'clinician';

export function sortRows(rows: InsightRow[], key: SortKey, dir: 'asc' | 'desc' = 'asc'): InsightRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  const str = (v: string | null | undefined) => v ?? '';
  const cmp = (a: InsightRow, b: InsightRow): number => {
    switch (key) {
      case 'name': return a.name.localeCompare(b.name);
      case 'lastVisit': return str(a.lastVisit).localeCompare(str(b.lastVisit));
      case 'nextAppointment': return str(a.nextAppointment).localeCompare(str(b.nextAppointment));
      case 'clinician': return str(a.clinician?.name).localeCompare(str(b.clinician?.name));
      default: return tierRank(a.tier) - tierRank(b.tier) || b.rank - a.rank || a.name.localeCompare(b.name);
    }
  };
  return [...rows].sort((a, b) => sign * cmp(a, b) || a.id.localeCompare(b.id));
}

// ─── Rates, suppression, shifts ─────────────────────────────────────────────

export type CellRate = { num: number; den: number; pct: number | null; suppressed: boolean };

export function cellRate(num: number, den: number): CellRate {
  const suppressed = den < MIN_CELL;
  return { num: suppressed ? 0 : num, den, pct: suppressed || den === 0 ? null : Math.round((num / den) * 1000) / 10, suppressed };
}

export type Shift = {
  now: CellRate;
  prev: CellRate;
  /** Percentage-point change (null when suppressed) */
  diffPts: number | null;
  z: number | null;
  flagged: boolean;
  reason: 'suppressed_small_n' | 'below_threshold' | 'not_significant' | 'flagged';
};

/** Two-proportion z-test between two periods, with small-n suppression. */
export function detectShift(now: { num: number; den: number }, prev: { num: number; den: number }): Shift {
  const a = cellRate(now.num, now.den);
  const b = cellRate(prev.num, prev.den);
  if (a.suppressed || b.suppressed) return { now: a, prev: b, diffPts: null, z: null, flagged: false, reason: 'suppressed_small_n' };
  const p1 = now.num / now.den;
  const p2 = prev.num / prev.den;
  const diffPts = Math.round((p1 - p2) * 1000) / 10;
  const pooled = (now.num + prev.num) / (now.den + prev.den);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / now.den + 1 / prev.den));
  const z = se > 0 ? Math.round(((p1 - p2) / se) * 100) / 100 : 0;
  if (Math.abs(diffPts) < SHIFT_MIN_POINTS) return { now: a, prev: b, diffPts, z, flagged: false, reason: 'below_threshold' };
  if (Math.abs(z) < Z_CRITICAL) return { now: a, prev: b, diffPts, z, flagged: false, reason: 'not_significant' };
  return { now: a, prev: b, diffPts, z, flagged: true, reason: 'flagged' };
}

// ─── Trends ─────────────────────────────────────────────────────────────────

export type WeekPoint = { start: string; attended: number; missed: number; noShowRate: CellRate };
export type MonthPoint = {
  month: string;
  /** Clients with a current trajectory that month (denominator for worsening / improving) */
  withTrajectory: number;
  worsening: CellRate;
  improving: CellRate;
  /** Of clients seen that month: share with a PHQ-9 or GAD-7 that month */
  measurement: CellRate;
};

export type Trends = {
  weeks: WeekPoint[];
  months: MonthPoint[];
  /** Latest complete period vs the one before */
  shifts: { key: 'no_show_rate' | 'worsening_share' | 'improving_share' | 'measurement_rate'; label: string; period: string; previous: string; shift: Shift }[];
};

/**
 * Sum per-client histories. `currentWeek` / `currentMonth` (incomplete) are excluded from shift
 * detection; the charts show them labelled "to date".
 */
export function buildTrends(histories: RowHistory[], currentWeek: string, currentMonth: string): Trends {
  const weekMap = new Map<string, { attended: number; missed: number }>();
  const monthMap = new Map<string, { seen: number; measured: number; traj: number; worse: number; better: number }>();
  for (const h of histories) {
    for (const w of h.weeks) {
      const cur = weekMap.get(w.start) ?? { attended: 0, missed: 0 };
      cur.attended += w.attended;
      cur.missed += w.missed;
      weekMap.set(w.start, cur);
    }
    for (const m of h.months) {
      const cur = monthMap.get(m.month) ?? { seen: 0, measured: 0, traj: 0, worse: 0, better: 0 };
      if (m.seen) {
        cur.seen += 1;
        if (m.measured) cur.measured += 1;
      }
      if (m.tracked) {
        cur.traj += 1;
        if (m.worsening) cur.worse += 1;
        if (m.improving) cur.better += 1;
      }
      monthMap.set(m.month, cur);
    }
  }
  const weeks: WeekPoint[] = [...weekMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([start, v]) => ({
    start, attended: v.attended, missed: v.missed, noShowRate: cellRate(v.missed, v.attended + v.missed),
  }));
  const months: MonthPoint[] = [...monthMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, v]) => ({
    month, withTrajectory: v.traj,
    worsening: cellRate(v.worse, v.traj), improving: cellRate(v.better, v.traj), measurement: cellRate(v.measured, v.seen),
  }));

  const shifts: Trends['shifts'] = [];
  const doneWeeks = weeks.filter((w) => w.start < currentWeek);
  if (doneWeeks.length >= 2) {
    const [p, n] = doneWeeks.slice(-2);
    shifts.push({ key: 'no_show_rate', label: 'No-show / late-cancel rate', period: `week of ${n.start}`, previous: `week of ${p.start}`,
      shift: detectShift({ num: n.missed, den: n.attended + n.missed }, { num: p.missed, den: p.attended + p.missed }) });
  }
  const doneMonths = months.filter((m) => m.month < currentMonth);
  if (doneMonths.length >= 2) {
    const [p, n] = doneMonths.slice(-2);
    const raw = (m: MonthPoint, k: 'worse' | 'better' | 'measured') => {
      const v = monthMap.get(m.month)!;
      return k === 'measured' ? { num: v.measured, den: v.seen } : { num: v[k], den: v.traj };
    };
    shifts.push({ key: 'worsening_share', label: 'Share of measured clients reliably worsening', period: n.month, previous: p.month, shift: detectShift(raw(n, 'worse'), raw(p, 'worse')) });
    shifts.push({ key: 'improving_share', label: 'Share of measured clients reliably improving', period: n.month, previous: p.month, shift: detectShift(raw(n, 'better'), raw(p, 'better')) });
    shifts.push({ key: 'measurement_rate', label: 'Measurement completion (PHQ-9 or GAD-7 among clients seen)', period: n.month, previous: p.month, shift: detectShift(raw(n, 'measured'), raw(p, 'measured')) });
  }
  return { weeks, months, shifts };
}

// ─── Breakdowns ─────────────────────────────────────────────────────────────

export const BREAKDOWN_DIMS = ['clinician', 'location', 'program', 'payer', 'dxGroup'] as const;
export type BreakdownDim = (typeof BREAKDOWN_DIMS)[number];
export const BREAKDOWN_LABEL: Record<BreakdownDim, string> = {
  clinician: 'Clinician', location: 'Location', program: 'Program', payer: 'Payer', dxGroup: 'Diagnosis group',
};

export type BreakdownRow = {
  key: string;
  label: string;
  clients: number;
  /** All counts and rates below are suppressed when clients < MIN_CELL */
  suppressed: boolean;
  urgentHigh: CellRate;
  worsening: CellRate;
  measured: CellRate;
  noShow: CellRate;
};

function groupKeys(r: InsightRow, dim: BreakdownDim): { key: string; label: string }[] {
  switch (dim) {
    case 'clinician': return [r.clinician ? { key: r.clinician.id, label: r.clinician.name } : { key: '_none', label: 'No assigned clinician' }];
    case 'location': return [r.location ? { key: r.location.id, label: r.location.name } : { key: '_none', label: 'No location' }];
    case 'program': return (r.programs.length ? r.programs : [NO_PROGRAM]).map((p) => ({ key: p, label: p }));
    case 'payer': return [{ key: r.payer, label: r.payer }];
    default: return [{ key: r.dxGroup, label: r.dxGroup }];
  }
}

/** Per-group rates; a client in two programs counts in both program rows. */
export function buildBreakdown(rows: InsightRow[], histories: Map<string, RowHistory>, dim: BreakdownDim): BreakdownRow[] {
  const acc = new Map<string, { label: string; n: number; uh: number; traj: number; worse: number; seen: number; measured: number; att: number; missed: number }>();
  for (const r of rows) {
    const h = histories.get(r.id);
    const att = h ? h.weeks.reduce((s, w) => s + w.attended, 0) : 0;
    const missed = h ? h.weeks.reduce((s, w) => s + w.missed, 0) : 0;
    for (const g of groupKeys(r, dim)) {
      const a = acc.get(g.key) ?? { label: g.label, n: 0, uh: 0, traj: 0, worse: 0, seen: 0, measured: 0, att: 0, missed: 0 };
      a.n += 1;
      if (r.tier === 'urgent' || r.tier === 'high') a.uh += 1;
      if (r.metrics.tracked) {
        a.traj += 1;
        if (r.metrics.worsening) a.worse += 1;
      }
      if (r.metrics.seen90) {
        a.seen += 1;
        if (r.metrics.phq9Current) a.measured += 1;
      }
      a.att += att;
      a.missed += missed;
      acc.set(g.key, a);
    }
  }
  return [...acc.entries()]
    .map(([key, a]): BreakdownRow => {
      const suppressed = a.n < MIN_CELL;
      const z = cellRate(0, 0);
      return {
        key, label: a.label, clients: a.n, suppressed,
        urgentHigh: suppressed ? z : cellRate(a.uh, a.n),
        worsening: suppressed ? z : cellRate(a.worse, a.traj),
        measured: suppressed ? z : cellRate(a.measured, a.seen),
        noShow: suppressed ? z : cellRate(a.missed, a.att + a.missed),
      };
    })
    .sort((x, y) => y.clients - x.clients || x.label.localeCompare(y.label));
}

// ─── Signal counts + coverage (check script and KPI tiles) ──────────────────

export function signalCounts(rows: InsightRow[]): Record<SignalKey, number> {
  const out = Object.fromEntries(Object.keys(SIGNAL_META).map((k) => [k, 0])) as Record<SignalKey, number>;
  for (const r of rows) for (const k of new Set(r.signals.map((s) => s.key))) out[k] += 1;
  return out;
}

export type Kpis = {
  clients: number;
  urgentHigh: number;
  worsening: CellRate;
  improving: CellRate;
  measurement: CellRate;
  noFutureAppt: number;
};

export function buildKpis(rows: InsightRow[]): Kpis {
  let traj = 0, worse = 0, better = 0, seen = 0, measured = 0;
  for (const r of rows) {
    if (r.metrics.tracked) {
      traj += 1;
      if (r.metrics.worsening) worse += 1;
      if (r.metrics.improving) better += 1;
    }
    if (r.metrics.seen90) {
      seen += 1;
      if (r.metrics.phq9Current) measured += 1;
    }
  }
  return {
    clients: rows.length,
    urgentHigh: rows.filter((r) => r.tier === 'urgent' || r.tier === 'high').length,
    worsening: cellRate(worse, traj),
    improving: cellRate(better, traj),
    measurement: cellRate(measured, seen),
    noFutureAppt: rows.filter((r) => !r.nextAppointment).length,
  };
}

// ─── Whole view (API + check script) ────────────────────────────────────────

export type PopulationView = {
  kpis: Kpis;
  trends: Trends;
  breakdowns: Record<BreakdownDim, BreakdownRow[]>;
  coverage: ReturnType<typeof buildCoverage>;
  signalCounts: Record<SignalKey, number>;
};

export function buildPopulationView(rows: InsightRow[], histories: Map<string, RowHistory>, currentWeek: string, currentMonth: string): PopulationView {
  const hs = rows.map((r) => histories.get(r.id)).filter((h): h is RowHistory => Boolean(h));
  const breakdowns = {} as Record<BreakdownDim, BreakdownRow[]>;
  for (const d of BREAKDOWN_DIMS) breakdowns[d] = buildBreakdown(rows, histories, d);
  return {
    kpis: buildKpis(rows),
    trends: buildTrends(hs, currentWeek, currentMonth),
    breakdowns,
    coverage: buildCoverage(rows),
    signalCounts: signalCounts(rows),
  };
}

/** Filter options present in the rows (for the worklist selects) */
export function filterOptions(rows: InsightRow[]) {
  const clinicians = new Map<string, string>();
  const locations = new Map<string, string>();
  const programs = new Set<string>();
  const payers = new Set<string>();
  const dx = new Set<string>();
  for (const r of rows) {
    if (r.clinician) clinicians.set(r.clinician.id, r.clinician.name);
    if (r.location) locations.set(r.location.id, r.location.name);
    for (const p of r.programs.length ? r.programs : [NO_PROGRAM]) programs.add(p);
    payers.add(r.payer);
    dx.add(r.dxGroup);
  }
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  return {
    clinicians: [...clinicians].map(([id, name]) => ({ id, name })).sort(byName),
    locations: [...locations].map(([id, name]) => ({ id, name })).sort(byName),
    programs: [...programs].sort(),
    payers: [...payers].sort(),
    dxGroups: [...dx].sort(),
  };
}

// ─── Snapshot join (pure) ───────────────────────────────────────────────────

/** InsightRow as stored in clinical_insight_snapshots.row (live header fields removed) */
export type StoredRow = Omit<InsightRow, 'name' | 'mrn' | 'clinician' | 'location' | 'id' | 'scannedAt'>;

/** Pure join of live client headers and snapshot rows (exported for tests). */
export function joinInsightRows(
  clients: { id: string; name: string; mrn: string | null; status: string; assignedTo: { id: string; name: string | null } | null; location: { id: string; name: string } | null }[],
  snaps: { clientId: string; row: unknown; history: unknown; scannedAt: Date }[]
): { rows: InsightRow[]; histories: Map<string, RowHistory>; notScanned: number; scannedAt: string | null } {
  const snapBy = new Map(snaps.map((s) => [s.clientId, s]));
  const rows: InsightRow[] = [];
  const histories = new Map<string, RowHistory>();
  let notScanned = 0;
  let latest: Date | null = null;
  for (const c of clients) {
    const s = snapBy.get(c.id);
    if (!s) {
      if (c.status === 'ACTIVE') notScanned += 1;
      continue;
    }
    const stored = (s.row ?? {}) as StoredRow;
    // Inactive clients appear only through a recent discharge case
    if (c.status !== 'ACTIVE' && !stored.recentDischarge) continue;
    if (!latest || s.scannedAt > latest) latest = s.scannedAt;
    rows.push({
      ...stored,
      id: c.id,
      name: c.name,
      mrn: c.mrn,
      clinician: c.assignedTo ? { id: c.assignedTo.id, name: c.assignedTo.name || 'Unnamed clinician' } : null,
      location: c.location,
      scannedAt: s.scannedAt.toISOString(),
    });
    histories.set(c.id, (s.history ?? { weeks: [], months: [] }) as RowHistory);
  }
  return { rows, histories, notScanned, scannedAt: latest ? latest.toISOString() : null };
}

