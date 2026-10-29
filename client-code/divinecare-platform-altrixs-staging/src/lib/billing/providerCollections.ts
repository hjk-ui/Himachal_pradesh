import { toCsv } from '@/lib/browser/downloadFile';
import { formatCents } from '@/lib/migration/valantReportCommon';

/**
 * Billing → Provider Collections: Valant's "Payments, Refunds and Adjustments" report (by provider),
 * rebuilt from imported Valant transactions (ValantTransaction). Pure: the API route does one Prisma
 * groupBy (provider × code) and hands the groups here; safe in tests and client components.
 *
 * Sections and descriptions follow Valant's report and are keyed by Valant's transaction CODE, not our
 * import category. Amounts are shown POSITIVE as Valant prints them; a group that nets the opposite way
 * from its section (e.g. payments that net to a take-back) shows negative.
 */

export const PROVIDER_COLLECTIONS_PATH = '/dashboard/billing/provider-collections';

export const DATE_BASIS_NOTE =
  "Grouped by date of service; Valant's report uses posted date, so totals can differ slightly for payments posted this year on prior-year visits";

export type SectionKey = 'payments' | 'refunds' | 'credit_adjustments' | 'charge_adjustments' | 'other';

export const SECTION_ORDER: SectionKey[] = ['payments', 'refunds', 'credit_adjustments', 'charge_adjustments', 'other'];

export const SECTION_LABEL: Record<SectionKey, string> = {
  payments: 'Payments',
  refunds: 'Refunds',
  credit_adjustments: 'Credit Adjustments',
  charge_adjustments: 'Charge Adjustments',
  other: 'Other',
};

/**
 * Stored sign of a section's normal transactions: payments and credits are stored negative, refunds and
 * charge adjustments positive. Display = stored × sign, so normal amounts show positive.
 * "Other" (unmapped codes) shows the stored amount as is (credits negative, debits positive).
 */
export const SECTION_SIGN: Record<SectionKey, 1 | -1> = {
  payments: -1,
  refunds: 1,
  credit_adjustments: -1,
  charge_adjustments: 1,
  other: 1,
};

type CodeDef = { code: string; section: SectionKey; description: string };

const ORDINAL = ['Primary', 'Secondary', 'Tertiary'] as const;
const numbered = (prefix: string, section: SectionKey, desc: (ord: string) => string): CodeDef[] =>
  ORDINAL.map((ord, i) => ({ code: `${prefix} ${i + 1}`, section, description: desc(ord) }));

/** Valant code -> section and description, in report order (from Valant's own report) */
export const COLLECTION_CODES: CodeDef[] = [
  { code: 'Auto Payment CC', section: 'payments', description: 'Auto Payment CC' },
  { code: 'Cash', section: 'payments', description: 'Cash Payment' },
  { code: 'Check', section: 'payments', description: 'Check Payment' },
  { code: 'Credit Cd', section: 'payments', description: 'Credit Payment' },
  ...numbered('Denied', 'payments', (o) => `${o} Insurance Denied`),
  ...numbered('Ins Check', 'payments', (o) => `${o} Ins Check Payment`),
  ...numbered('Ins Check Partial', 'payments', (o) => `Partial ${o} Ins Check Payment`),
  ...numbered('Ins EFT', 'payments', (o) => `${o} Ins EFT Payment`),
  ...numbered('Ins EFT Partial', 'payments', (o) => `Partial ${o} Ins EFT Payment`),
  { code: 'Ins CC 1', section: 'payments', description: 'Primary CC Ins Payment' },
  { code: 'Pat Xfer From DOS', section: 'payments', description: 'Transfer Payment To Patient Account' },
  { code: 'Prepay Xfer', section: 'payments', description: 'Prepayment Transfer' },
  { code: 'Ins Chg Back', section: 'refunds', description: 'Insurance Charge Back' },
  { code: 'Pat Refund', section: 'refunds', description: 'Patient Refund' },
  { code: 'Pat Xfer To DOS', section: 'refunds', description: 'Transfer Payment From Patient Account' },
  { code: 'AdjCredit', section: 'credit_adjustments', description: 'Credit Adjustment' },
  { code: 'InsAdjust', section: 'credit_adjustments', description: 'Insurance Adjustment' },
  { code: 'Pt Dsct', section: 'credit_adjustments', description: 'Patient Courtesy Discount' },
  { code: 'Debt WO', section: 'credit_adjustments', description: 'Bad Debt Write Off' },
  { code: 'AdjCharge', section: 'charge_adjustments', description: 'Charge Adjustment' },
];

/** Trimmed, single-spaced, lower case */
export function normalizeCode(code: string | null | undefined): string {
  return String(code ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

const CODE_INDEX = new Map(COLLECTION_CODES.map((d, i) => [normalizeCode(d.code), { ...d, order: i }]));

/** Fee / admin codes Valant leaves out of this report (no-show, late cancel, reschedule, placeholder) */
export function isExcludedFeeCode(code: string): boolean {
  const c = normalizeCode(code);
  return c === 'cancelled' || c === 'rescheduled' || c === '0000' || c.startsWith('nsh');
}

export type CodeClass =
  | { kind: 'section'; section: SectionKey; code: string; description: string; order: number }
  | { kind: 'excluded'; reason: 'charge' | 'fee' };

/**
 * Mapped code -> its section (whatever our import category says). Otherwise charges and fee/admin codes
 * are excluded (not in Valant's report); any other code goes to "Other" with its raw code.
 */
export function classifyCollectionCode(code: string, category: string | null | undefined): CodeClass {
  const def = CODE_INDEX.get(normalizeCode(code));
  if (def) return { kind: 'section', section: def.section, code: def.code, description: def.description, order: def.order };
  if (category === 'charge') return { kind: 'excluded', reason: 'charge' };
  if (category === 'fee' || isExcludedFeeCode(code)) return { kind: 'excluded', reason: 'fee' };
  const raw = String(code ?? '').trim().replace(/\s+/g, ' ');
  return { kind: 'section', section: 'other', code: raw || '(blank)', description: raw || '(blank)', order: Number.MAX_SAFE_INTEGER };
}

/** One Prisma groupBy row (provider × code × category) */
export type CollectionGroup = {
  providerCode: string | null;
  providerUserId: string | null;
  code: string;
  category: string | null;
  cents: number;
  count: number;
};

export type ProviderRef = { key: string; label: string; valantCodes: string[]; matchedStaff: boolean };

/** Staff name when the Valant provider matched a user, else the Valant provider code, else "Unassigned" */
export function providerRef(
  g: Pick<CollectionGroup, 'providerCode' | 'providerUserId'>,
  staffNames: ReadonlyMap<string, string | null>
): { key: string; label: string; matchedStaff: boolean } {
  const code = String(g.providerCode ?? '').trim();
  if (g.providerUserId) {
    const name = staffNames.get(g.providerUserId)?.trim();
    return { key: `u:${g.providerUserId}`, label: name || code || 'Matched staff', matchedStaff: true };
  }
  if (code) return { key: `c:${code.toLowerCase()}`, label: code, matchedStaff: false };
  return { key: 'none', label: 'Unassigned', matchedStaff: false };
}

export type CollectionRow = { code: string; description: string; count: number; cents: number; pctOfSection: number | null };
export type ProviderBlock = {
  key: string;
  label: string;
  valantCodes: string[];
  matchedStaff: boolean;
  rows: CollectionRow[];
  count: number;
  cents: number;
  pctOfSection: number | null;
};
export type CollectionSection = { key: SectionKey; label: string; providers: ProviderBlock[]; count: number; cents: number };

export type CollectionsReport = {
  sections: CollectionSection[];
  summary: {
    paymentsCents: number;
    refundsCents: number;
    creditAdjustmentsCents: number;
    chargeAdjustmentsCents: number;
    otherCents: number;
    netCollectionsCents: number;
  };
  /** Every provider in the date range (before the provider / section filters), for the filter list */
  providers: ProviderRef[];
  /** Codes that are neither mapped nor charges/fees (they are in "Other") */
  unmappedCodes: { code: string; count: number; cents: number }[];
  excluded: { chargeRows: number; chargeCents: number; feeRows: number; feeCents: number };
};

/** part / whole as a percent; null when the whole is 0 */
export function percentOf(part: number, whole: number): number | null {
  return whole === 0 ? null : (part / whole) * 100;
}

export function buildCollectionsReport(
  groups: readonly CollectionGroup[],
  staffNames: ReadonlyMap<string, string | null>,
  opts: { provider?: string | null; section?: SectionKey | null } = {}
): CollectionsReport {
  const excluded = { chargeRows: 0, chargeCents: 0, feeRows: 0, feeCents: 0 };
  const providerIndex = new Map<string, ProviderRef>();
  const unmapped = new Map<string, { code: string; count: number; cents: number }>();
  // section -> provider key -> code key -> row
  type Acc = { def: Extract<CodeClass, { kind: 'section' }>; count: number; stored: number };
  const acc = new Map<SectionKey, Map<string, Map<string, Acc>>>();

  for (const g of groups) {
    const cls = classifyCollectionCode(g.code, g.category);
    if (cls.kind === 'excluded') {
      if (cls.reason === 'charge') {
        excluded.chargeRows += g.count;
        excluded.chargeCents += g.cents;
      } else {
        excluded.feeRows += g.count;
        excluded.feeCents += g.cents;
      }
      continue;
    }
    const p = providerRef(g, staffNames);
    const ref = providerIndex.get(p.key) ?? { ...p, valantCodes: [] };
    const vc = String(g.providerCode ?? '').trim();
    if (vc && !ref.valantCodes.includes(vc)) ref.valantCodes.push(vc);
    providerIndex.set(p.key, ref);

    if (cls.section === 'other') {
      const k = normalizeCode(cls.code);
      const u = unmapped.get(k) ?? { code: cls.code, count: 0, cents: 0 };
      u.count += g.count;
      u.cents += g.cents;
      unmapped.set(k, u);
    }
    if (opts.provider && opts.provider !== p.key) continue;

    const bySection = acc.get(cls.section) ?? new Map<string, Map<string, Acc>>();
    acc.set(cls.section, bySection);
    const byCode = bySection.get(p.key) ?? new Map<string, Acc>();
    bySection.set(p.key, byCode);
    const ck = normalizeCode(cls.code);
    const row = byCode.get(ck) ?? { def: cls, count: 0, stored: 0 };
    row.count += g.count;
    row.stored += g.cents;
    byCode.set(ck, row);
  }

  const sections: CollectionSection[] = [];
  const totals: Record<SectionKey, number> = { payments: 0, refunds: 0, credit_adjustments: 0, charge_adjustments: 0, other: 0 };
  for (const key of SECTION_ORDER) {
    const sign = SECTION_SIGN[key];
    const byProvider = acc.get(key) ?? new Map<string, Map<string, Acc>>();
    const providers: ProviderBlock[] = [];
    for (const [pk, byCode] of byProvider) {
      const ref = providerIndex.get(pk)!;
      const rows = [...byCode.values()]
        .sort((a, b) => a.def.order - b.def.order || a.def.code.localeCompare(b.def.code))
        .map((r) => ({ code: r.def.code, description: r.def.description, count: r.count, cents: r.stored * sign, pctOfSection: null as number | null }));
      providers.push({
        key: pk, label: ref.label, valantCodes: [...ref.valantCodes].sort(), matchedStaff: ref.matchedStaff, rows,
        count: rows.reduce((s, r) => s + r.count, 0), cents: rows.reduce((s, r) => s + r.cents, 0), pctOfSection: null,
      });
    }
    const cents = providers.reduce((s, p) => s + p.cents, 0);
    for (const p of providers) {
      p.pctOfSection = percentOf(p.cents, cents);
      for (const r of p.rows) r.pctOfSection = percentOf(r.cents, cents);
    }
    providers.sort((a, b) => b.cents - a.cents || a.label.localeCompare(b.label));
    totals[key] = cents;
    if (opts.section && opts.section !== key) continue;
    sections.push({ key, label: SECTION_LABEL[key], providers, count: providers.reduce((s, p) => s + p.count, 0), cents });
  }

  return {
    sections,
    summary: {
      paymentsCents: totals.payments,
      refundsCents: totals.refunds,
      creditAdjustmentsCents: totals.credit_adjustments,
      chargeAdjustmentsCents: totals.charge_adjustments,
      otherCents: totals.other,
      netCollectionsCents: totals.payments - totals.refunds,
    },
    providers: [...providerIndex.values()].sort((a, b) => a.label.localeCompare(b.label)),
    unmappedCodes: [...unmapped.values()].sort((a, b) => a.code.localeCompare(b.code)),
    excluded,
  };
}

export function formatPct(p: number | null): string {
  return p === null ? '—' : `${p.toFixed(2)}%`;
}

const money = (cents: number) => (cents / 100).toFixed(2);

/** CSV in the report layout: section → provider → code rows, provider subtotals, section totals, summary */
export function buildCollectionsCsv(
  report: CollectionsReport,
  meta: { from: string | null; to: string | null; organizationName: string | null }
): string {
  const rows: unknown[][] = [
    ['Payments, Refunds and Adjustments by provider (from Valant transactions)'],
    ['Facility', meta.organizationName ?? ''],
    ['Date of service', `${meta.from ?? 'any'} to ${meta.to ?? 'any'}`],
    ['Note', DATE_BASIS_NOTE],
    [],
    ['Section', 'Provider', 'Code', 'Description', 'Transactions', 'Amount', '% of section'],
  ];
  for (const s of report.sections) {
    for (const p of s.providers) {
      for (const r of p.rows) rows.push([s.label, p.label, r.code, r.description, r.count, money(r.cents), formatPct(r.pctOfSection)]);
      rows.push([s.label, `${p.label} subtotal`, '', '', p.count, money(p.cents), formatPct(p.pctOfSection)]);
    }
    rows.push([`${s.label} total`, '', '', '', s.count, money(s.cents), s.providers.length ? '100.00%' : '—']);
    rows.push([]);
  }
  const sm = report.summary;
  rows.push(['Summary']);
  rows.push(['Payments', '', '', '', '', money(sm.paymentsCents)]);
  rows.push(['Refunds', '', '', '', '', money(sm.refundsCents)]);
  rows.push(['Credit Adjustments', '', '', '', '', money(sm.creditAdjustmentsCents)]);
  rows.push(['Charge Adjustments', '', '', '', '', money(sm.chargeAdjustmentsCents)]);
  if (sm.otherCents || report.unmappedCodes.length) rows.push(['Other (unmapped codes)', '', '', '', '', money(sm.otherCents)]);
  rows.push(['Net collections (payments - refunds)', '', '', '', '', money(sm.netCollectionsCents)]);
  if (report.unmappedCodes.length) {
    rows.push([]);
    rows.push(['Unmapped codes (in Other)', report.unmappedCodes.map((u) => u.code).join('; ')]);
  }
  return toCsv(rows);
}

/** "$1,234.56" (negative "-$1,234.56") */
export const formatMoney = formatCents;
