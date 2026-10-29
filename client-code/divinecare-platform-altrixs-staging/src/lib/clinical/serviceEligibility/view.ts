/**
 * Scanner page view model — filters, tile counts, list rows, sort and paging. Pure; used by the
 * page AND by scripts/check-service-eligibility.ts so the counts the tiles show are computed by the
 * same code that builds the drill-down list (a tile count always equals the rows its click shows).
 *
 * Tile counts honour the same base filters as the list (search, clinician, location, payer,
 * workflow). A suggestion the clinician dismissed or snoozed (still snoozed) is hidden from the
 * "open" worklist, from the tile counts and from the list alike.
 */
import { classifyPayer, type PayerClass, type PayerFit } from './payerFit';
import { ELIGIBILITY_STATUSES, PROGRAMS, type ClientPriority, type EligibilityStatus, type GapKey, type ProgramCounts, type ProgramKey } from './types';

export const DISMISS_REASONS = ['not_appropriate', 'client_declined', 'referred_elsewhere', 'other'] as const;
export type DismissReason = (typeof DISMISS_REASONS)[number];
export const DISMISS_REASON_LABELS: Record<DismissReason, string> = {
  not_appropriate: 'Not clinically appropriate',
  client_declined: 'Client declined',
  referred_elsewhere: 'Already referred elsewhere',
  other: 'Other',
};
export const SNOOZE_DAYS = [30, 60, 90] as const;
export const OUTCOMES = ['referred', 'enrolled', 'declined', 'not_enrolled'] as const;
export type Outcome = (typeof OUTCOMES)[number];

export type DecisionState = {
  action: 'accepted' | 'dismissed' | 'snoozed';
  reason: DismissReason | null;
  reasonNote: string | null;
  snoozeUntil: string | null;
  outcome: Outcome | null;
  decidedAt: string;
  decidedBy: string | null;
};

export type RevenueEstimate = {
  /** fee schedule code used */
  code: string | null;
  feeCents: number | null;
  units: number | null;
  /** feeCents × units when both known */
  estimateCents: number | null;
  basis: string;
};

export type ScannerRow = {
  id: string;
  name: string;
  mrn: string | null;
  age: number | null;
  primaryDx: string | null;
  clinician: { id: string; name: string } | null;
  location: { id: string; name: string } | null;
  payer: string | null;
  priority: ClientPriority;
  statuses: Record<ProgramKey, EligibilityStatus>;
  gaps: Partial<Record<ProgramKey, GapKey[]>>;
  decisions: Partial<Record<ProgramKey, DecisionState>>;
  payerFit?: Partial<Record<ProgramKey, PayerFit>>;
  revenue?: Partial<Record<ProgramKey, RevenueEstimate>>;
  scannedAt: string;
};

export type Workflow = 'open' | 'all' | 'accepted' | 'dismissed' | 'snoozed';

export type ViewFilters = {
  program: ProgramKey | 'all';
  status: EligibilityStatus | 'all';
  clinician: string; // 'all' | 'none' | user id
  location: string; // 'all' | 'none' | location id
  payer: PayerClass | 'all';
  search: string;
  workflow: Workflow;
  /** 'mine' = clients assigned to `viewerId` */
  caseload?: 'all' | 'mine';
  viewerId?: string | null;
  /** Worklist tier (default: actionable) */
  tier?: Tier;
};

/**
 * Worklist tiers. actionable (default): candidate, review, potential with at most one data gap,
 * plus enrolled (reachable from its tile). needs_data: potential with 2+ gaps. dx_only: "diagnosis
 * only — screen". all: every indicated status.
 */
export const TIERS = ['actionable', 'needs_data', 'dx_only', 'all'] as const;
export type Tier = (typeof TIERS)[number];
export const TIER_LABELS: Record<Tier, string> = {
  actionable: 'Actionable worklist',
  needs_data: 'Needs data (2+ gaps)',
  dx_only: 'Diagnosis only — screen',
  all: 'All tiers',
};
export const MAX_ACTIONABLE_GAPS = 1;

export function tierOf(s: EligibilityStatus, gapCount: number): Exclude<Tier, 'all'> | 'enrolled' | null {
  if (s === 'not_indicated') return null;
  if (s === 'enrolled') return 'enrolled';
  if (s === 'screen') return 'dx_only';
  if (s === 'potential' && gapCount > MAX_ACTIONABLE_GAPS) return 'needs_data';
  return 'actionable';
}

export function inTier(s: EligibilityStatus, gapCount: number, tier: Tier): boolean {
  const t = tierOf(s, gapCount);
  if (t === null) return false;
  if (tier === 'all') return true;
  return t === tier || (t === 'enrolled' && tier === 'actionable');
}

export const DEFAULT_FILTERS: ViewFilters = {
  program: 'all', status: 'all', clinician: 'all', location: 'all', payer: 'all', search: '', workflow: 'open', caseload: 'all', viewerId: null, tier: 'actionable',
};

/** Decision in effect at `now` (an expired snooze no longer applies). */
export function activeDecision(row: Pick<ScannerRow, 'decisions'>, p: ProgramKey, now: Date): DecisionState | null {
  const d = row.decisions[p];
  if (!d) return null;
  if (d.action === 'snoozed' && (!d.snoozeUntil || new Date(d.snoozeUntil).getTime() <= now.getTime())) return null;
  return d;
}

/**
 * The status this row shows for a program under the workflow filter, or null when the program
 * is filtered out for the row (dismissed / snoozed in the open worklist; not matching a
 * workflow-specific view).
 */
export function visibleStatus(row: ScannerRow, p: ProgramKey, workflow: Workflow, now: Date): EligibilityStatus | null {
  const s = row.statuses[p];
  const d = activeDecision(row, p, now);
  switch (workflow) {
    case 'all':
      return s;
    case 'open':
      return d && (d.action === 'dismissed' || d.action === 'snoozed') ? null : s;
    default:
      return d?.action === workflow ? s : null;
  }
}

/** Status shown for a program under the workflow AND tier filters (null = filtered out). */
export function shownStatus(row: ScannerRow, p: ProgramKey, f: Pick<ViewFilters, 'workflow' | 'tier'>, now: Date): EligibilityStatus | null {
  const s = visibleStatus(row, p, f.workflow, now);
  if (!s) return null;
  return inTier(s, row.gaps[p]?.length ?? 0, f.tier ?? 'actionable') ? s : null;
}

/** "All statuses" lists the work items: enrolled only under the "all" tier (or via its own tile). */
const WORK = (s: EligibilityStatus | null, tier: Tier) => s !== null && s !== 'not_indicated' && (tier === 'all' || s !== 'enrolled');

/** Search / clinician / location / payer / caseload — every filter except program, status and workflow. */
export function baseFilter(rows: ScannerRow[], f: ViewFilters): ScannerRow[] {
  const q = f.search.trim().toLowerCase();
  return rows.filter((c) => {
    if (q && !`${c.name} ${c.mrn ?? ''} ${c.primaryDx ?? ''}`.toLowerCase().includes(q)) return false;
    if (f.clinician !== 'all' && (c.clinician?.id ?? 'none') !== f.clinician) return false;
    if (f.location !== 'all' && (c.location?.id ?? 'none') !== f.location) return false;
    if (f.payer !== 'all' && classifyPayer(c.payer) !== f.payer) return false;
    if (f.caseload === 'mine' && (!f.viewerId || c.clinician?.id !== f.viewerId)) return false;
    return true;
  });
}

export function emptyProgramCounts(): Record<ProgramKey, ProgramCounts> {
  const out = {} as Record<ProgramKey, ProgramCounts>;
  for (const p of PROGRAMS) out[p] = Object.fromEntries(ELIGIBILITY_STATUSES.map((s) => [s, 0])) as ProgramCounts;
  return out;
}

/** Tile counts: per program, how many base-filtered rows show each status under the workflow + tier filters. */
export function tileCounts(rows: ScannerRow[], f: ViewFilters, now: Date): Record<ProgramKey, ProgramCounts> {
  const out = emptyProgramCounts();
  for (const r of baseFilter(rows, f)) {
    for (const p of PROGRAMS) {
      const s = shownStatus(r, p, f, now);
      if (s) out[p][s] += 1;
    }
  }
  return out;
}

/** Work items per tier for each program (tier filter ignored) — the counts on the tier selector. */
export function tierCounts(rows: ScannerRow[], f: ViewFilters, now: Date): Record<ProgramKey | 'all', Record<Exclude<Tier, 'all'>, number>> {
  const zero = () => ({ actionable: 0, needs_data: 0, dx_only: 0 });
  const out = Object.fromEntries([...PROGRAMS, 'all'].map((p) => [p, zero()])) as Record<ProgramKey | 'all', Record<Exclude<Tier, 'all'>, number>>;
  for (const r of baseFilter(rows, f)) {
    const any = { actionable: false, needs_data: false, dx_only: false };
    for (const p of PROGRAMS) {
      const s = visibleStatus(r, p, f.workflow, now);
      if (!s || s === 'enrolled') continue;
      const t = tierOf(s, r.gaps[p]?.length ?? 0);
      if (t && t !== 'enrolled') {
        out[p][t] += 1;
        any[t] = true;
      }
    }
    for (const t of ['actionable', 'needs_data', 'dx_only'] as const) if (any[t]) out.all[t] += 1;
  }
  return out;
}

/** List rows for the filters — what a tile click (program + status) shows. Sorted by urgency. */
export function listRows(rows: ScannerRow[], f: ViewFilters, now: Date): ScannerRow[] {
  const programs = f.program === 'all' ? PROGRAMS : [f.program];
  const out = baseFilter(rows, f).filter((r) =>
    programs.some((p) => {
      const s = shownStatus(r, p, f, now);
      return f.status === 'all' ? WORK(s, f.tier ?? 'actionable') : s === f.status;
    })
  );
  return sortRows(out, f.program);
}

/** Clinical urgency first, then estimated revenue for the selected program, then name. */
export function sortRows(rows: ScannerRow[], program: ProgramKey | 'all'): ScannerRow[] {
  const rev = (r: ScannerRow) => (program === 'all' ? 0 : r.revenue?.[program]?.estimateCents ?? 0);
  return [...rows].sort((a, b) => b.priority.score - a.priority.score || rev(b) - rev(a) || a.name.localeCompare(b.name));
}

export const PAGE_SIZE = 50;
export function pageOf<T>(rows: T[], page: number, size: number = PAGE_SIZE): { rows: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const p = Math.min(Math.max(1, page), pages);
  return { rows: rows.slice((p - 1) * size, p * size), page: p, pages };
}

/** Conversion per program: accepted suggestions and how many reached enrollment. */
export function conversion(rows: ScannerRow[]): Record<ProgramKey, { accepted: number; enrolled: number; declined: number }> {
  const out = Object.fromEntries(PROGRAMS.map((p) => [p, { accepted: 0, enrolled: 0, declined: 0 }])) as Record<ProgramKey, { accepted: number; enrolled: number; declined: number }>;
  for (const r of rows) {
    for (const p of PROGRAMS) {
      const d = r.decisions[p];
      if (d?.action !== 'accepted') continue;
      out[p].accepted += 1;
      if (d.outcome === 'enrolled' || r.statuses[p] === 'enrolled') out[p].enrolled += 1;
      else if (d.outcome === 'declined' || d.outcome === 'not_enrolled') out[p].declined += 1;
    }
  }
  return out;
}

/** CSV cell (RFC 4180) with spreadsheet formula-injection guard. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
