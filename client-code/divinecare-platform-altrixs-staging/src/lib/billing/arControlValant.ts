import { prisma } from '@/lib/db/prisma';
import { getAgingLabels, presentRow, type BucketRow } from '@/lib/billing/valantBalances';
import { OVER_120_NOTE, presentAgingTotals, type PresentedBuckets } from '@/lib/billing/valantAgingDisplay';
import { isoDate } from '@/lib/migration/valantReportCommon';

/**
 * Valant RUN-OUT A/R for the A/R Control Center (read only).
 *
 * Owner decision: insurance A/R that existed at the Valant exit is worked to zero IN VALANT and is never
 * posted into Altrixs claims. Until the run-out ends, the only real receivables are the imported Valant
 * aging reports, so the A/R Control Center shows them next to (never mixed into) Altrixs claim A/R.
 *
 * Sources (latest as-of date of each import, each reported separately):
 *  - insurance A/R totals and payer split: ValantInsuranceAgingSnapshot (Insurance Aging Summary)
 *  - patient A/R totals:                   ValantAgingSnapshot (Patient Aging)
 *  - worklist (patient x payer lines):     ValantCombinedAgingRow, primary / secondary / other party lines
 *
 * Facility split is NOT derived: insurance aging rows carry only a payer name (no patient, no claim), so they
 * cannot be linked to ValantTransaction.facility.
 *
 * Buckets follow the practice's Valant aging labels and the "show all as Over 120" display setting; Valant's
 * original buckets are always returned alongside the displayed ones.
 */

export const VALANT_RUNOUT_NOTE =
  'Insurance A/R from Valant is being worked to zero in Valant (run-out). Figures are as of {date} from the last Valant import.';

export const VALANT_WORKLIST_SORTS = ['oldest', 'amount', 'lastBilled', 'name'] as const;
export type ValantWorklistSort = (typeof VALANT_WORKLIST_SORTS)[number];
export const VALANT_WORKLIST_PARTIES = ['primary', 'secondary', 'other'] as const;
export type ValantWorklistParty = (typeof VALANT_WORKLIST_PARTIES)[number];

export const VALANT_WORKLIST_DEFAULT_PAGE_SIZE = 50;
export const VALANT_WORKLIST_MAX_PAGE_SIZE = 200;

type Amounted = BucketRow & { totalCents: number };

export type RunoutTotals = {
  displayBucketsCents: number[];
  valantBucketsCents: number[];
  totalCents: number;
  rows: number;
};

export type RunoutPayer = {
  payerName: string;
  /** insurance aging rows for this payer */
  rowCount: number;
  /** combined-aging insurance lines (patient x payer) with this payer */
  combinedLines: number;
} & PresentedBuckets;

export type ValantWorklistRow = {
  id: string;
  valantPatientId: string;
  clientId: string | null;
  clientName: string | null;
  mrn: string | null;
  party: string;
  payerName: string | null;
  lastBilledAt: string | null;
  /** index (0-4) of the oldest displayed bucket that holds money, -1 when none */
  oldestBucket: number;
} & PresentedBuckets;

export type ValantWorklistQuery = {
  payer?: string | null;
  /** displayed bucket index 0-4: rows with money in that column */
  bucket?: number | null;
  minCents?: number | null;
  party?: ValantWorklistParty | null;
  q?: string | null;
  unmatchedOnly?: boolean;
  sort?: ValantWorklistSort;
  page?: number;
  pageSize?: number;
};

export type ValantRunoutAr = {
  available: boolean;
  note: string;
  labels: string[];
  labelsConfirmed: boolean;
  displayAllOver120: boolean;
  over120Note: string;
  asOf: { insurance: string | null; patient: string | null; combined: string | null };
  /** latest as-of across the three imports (for the note) */
  latestAsOf: string | null;
  totals: { insurance: RunoutTotals | null; patient: RunoutTotals | null; all: RunoutTotals | null };
  combined: { insuranceLines: RunoutTotals; patientLines: RunoutTotals } | null;
  byPayer: RunoutPayer[];
  byFacility: null;
  facilityNote: string;
  unmatched: {
    patientAgingRows: number;
    patientAgingTotal: number;
    combinedPatients: number;
    combinedPatientsTotal: number;
    combinedInsuranceLines: number;
  };
  worklist: {
    rows: ValantWorklistRow[];
    total: number;
    page: number;
    pageSize: number;
    totalCents: number;
    payers: string[];
  };
};

export const FACILITY_NOTE =
  'No facility split: the Valant insurance aging report lists payers only, so balances cannot be tied to a clinic.';

const normPayer = (s: string | null | undefined) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/** Column sums (displayed + original) for a set of stored aging rows */
export function sumAgingRows(rows: readonly Amounted[], allOver120: boolean): RunoutTotals {
  const t = presentAgingTotals(rows.map((r) => presentRow(r, allOver120)));
  return { displayBucketsCents: t.displayBucketsCents, valantBucketsCents: t.valantBucketsCents, totalCents: t.totalCents, rows: rows.length };
}

/** Add two totals column by column (insurance + patient = all Valant A/R) */
export function addTotals(a: RunoutTotals | null, b: RunoutTotals | null): RunoutTotals | null {
  if (!a && !b) return null;
  const x = a ?? { displayBucketsCents: [0, 0, 0, 0, 0], valantBucketsCents: [0, 0, 0, 0, 0], totalCents: 0, rows: 0 };
  const y = b ?? { displayBucketsCents: [0, 0, 0, 0, 0], valantBucketsCents: [0, 0, 0, 0, 0], totalCents: 0, rows: 0 };
  return {
    displayBucketsCents: x.displayBucketsCents.map((v, i) => v + (y.displayBucketsCents[i] ?? 0)),
    valantBucketsCents: x.valantBucketsCents.map((v, i) => v + (y.valantBucketsCents[i] ?? 0)),
    totalCents: x.totalCents + y.totalCents,
    rows: x.rows + y.rows,
  };
}

/** Insurance aging rows grouped by payer name (case / spacing insensitive), largest balance first */
export function groupByPayer(
  insuranceRows: readonly (Amounted & { payerName: string })[],
  combinedInsuranceLines: readonly { payerName: string | null }[],
  allOver120: boolean
): RunoutPayer[] {
  const groups = new Map<string, { payerName: string; rows: Amounted[] }>();
  for (const r of insuranceRows) {
    const key = normPayer(r.payerName) || '(no payer)';
    const g = groups.get(key) ?? { payerName: r.payerName.trim() || 'Unspecified', rows: [] };
    g.rows.push(r);
    groups.set(key, g);
  }
  const lineCounts = new Map<string, number>();
  for (const l of combinedInsuranceLines) {
    const key = normPayer(l.payerName);
    if (key) lineCounts.set(key, (lineCounts.get(key) ?? 0) + 1);
  }
  return [...groups.entries()]
    .map(([key, g]) => {
      const t = sumAgingRows(g.rows, allOver120);
      return {
        payerName: g.payerName,
        rowCount: g.rows.length,
        combinedLines: lineCounts.get(key) ?? 0,
        displayBucketsCents: t.displayBucketsCents,
        valantBucketsCents: t.valantBucketsCents,
        totalCents: t.totalCents,
        shownAsOver120: allOver120,
      };
    })
    .sort((a, b) => b.totalCents - a.totalCents || a.payerName.localeCompare(b.payerName));
}

function oldestBucketOf(display: readonly number[]) {
  for (let i = 4; i >= 0; i -= 1) if ((display[i] ?? 0) > 0) return i;
  return -1;
}

export type CombinedLineInput = Amounted & {
  id: string;
  valantPatientId: string;
  clientId: string | null;
  party: string;
  payerName: string | null;
  lastBilledAt: Date | null;
  client?: { name: string; mrn: string | null } | null;
};

/** Insurance-party combined aging lines with a balance owed (credits and $0 lines are left out) */
export function buildWorklistRows(lines: readonly CombinedLineInput[], allOver120: boolean): ValantWorklistRow[] {
  return lines
    .filter((l) => l.party !== 'patient' && l.totalCents > 0)
    .map((l) => {
      const p = presentRow(l, allOver120);
      return {
        id: l.id,
        valantPatientId: l.valantPatientId,
        clientId: l.clientId,
        clientName: l.client?.name ?? null,
        mrn: l.client?.mrn ?? null,
        party: l.party,
        payerName: l.payerName,
        lastBilledAt: isoDate(l.lastBilledAt),
        oldestBucket: oldestBucketOf(p.displayBucketsCents),
        ...p,
      };
    });
}

/** Filter + sort (no paging). Bucket filter uses the DISPLAYED columns, so it follows the Over-120 setting. */
export function filterSortWorklist(rows: readonly ValantWorklistRow[], query: ValantWorklistQuery = {}): ValantWorklistRow[] {
  const payer = normPayer(query.payer);
  const q = String(query.q ?? '').trim().toLowerCase();
  const bucket = typeof query.bucket === 'number' && query.bucket >= 0 && query.bucket <= 4 ? query.bucket : null;
  const min = typeof query.minCents === 'number' && query.minCents > 0 ? query.minCents : 0;
  const out = rows.filter((r) => {
    if (payer && normPayer(r.payerName) !== payer) return false;
    if (bucket != null && !((r.displayBucketsCents[bucket] ?? 0) > 0)) return false;
    if (min && r.totalCents < min) return false;
    if (query.party && r.party !== query.party) return false;
    if (query.unmatchedOnly && r.clientId) return false;
    if (q && !`${r.clientName ?? ''} ${r.mrn ?? ''} ${r.valantPatientId} ${r.payerName ?? ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const sort = query.sort ?? 'oldest';
  const byAmount = (a: ValantWorklistRow, b: ValantWorklistRow) => b.totalCents - a.totalCents;
  // Never billed first, then the longest since last billed
  const byLastBilled = (a: ValantWorklistRow, b: ValantWorklistRow) =>
    (a.lastBilledAt ?? '').localeCompare(b.lastBilledAt ?? '');
  const tie = (a: ValantWorklistRow, b: ValantWorklistRow) => a.valantPatientId.localeCompare(b.valantPatientId) || a.id.localeCompare(b.id);
  out.sort((a, b) => {
    if (sort === 'amount') return byAmount(a, b) || byLastBilled(a, b) || tie(a, b);
    if (sort === 'lastBilled') return byLastBilled(a, b) || byAmount(a, b) || tie(a, b);
    if (sort === 'name') {
      // Unmatched lines (no Altrixs client name) after the named ones
      if (!a.clientName !== !b.clientName) return a.clientName ? -1 : 1;
      return (a.clientName ?? a.valantPatientId).localeCompare(b.clientName ?? b.valantPatientId) || byAmount(a, b) || tie(a, b);
    }
    // oldest: oldest displayed bucket, then money in that bucket, then total
    const ob = b.oldestBucket - a.oldestBucket;
    if (ob) return ob;
    const inBucket = (r: ValantWorklistRow) => (r.oldestBucket >= 0 ? r.displayBucketsCents[r.oldestBucket] : 0);
    return inBucket(b) - inBucket(a) || byAmount(a, b) || byLastBilled(a, b) || tie(a, b);
  });
  return out;
}

export function paginate<T>(rows: readonly T[], page = 1, pageSize = VALANT_WORKLIST_DEFAULT_PAGE_SIZE) {
  const size = Math.min(VALANT_WORKLIST_MAX_PAGE_SIZE, Math.max(1, Math.floor(pageSize) || VALANT_WORKLIST_DEFAULT_PAGE_SIZE));
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const p = Math.min(pages, Math.max(1, Math.floor(page) || 1));
  return { rows: rows.slice((p - 1) * size, p * size), page: p, pageSize: size, total: rows.length };
}

/** Parse worklist query params (?payer=&bucket=0-4&min=dollars&party=&q=&unmatched=1&sort=&page=&pageSize=) */
export function parseWorklistQuery(params: URLSearchParams): ValantWorklistQuery {
  const num = (k: string) => {
    const v = params.get(k);
    if (v == null || v.trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const bucket = num('bucket');
  const minDollars = num('min');
  const party = params.get('party');
  const sort = params.get('sort');
  return {
    payer: params.get('payer')?.trim() || null,
    bucket: bucket != null && Number.isInteger(bucket) && bucket >= 0 && bucket <= 4 ? bucket : null,
    minCents: minDollars != null && minDollars > 0 ? Math.round(minDollars * 100) : null,
    party: (VALANT_WORKLIST_PARTIES as readonly string[]).includes(party ?? '') ? (party as ValantWorklistParty) : null,
    q: params.get('q')?.trim().slice(0, 100) || null,
    unmatchedOnly: params.get('unmatched') === '1',
    sort: (VALANT_WORKLIST_SORTS as readonly string[]).includes(sort ?? '') ? (sort as ValantWorklistSort) : 'oldest',
    page: num('page') ?? 1,
    pageSize: num('pageSize') ?? VALANT_WORKLIST_DEFAULT_PAGE_SIZE,
  };
}

export function runoutNote(latestAsOf: string | null) {
  return VALANT_RUNOUT_NOTE.replace('{date}', latestAsOf ?? '(no import yet)');
}

export function latestOf(...dates: (string | null)[]) {
  return dates.filter((d): d is string => Boolean(d)).sort().at(-1) ?? null;
}

type ComposeInput = {
  labels: string[];
  labelsConfirmed: boolean;
  displayAllOver120: boolean;
  asOf: { insurance: Date | null; patient: Date | null; combined: Date | null };
  insuranceRows: (Amounted & { payerName: string })[];
  patientRows: (Amounted & { clientId: string | null })[];
  combinedLines: CombinedLineInput[];
};

/** Everything except the DB reads (pure; unit tested) */
export function composeValantRunout(
  input: ComposeInput,
  query: ValantWorklistQuery = {},
  opts: { paginate?: boolean } = {}
): ValantRunoutAr & { /** every filtered + sorted row (CSV export); not sent to the page */ allWorklistRows: ValantWorklistRow[] } {
  const over120 = input.displayAllOver120;
  const asOf = {
    insurance: isoDate(input.asOf.insurance),
    patient: isoDate(input.asOf.patient),
    combined: isoDate(input.asOf.combined),
  };
  const latestAsOf = latestOf(asOf.insurance, asOf.patient, asOf.combined);
  const insurance = asOf.insurance ? sumAgingRows(input.insuranceRows, over120) : null;
  const patient = asOf.patient ? sumAgingRows(input.patientRows, over120) : null;
  const insLines = input.combinedLines.filter((l) => l.party !== 'patient');
  const patLines = input.combinedLines.filter((l) => l.party === 'patient');

  const unmatchedPatients = new Set<string>();
  const allPatients = new Set<string>();
  for (const l of input.combinedLines) {
    allPatients.add(l.valantPatientId);
    if (!l.clientId) unmatchedPatients.add(l.valantPatientId);
  }

  const allRows = buildWorklistRows(input.combinedLines, over120);
  const filtered = filterSortWorklist(allRows, query);
  const paged = opts.paginate === false
    ? { rows: filtered, page: 1, pageSize: filtered.length, total: filtered.length }
    : paginate(filtered, query.page, query.pageSize);
  // One entry per payer (first spelling seen wins), for the payer filter
  const payerNames = new Map<string, string>();
  for (const r of allRows) {
    const key = normPayer(r.payerName);
    if (key && !payerNames.has(key)) payerNames.set(key, r.payerName!.trim());
  }
  const payers = [...payerNames.values()].sort((a, b) => a.localeCompare(b));

  return {
    available: Boolean(asOf.insurance || asOf.patient || asOf.combined),
    note: runoutNote(latestAsOf),
    labels: input.labels,
    labelsConfirmed: input.labelsConfirmed,
    displayAllOver120: over120,
    over120Note: OVER_120_NOTE,
    asOf,
    latestAsOf,
    totals: { insurance, patient, all: addTotals(insurance, patient) },
    combined: asOf.combined ? { insuranceLines: sumAgingRows(insLines, over120), patientLines: sumAgingRows(patLines, over120) } : null,
    byPayer: groupByPayer(input.insuranceRows, insLines, over120),
    byFacility: null,
    facilityNote: FACILITY_NOTE,
    unmatched: {
      patientAgingRows: input.patientRows.filter((r) => !r.clientId).length,
      patientAgingTotal: input.patientRows.length,
      combinedPatients: unmatchedPatients.size,
      combinedPatientsTotal: allPatients.size,
      combinedInsuranceLines: insLines.filter((l) => !l.clientId).length,
    },
    worklist: {
      rows: paged.rows,
      total: paged.total,
      page: paged.page,
      pageSize: paged.pageSize,
      totalCents: filtered.reduce((s, r) => s + r.totalCents, 0),
      payers,
    },
    allWorklistRows: filtered,
  };
}

const BUCKET_SELECT = { bucket1Cents: true, bucket2Cents: true, bucket3Cents: true, bucket4Cents: true, bucket5Cents: true, totalCents: true } as const;

/** Latest Valant aging imports for the organization, aggregated for the A/R Control Center */
export async function getValantRunoutAr(organizationId: string, query: ValantWorklistQuery = {}, opts: { paginate?: boolean } = {}) {
  const latest = async (model: 'ins' | 'pat' | 'comb') => {
    const args = { where: { organizationId }, orderBy: { asOf: 'desc' as const }, select: { asOf: true } };
    const row =
      model === 'ins'
        ? await prisma.valantInsuranceAgingSnapshot.findFirst(args)
        : model === 'pat'
          ? await prisma.valantAgingSnapshot.findFirst(args)
          : await prisma.valantCombinedAgingRow.findFirst(args);
    return row?.asOf ?? null;
  };
  const [insAsOf, patAsOf, combAsOf, settings] = await Promise.all([latest('ins'), latest('pat'), latest('comb'), getAgingLabels(organizationId)]);
  const [insuranceRows, patientRows, combinedLines] = await Promise.all([
    insAsOf
      ? prisma.valantInsuranceAgingSnapshot.findMany({
          where: { organizationId, asOf: insAsOf },
          select: { ...BUCKET_SELECT, payerName: true },
          orderBy: { rowIndex: 'asc' },
        })
      : Promise.resolve([]),
    patAsOf
      ? prisma.valantAgingSnapshot.findMany({ where: { organizationId, asOf: patAsOf }, select: { ...BUCKET_SELECT, clientId: true } })
      : Promise.resolve([]),
    combAsOf
      ? prisma.valantCombinedAgingRow.findMany({
          where: { organizationId, asOf: combAsOf },
          select: {
            ...BUCKET_SELECT, id: true, valantPatientId: true, clientId: true, party: true, payerName: true, lastBilledAt: true,
            client: { select: { name: true, mrn: true } },
          },
          orderBy: [{ valantPatientId: 'asc' }, { rowIndex: 'asc' }],
        })
      : Promise.resolve([]),
  ]);
  return composeValantRunout(
    {
      labels: settings.labels,
      labelsConfirmed: settings.confirmed,
      displayAllOver120: settings.displayAllOver120,
      asOf: { insurance: insAsOf, patient: patAsOf, combined: combAsOf },
      insuranceRows,
      patientRows,
      combinedLines,
    },
    query,
    opts
  );
}

function csvCell(v: string | number | null | undefined) {
  const s = v == null ? '' : String(v);
  if (/^-?\d+(\.\d+)?$/.test(s)) return s;
  // Text that a spreadsheet would run as a formula is prefixed with '
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r']/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Worklist CSV (displayed buckets per the practice setting, then Valant's original buckets) */
export function buildValantWorklistCsv(rows: readonly ValantWorklistRow[], labels: readonly string[], asOf: string | null) {
  const header = [
    'asOf', 'valantPatientId', 'clientName', 'mrn', 'matched', 'party', 'payer', 'lastBilled',
    ...labels.map((l) => `shown ${l}`), 'total', ...labels.map((l) => `Valant ${l}`),
  ];
  const dollars = (c: number) => (c / 100).toFixed(2);
  const lines = [header.map(csvCell).join(',')];
  for (const r of rows) {
    lines.push(
      [
        asOf, r.valantPatientId, r.clientName, r.mrn, r.clientId ? 'yes' : 'no', r.party, r.payerName, r.lastBilledAt,
        ...r.displayBucketsCents.map(dollars), dollars(r.totalCents), ...r.valantBucketsCents.map(dollars),
      ].map(csvCell).join(',')
    );
  }
  return lines.join('\n');
}
