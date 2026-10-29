import { canAccessPath } from '@/lib/auth/roleAccess';
import { toCsv } from '@/lib/browser/downloadFile';
import { isoDate } from '@/lib/migration/valantReportCommon';
import {
  addValantGroup,
  emptyValantMoney,
  firstPayer,
  foldValantByKey,
  NO_PAYER,
  rate,
  zonedStartOfDay,
  zonedYmd,
  type Rate,
  type ValantMoney,
} from '@/lib/reports/outcomesReports';

/**
 * Billing overview (/dashboard/billing) and Medical billing (/dashboard/medical/billing): pure
 * aggregation for the two sources shown side by side, never summed together:
 *  - "Valant (imported)": ValantTransaction rows (reference only; by date of service)
 *  - "Altrixs (live)": Claim / Payment / PatientStatement / MedicalCharge rows
 *
 * Category signs and buckets come from the Outcomes reports helpers (addValantGroup): Valant stores
 * payments and credits NEGATIVE; they are shown POSITIVE here. No number is estimated: a metric
 * without data is null.
 */

export const BILLING_OVERVIEW_PATH = '/dashboard/billing';
export const MEDICAL_BILLING_PATH = '/dashboard/medical/billing';
export const DATA_IMPORT_PATH = '/dashboard/admin/migration';
/** Valant Transaction Journal facility for primary care (the facility column, never CPT codes) */
export const FAMILY_PRACTICE_FACILITY = 'Family Practice';

export const NO_ALTRIXS_CLAIMS_NOTE = 'No Altrixs claims yet — claims start after go-live.';
export const NO_FAMILY_PRACTICE_NOTE =
  'Primary-care history appears after the Valant Transaction Journal is imported (Admin › Data import) — it identifies Family Practice charges.';
export const NO_FACILITY_NOTE =
  'Location filter appears after the Valant Transaction Journal is imported: until then imported rows carry no facility.';

/** Same rule as the page: billing core + leadership + office manager (roleAccess /dashboard/billing) */
export function canViewBillingOverview(role: string | null | undefined): boolean {
  return canAccessPath(role, BILLING_OVERVIEW_PATH);
}

// ─── Date range ──────────────────────────────────────────────────────────────

export const OVERVIEW_PRESETS = ['mtd', '90d', 'custom'] as const;
export type OverviewPreset = (typeof OVERVIEW_PRESETS)[number];
const DAY_MS = 86_400_000;
const MAX_RANGE_DAYS = 3 * 366;

export type OverviewRange = {
  preset: OverviewPreset;
  fromDate: string;
  toDate: string;
  /** Valant service dates are calendar days stored at UTC noon: UTC midnight bounds */
  valantFrom: Date;
  valantToExclusive: Date;
  /** Altrixs timestamps: clinic-time-zone day bounds */
  from: Date;
  toExclusive: Date;
};

function validYmd(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}

const utcMidnight = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

/** ?preset=mtd|90d or ?from&to (YYYY-MM-DD). Default month to date (clinic time zone). */
export function parseOverviewRange(sp: URLSearchParams, now: Date): { ok: true; range: OverviewRange } | { ok: false; error: string } {
  const fromRaw = (sp.get('from') ?? '').trim();
  const toRaw = (sp.get('to') ?? '').trim();
  const presetRaw = (sp.get('preset') ?? '').trim();
  if (presetRaw && !(OVERVIEW_PRESETS as readonly string[]).includes(presetRaw)) return { ok: false, error: 'Unknown preset' };
  if (fromRaw && !validYmd(fromRaw)) return { ok: false, error: 'from must be YYYY-MM-DD' };
  if (toRaw && !validYmd(toRaw)) return { ok: false, error: 'to must be YYYY-MM-DD' };
  const today = zonedYmd(now);
  let preset: OverviewPreset = (presetRaw as OverviewPreset) || (fromRaw || toRaw ? 'custom' : 'mtd');
  let toDate = toRaw || today;
  let fromDate: string;
  if (preset === 'mtd') {
    toDate = today;
    fromDate = `${today.slice(0, 7)}-01`;
  } else if (preset === '90d') {
    toDate = today;
    fromDate = addDaysYmd(today, -89);
  } else {
    fromDate = fromRaw || `${toDate.slice(0, 7)}-01`;
    preset = 'custom';
  }
  if (fromDate > toDate) return { ok: false, error: 'from must be on or before to' };
  const toNext = addDaysYmd(toDate, 1);
  if (utcMidnight(toNext).getTime() - utcMidnight(fromDate).getTime() > MAX_RANGE_DAYS * DAY_MS) {
    return { ok: false, error: 'Date range is limited to 3 years' };
  }
  return {
    ok: true,
    range: {
      preset,
      fromDate,
      toDate,
      valantFrom: utcMidnight(fromDate),
      valantToExclusive: utcMidnight(toNext),
      from: zonedStartOfDay(fromDate),
      toExclusive: zonedStartOfDay(toNext),
    },
  };
}

/** The 12 calendar months (YYYY-MM) ending with the month of `toDate`, oldest first */
export function trailingMonths(toDate: string, n = 12): string[] {
  const [y, m] = toDate.split('-').map(Number);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

// ─── Valant KPIs ─────────────────────────────────────────────────────────────

export type CategoryGroup = { category: string; cents: number; count: number };

export type ValantKpis = ValantMoney & {
  /** insurance payments + patient payments (refunds already netted in by sign) */
  netCollectionsCents: number;
  /** net collections ÷ charges, both for the same dates of service */
  collectionRate: Rate;
  /** distinct patient + date of service with a positive charge line */
  visitsBilled: number;
  /** charges ÷ visits billed; null with no visits */
  avgChargePerVisitCents: number | null;
};

export function valantKpis(groups: readonly CategoryGroup[], visitsBilled: number): ValantKpis {
  const m = emptyValantMoney();
  for (const g of groups) addValantGroup(m, g);
  const net = m.insurancePaymentsCents + m.patientPaymentsCents;
  return {
    ...m,
    netCollectionsCents: net,
    collectionRate: rate(net, m.chargesCents > 0 ? m.chargesCents : 0),
    visitsBilled,
    avgChargePerVisitCents: visitsBilled > 0 ? Math.round(m.chargesCents / visitsBilled) : null,
  };
}

/** Distinct (patient, date of service) keys among positive charge lines */
export function countVisits(rows: readonly { valantPatientId: string; serviceDate: Date | string | null }[]): number {
  const keys = new Set<string>();
  for (const r of rows) {
    if (!r.serviceDate) continue;
    const day = typeof r.serviceDate === 'string' ? r.serviceDate.slice(0, 10) : isoDate(r.serviceDate);
    keys.add(`${r.valantPatientId}|${day}`);
  }
  return keys.size;
}

// ─── Trend ───────────────────────────────────────────────────────────────────

export type TrendPoint = {
  month: string;
  chargesCents: number;
  insurancePaymentsCents: number;
  patientPaymentsCents: number;
  /** insurance + patient payments */
  paymentsCents: number;
  adjustmentsCents: number;
};

/** Day × category groups -> one point per month in `months` (months with no rows are 0: no rows that month) */
export function valantTrend(groups: readonly (CategoryGroup & { serviceDate: Date | string | null })[], months: readonly string[]): TrendPoint[] {
  const folded = foldValantByKey(
    groups.map((g) => ({
      key: g.serviceDate ? (typeof g.serviceDate === 'string' ? g.serviceDate : g.serviceDate.toISOString()).slice(0, 7) : null,
      category: g.category,
      cents: g.cents,
      count: g.count,
    })),
    (k) => k ?? ''
  );
  const byMonth = new Map(folded.map((r) => [r.key, r]));
  return months.map((month) => {
    const r = byMonth.get(month) ?? { ...emptyValantMoney(), key: month };
    return {
      month,
      chargesCents: r.chargesCents,
      insurancePaymentsCents: r.insurancePaymentsCents,
      patientPaymentsCents: r.patientPaymentsCents,
      paymentsCents: r.insurancePaymentsCents + r.patientPaymentsCents,
      adjustmentsCents: r.adjustmentsCents,
    };
  });
}

// ─── Payer mix ───────────────────────────────────────────────────────────────

export type PayerMixSource = 'valant_journal' | 'insurance_aging' | 'client_insurance' | 'none';

export type PayerMixRow = {
  payer: string;
  chargesCents: number;
  paymentsCents: number;
  insurancePaymentsCents: number;
  patientPaymentsCents: number;
  chargeLines: number;
};

export type PayerMix = {
  source: PayerMixSource;
  sourceNote: string;
  /** Valant rows in range that carry an insurance cell (journal-imported) */
  rowsWithInsurance: number;
  rowsInRange: number;
  topByCharges: PayerMixRow[];
  topByPayments: PayerMixRow[];
  /** Fallback (no insurance cells): payer A/R from the insurance aging snapshot, or active clients per payer */
  fallback: { payer: string; cents: number | null; clients: number | null }[];
};

export const PAYER_SOURCE_NOTE: Record<PayerMixSource, string> = {
  valant_journal:
    "From the Valant Transaction Journal insurance cell; a row listing several payers is credited to the first one listed. Rows without an insurance cell are grouped as self-pay / blank.",
  insurance_aging:
    'Valant Transaction Journal not imported yet, so charges and payments cannot be split by payer. Shown instead: open insurance A/R by payer from the latest Valant insurance aging snapshot.',
  client_insurance:
    'Valant Transaction Journal not imported yet and no insurance aging snapshot: shown instead is the number of active clients per insurance on their Altrixs chart (no dollar amounts).',
  none: 'No payer data yet: import the Valant Transaction Journal (Admin › Data import).',
};

/** Insurance × category groups -> payer mix; null keys = no insurance cell */
export function valantPayerMix(
  groups: readonly (CategoryGroup & { insurance: string | null })[],
  top = 10
): Pick<PayerMix, 'rowsWithInsurance' | 'rowsInRange' | 'topByCharges' | 'topByPayments'> {
  let rowsWithInsurance = 0;
  let rowsInRange = 0;
  for (const g of groups) {
    rowsInRange += g.count;
    if (g.insurance && g.insurance.trim()) rowsWithInsurance += g.count;
  }
  const folded = foldValantByKey(
    groups.map((g) => ({ key: g.insurance, category: g.category, cents: g.cents, count: g.count })),
    firstPayer
  );
  const rows: PayerMixRow[] = folded.map((r) => ({
    payer: r.key,
    chargesCents: r.chargesCents,
    insurancePaymentsCents: r.insurancePaymentsCents,
    patientPaymentsCents: r.patientPaymentsCents,
    paymentsCents: r.insurancePaymentsCents + r.patientPaymentsCents,
    chargeLines: r.chargeCount,
  }));
  return {
    rowsWithInsurance,
    rowsInRange,
    topByCharges: [...rows].filter((r) => r.chargesCents !== 0).sort((a, b) => b.chargesCents - a.chargesCents || a.payer.localeCompare(b.payer)).slice(0, top),
    topByPayments: [...rows].filter((r) => r.paymentsCents !== 0).sort((a, b) => b.paymentsCents - a.paymentsCents || a.payer.localeCompare(b.payer)).slice(0, top),
  };
}

export { NO_PAYER };

/** Pick the payer-mix source: journal insurance cells first, then insurance aging, then chart insurance */
export function choosePayerMix(input: {
  valant: Pick<PayerMix, 'rowsWithInsurance' | 'rowsInRange' | 'topByCharges' | 'topByPayments'>;
  insuranceAging: { payerName: string; totalCents: number }[] | null;
  clientInsurance: { payer: string; clients: number }[];
  top?: number;
}): PayerMix {
  const top = input.top ?? 10;
  if (input.valant.rowsWithInsurance > 0) {
    return { source: 'valant_journal', sourceNote: PAYER_SOURCE_NOTE.valant_journal, ...input.valant, fallback: [] };
  }
  const base = { ...input.valant, topByCharges: [], topByPayments: [] };
  if (input.insuranceAging && input.insuranceAging.length) {
    const m = new Map<string, number>();
    for (const r of input.insuranceAging) {
      const k = r.payerName.replace(/\s+/g, ' ').trim() || 'Payer not named';
      m.set(k, (m.get(k) ?? 0) + r.totalCents);
    }
    const fallback = [...m.entries()]
      .map(([payer, cents]) => ({ payer, cents, clients: null }))
      .sort((a, b) => b.cents - a.cents || a.payer.localeCompare(b.payer))
      .slice(0, top);
    return { source: 'insurance_aging', sourceNote: PAYER_SOURCE_NOTE.insurance_aging, ...base, fallback };
  }
  if (input.clientInsurance.length) {
    const fallback = [...input.clientInsurance]
      .sort((a, b) => b.clients - a.clients || a.payer.localeCompare(b.payer))
      .slice(0, top)
      .map((r) => ({ payer: r.payer, cents: null, clients: r.clients }));
    return { source: 'client_insurance', sourceNote: PAYER_SOURCE_NOTE.client_insurance, ...base, fallback };
  }
  return { source: 'none', sourceNote: PAYER_SOURCE_NOTE.none, ...base, fallback: [] };
}

// ─── CPT usage ───────────────────────────────────────────────────────────────

export type CptCodeGroup = {
  /** Raw Valant code ("90837T") */
  code: string;
  codeBase: string | null;
  /** net charges (all charge rows, reversals included) */
  cents: number;
  /** positive charge lines */
  lines: number;
};

export type FeeLite = { code: string; feeCents: number; active: boolean; description?: string | null };

export type CptUsageRow = {
  codeBase: string;
  description: string | null;
  /** charge lines (Valant exports no units column) */
  lines: number;
  chargesCents: number;
  /** Σ lines × active fee-schedule fee of the exact Valant code; null when no line could be priced */
  expectedCents: number | null;
  pricedLines: number;
  unpricedLines: number;
  codes: string[];
};

const normCode = (c: string) => c.trim().replace(/\s+/g, ' ').toUpperCase();

/**
 * One row per CPT/HCPCS base. "Expected at fee schedule" prices each Valant code by the exact
 * fee-schedule item with that code (the fee schedule is Valant's own Fees export); codes with no
 * active fee item stay unpriced (never a built-in default rate).
 */
export function cptUsage(groups: readonly CptCodeGroup[], fees: readonly FeeLite[]): CptUsageRow[] {
  const feeByCode = new Map<string, FeeLite>();
  for (const f of fees) if (f.active) feeByCode.set(normCode(f.code), f);
  const map = new Map<string, CptUsageRow>();
  for (const g of groups) {
    const base = (g.codeBase || g.code).trim().toUpperCase();
    const row = map.get(base) ?? {
      codeBase: base, description: null, lines: 0, chargesCents: 0, expectedCents: null, pricedLines: 0, unpricedLines: 0, codes: [],
    };
    row.lines += g.lines;
    row.chargesCents += g.cents;
    const fee = feeByCode.get(normCode(g.code)) ?? null;
    if (fee && g.lines > 0) {
      row.expectedCents = (row.expectedCents ?? 0) + fee.feeCents * g.lines;
      row.pricedLines += g.lines;
      if (!row.description && fee.description) row.description = fee.description;
    } else {
      row.unpricedLines += g.lines;
    }
    if (!row.codes.includes(g.code)) row.codes.push(g.code);
    map.set(base, row);
  }
  const baseFee = (b: string) => feeByCode.get(b);
  for (const r of map.values()) {
    r.codes.sort();
    if (!r.description) r.description = baseFee(r.codeBase)?.description ?? null;
  }
  return [...map.values()].sort((a, b) => b.chargesCents - a.chargesCents || b.lines - a.lines || a.codeBase.localeCompare(b.codeBase));
}

// ─── Altrixs (live) ──────────────────────────────────────────────────────────

export type AltrixsClaimSummary = {
  total: number;
  /** sent to a payer: SUBMITTED + ACCEPTED + DENIED + PAID */
  submitted: number;
  /** DRAFT + READY + SUBMITTED + ACCEPTED (not yet paid or denied) */
  pending: number;
  paid: number;
  denied: number;
  billedCents: number;
  paidCents: number;
};

export function summarizeAltrixsClaims(
  groups: readonly { status: string; count: number; amountCents: number | null; paidAmount: number | null }[]
): AltrixsClaimSummary {
  const out: AltrixsClaimSummary = { total: 0, submitted: 0, pending: 0, paid: 0, denied: 0, billedCents: 0, paidCents: 0 };
  for (const g of groups) {
    out.total += g.count;
    if (['SUBMITTED', 'ACCEPTED', 'DENIED', 'PAID'].includes(g.status)) {
      out.submitted += g.count;
      out.billedCents += g.amountCents ?? 0;
    }
    if (['DRAFT', 'READY', 'SUBMITTED', 'ACCEPTED'].includes(g.status)) out.pending += g.count;
    if (g.status === 'PAID') {
      out.paid += g.count;
      out.paidCents += Math.round((g.paidAmount ?? 0) * 100);
    }
    if (g.status === 'DENIED') out.denied += g.count;
  }
  return out;
}

export type AltrixsPaymentSummary = { count: number; insuranceCents: number; patientCents: number; totalCents: number };

/** Payment rows by method (STUB = test charge, never money) */
export function summarizeAltrixsPayments(groups: readonly { method: string; count: number; cents: number }[]): AltrixsPaymentSummary {
  const out: AltrixsPaymentSummary = { count: 0, insuranceCents: 0, patientCents: 0, totalCents: 0 };
  for (const g of groups) {
    if (g.method === 'STUB') continue;
    out.count += g.count;
    if (g.method === 'INSURANCE') out.insuranceCents += g.cents;
    else out.patientCents += g.cents;
  }
  out.totalCents = out.insuranceCents + out.patientCents;
  return out;
}

// ─── CSV ─────────────────────────────────────────────────────────────────────

export const OVERVIEW_CSV_TABLES = ['trend', 'payers', 'cpt'] as const;
export type OverviewCsvTable = (typeof OVERVIEW_CSV_TABLES)[number];

const dollars = (c: number | null | undefined) => (c == null ? '' : (c / 100).toFixed(2));

export function overviewCsv(
  table: OverviewCsvTable,
  data: { trend: TrendPoint[]; payerMix: PayerMix; cpt: CptUsageRow[] },
  meta: { title: string; source: string; fromDate: string; toDate: string }
): string {
  const head: unknown[][] = [[meta.title], [`Source: ${meta.source}`], [`Dates of service ${meta.fromDate} to ${meta.toDate}`], []];
  if (table === 'trend') {
    return toCsv([
      ...head.slice(0, 2), ['Last 12 months by month of service'], [],
      ['Month', 'Charges', 'Insurance payments', 'Patient payments', 'Payments', 'Adjustments'],
      ...data.trend.map((t) => [t.month, dollars(t.chargesCents), dollars(t.insurancePaymentsCents), dollars(t.patientPaymentsCents), dollars(t.paymentsCents), dollars(t.adjustmentsCents)]),
    ]);
  }
  if (table === 'payers') {
    const pm = data.payerMix;
    if (pm.source !== 'valant_journal') {
      return toCsv([...head, [pm.sourceNote], [], ['Payer', 'Amount', 'Clients'], ...pm.fallback.map((f) => [f.payer, dollars(f.cents), f.clients ?? ''])]);
    }
    return toCsv([
      ...head, [pm.sourceNote], [],
      ['Top payers by charges'], ['Payer', 'Charges', 'Charge lines', 'Insurance payments', 'Patient payments'],
      ...pm.topByCharges.map((r) => [r.payer, dollars(r.chargesCents), r.chargeLines, dollars(r.insurancePaymentsCents), dollars(r.patientPaymentsCents)]),
      [],
      ['Top payers by payments'], ['Payer', 'Payments', 'Insurance payments', 'Patient payments', 'Charges'],
      ...pm.topByPayments.map((r) => [r.payer, dollars(r.paymentsCents), dollars(r.insurancePaymentsCents), dollars(r.patientPaymentsCents), dollars(r.chargesCents)]),
    ]);
  }
  return toCsv([
    ...head,
    ['CPT / HCPCS', 'Description', 'Charge lines', 'Charges', 'Expected at fee schedule', 'Priced lines', 'Unpriced lines', 'Valant codes'],
    ...data.cpt.map((r) => [r.codeBase, r.description ?? '', r.lines, dollars(r.chargesCents), dollars(r.expectedCents), r.pricedLines, r.unpricedLines, r.codes.join(' ')]),
  ]);
}

// ─── Definitions (shown in the page's definitions panel) ─────────────────────

export const OVERVIEW_DEFINITIONS: { term: string; text: string }[] = [
  { term: 'Sources', text: 'Valant (imported) and Altrixs (live) are shown side by side and never added together. Valant figures are a reference copy of the Valant transaction export, grouped by date of service.' },
  { term: 'Charges', text: 'Valant charge lines (CPT/HCPCS codes), net of any charge reversals. No-show / late-cancel fees are listed separately and not counted as charges.' },
  { term: 'Insurance payments', text: 'Valant insurance EFT / check / card payments, shown positive. Take-backs reduce the total.' },
  { term: 'Patient payments', text: 'Valant patient cash / check / card / autopay payments, net of patient refunds, shown positive. Prepayment transfers onto a date of service are transfers, not new payments.' },
  { term: 'Adjustments', text: 'Valant insurance adjustments (contractual, denials, charge-backs) plus patient adjustments (courtesy discounts, write-offs, credit/charge adjustments), shown positive.' },
  { term: 'Net collections', text: 'Insurance payments + patient payments for the dates of service in range.' },
  { term: 'Collection rate', text: 'Net collections ÷ charges for the same dates of service (gross collection rate). Recent dates of service are still being paid, so the rate for a short or recent period reads low.' },
  { term: 'Visits billed', text: 'Distinct patient + date of service with at least one positive charge line.' },
  { term: 'Average charge per visit', text: 'Charges ÷ visits billed.' },
  { term: 'Expected at fee schedule', text: 'Charge lines × the active fee-schedule fee of the same Valant code (Billing › Fee schedule). Lines whose code is not on the fee schedule stay unpriced; no default rate is used. Valant exports no units column, so this counts lines.' },
  { term: 'Altrixs claims', text: 'Claims created in Altrixs in the date range (by created date): submitted = sent to a payer; pending = not yet paid or denied.' },
  { term: 'A/R snapshot', text: 'Insurance and patient A/R are the totals of the latest Valant aging imports (as-of date shown), not live balances.' },
];
