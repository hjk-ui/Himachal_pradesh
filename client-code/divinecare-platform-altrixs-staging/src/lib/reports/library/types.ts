/**
 * Report library: shared types (pure, browser-safe; no Prisma, no React).
 *
 * A report is a ReportDefinition in ./registry.ts: metadata the library page lists (title,
 * category, definitions, data sources, parameters, roles) plus a server run() that returns a
 * ReportOutput. The framework (./execute.ts) validates parameters, applies small-cell
 * suppression, paginates, times out and audit-logs every run and export.
 */
import type { StaffRole } from '@/types/roles';

export const REPORT_CATEGORIES = [
  { id: 'operational', label: 'Operational' },
  { id: 'clinical', label: 'Clinical' },
  { id: 'billing', label: 'Billing & RCM' },
  { id: 'programs', label: 'Programs' },
  { id: 'compliance', label: 'Compliance & System' },
] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number]['id'];

export const DATE_PRESETS = [
  { id: 'this_month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: 'last_30', label: 'Last 30 days' },
  { id: 'last_90', label: 'Last 90 days' },
  { id: 'qtd', label: 'Quarter to date' },
  { id: 'last_quarter', label: 'Last quarter' },
  { id: 'ytd', label: 'Year to date' },
  { id: 'last_year', label: 'Last calendar year' },
  { id: 'custom', label: 'Custom range' },
] as const;
export type DatePreset = (typeof DATE_PRESETS)[number]['id'];

export const CLIENT_STATUS_OPTIONS = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
  { value: 'DISCHARGED', label: 'Discharged' },
  { value: 'all', label: 'All statuses' },
] as const;

/**
 * Parameter kinds. dateRange is always keyed "range" (from / to / preset in the request);
 * site / provider / payer are keyed by their kind; select params use their own key.
 */
export type ReportParamSpec =
  | { kind: 'dateRange'; key: 'range'; label: string; defaultPreset: DatePreset; maxDays?: number; help?: string }
  | { kind: 'site'; key: 'site'; label: string; help?: string }
  | { kind: 'provider'; key: 'provider'; label: string; help?: string }
  | { kind: 'payer'; key: 'payer'; label: string; help?: string }
  | {
      kind: 'select';
      key: string;
      label: string;
      options: readonly { value: string; label: string }[];
      default: string;
      help?: string;
    };

export type ColumnType = 'text' | 'number' | 'money' | 'percent' | 'date' | 'datetime' | 'days';

export type ReportColumn = {
  key: string;
  label: string;
  type: ColumnType;
  /** Hover text in the table header */
  description?: string;
  /**
   * Small-cell suppression for non-clinical viewers of aggregate clinical reports:
   * 'count' = a count cell (1-9 shown as "<10"); { rateOf } = a rate whose denominator is that column.
   */
  smallCell?: 'count' | { rateOf: string };
};

export type CellValue = string | number | boolean | null;
export type ReportRow = Record<string, CellValue>;

export type ReportKpi = {
  label: string;
  value: CellValue;
  type: ColumnType;
  hint?: string;
  /** Same rule as columns (the KPI is suppressed for non-clinical viewers when small) */
  smallCell?: 'count' | { denominator: number };
};

export type ChartSpec = {
  type: 'bar' | 'stackedBar' | 'line';
  /** Row key for the x axis (category or month) */
  xKey: string;
  series: { key: string; label: string }[];
  /** Rows for the chart; defaults to the report rows (first 40) */
  data?: ReportRow[];
  valueType?: ColumnType;
};

/** One data source the report reads, with its freshness and whether it held any data. */
export type ReportSource = {
  name: string;
  /** ISO instant of the newest row / import, when known */
  asOf?: string | null;
  /** Rows read for this run (count only) */
  rows?: number | null;
  /** True when the source has no rows at all for this organization / scope (shown as "no data") */
  empty?: boolean;
  note?: string;
};

/** What a report's run() returns. Money is integer cents in 'money' columns. */
export type ReportOutput = {
  columns: ReportColumn[];
  rows: ReportRow[];
  kpis?: ReportKpi[];
  chart?: ChartSpec | null;
  sources: ReportSource[];
  /** Plain-language notes: "No PHQ-9 scores recorded", excluded rows, data limits */
  notices?: string[];
  /** True when the runner hit its row cap */
  truncated?: boolean;
  /** Protected (Part 2 / VIP) clients left out of this run (count only) */
  hiddenSensitiveClients?: number;
  /** Explicit "data as of" (else the newest source asOf, else the run time) */
  asOf?: string | null;
};

/** Resolved, validated parameters handed to run(). */
export type ResolvedParams = {
  range: null | {
    preset: DatePreset;
    /** YYYY-MM-DD inclusive, practice time zone */
    fromDate: string;
    toDate: string;
    /** Practice-midnight of fromDate (UTC instant) */
    from: Date;
    /** Practice-midnight of the day after toDate (queries use lt) */
    toExclusive: Date;
    /** Calendar-day bounds at UTC midnight, for date-only columns (Valant service dates, @db.Date) */
    dayFrom: Date;
    dayToExclusive: Date;
  };
  site: string | null;
  provider: string | null;
  payer: string | null;
  /** select params by key (always filled with the default when absent) */
  values: Record<string, string>;
};

export type ReportScopeKind = 'organization' | 'caseload';

/**
 * Who may run a report. roles: base staff roles. medicalDirector: a verified Medical Director
 * (prescriber role + flag) also runs it, org-wide. Patient scope inside run() always comes from
 * clientAccessWhere (caseload roles see their own clients), never from this list.
 */
export type ReportAccess = { roles: readonly StaffRole[]; medicalDirector?: boolean };

export type ReportMeta = {
  id: string;
  title: string;
  category: ReportCategory;
  description: string;
  /** Term -> definition / formula, shown in the Definitions panel and exported */
  definitions: readonly (readonly [string, string])[];
  /** Tables / imports the report reads (static description; run() reports freshness) */
  dataSources: readonly string[];
  params: readonly ReportParamSpec[];
  access: ReportAccess;
  /** 'patient' = rows identify clients (PHI); 'aggregate' = counts / money only */
  output: 'patient' | 'aggregate';
  /** Aggregate clinical counts: suppress cells under 10 for non-clinical viewers */
  suppressSmallCells?: boolean;
  /** A richer existing page for the same subject (linked from the library card and runner) */
  link?: { href: string; label: string };
  /** Search words */
  keywords?: string;
};

export type LibraryEntry = ReportMeta & { kind: 'report' };

/** Existing report pages listed in the library next to the registry reports. */
export type LibraryLink = {
  kind: 'link';
  id: string;
  title: string;
  category: ReportCategory;
  description: string;
  href: string;
  /** Page path whose role rule decides visibility (canAccessPath) */
  gatePath: string;
  keywords?: string;
};

/** JSON shape of /api/reports/library/[id]/run */
export type ReportRunResult = {
  reportId: string;
  title: string;
  category: ReportCategory;
  output: 'patient' | 'aggregate';
  generatedAt: string;
  asOf: string;
  timeZone: string;
  scope: ReportScopeKind;
  params: {
    preset: DatePreset | null;
    fromDate: string | null;
    toDate: string | null;
    site: string | null;
    provider: string | null;
    payer: string | null;
    values: Record<string, string>;
  };
  /** Human-readable parameter summary ("Oct 1 - Oct 19, 2026 · Bowie") */
  paramLabel: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  totalRows: number;
  page: number;
  pageSize: number;
  kpis: ReportKpi[];
  chart: ChartSpec | null;
  sources: ReportSource[];
  notices: string[];
  definitions: readonly (readonly [string, string])[];
  suppressed: boolean;
  truncated: boolean;
  hiddenSensitiveClients: number;
  durationMs: number;
};

export type ReportOptions = {
  sites: { id: string; name: string }[];
  providers: { id: string; name: string }[];
  payers: string[];
};
