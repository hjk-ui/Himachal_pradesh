import { headerMatches, parseLongDate, reportMoneyToCents } from './valantReportCommon';

/**
 * Valant aging report exports (CSV): "Patient Aging Summary" and "Insurance Aging Summary".
 * REFERENCE ONLY: never posted to the ledger.
 *
 * Both reports repeat the title, filters and report-level totals on every row, then:
 *   ServiceDate11 = bucket 1, textBox2 = row key, textBox3 = bucket 2, textBox4 = bucket 3,
 *   textBox5 = bucket 4, textBox15 = bucket 5, textBox18 = total.
 * The patient report's row key is "VALANTID: Name" (only the ID is kept); the insurance report's is
 * the payer name. Bucket NAMES are not in either export. The defaults (DEFAULT_AGING_LABELS) are
 * inferred from the Valant "Combined Aging" export, whose columns are named Total30, Total60,
 * Total90, Total120 and TotalOver120 (Detail5 = Over 120); the organization can edit them and marks
 * them confirmed once checked in Valant. Patient, insurance and combined aging share one set.
 *
 * Report-level totals (cross-check only): textBox8 = bucket 1, textBox7 = bucket 2,
 * textBox6 = bucket 3, textBox1 = bucket 4, textBox16 = bucket 5, textBox19 = total
 * (confirmed against the column sums of the October 2026 insurance export).
 */

/** Days past due, inferred from the Combined Aging column names (Total30 .. TotalOver120) */
export const DEFAULT_AGING_LABELS = ['0–30', '31–60', '61–90', '91–120', 'Over 120'] as const;
export const AGING_LABELS_INFERRED_NOTE = 'Inferred from Valant Combined Aging column names — confirm in Valant';

export type AgingLayout = {
  kind: 'patient' | 'insurance';
  header: readonly string[];
  titlePattern: RegExp;
  /** report-level total cells: bucket 1..5, total */
  reportCols: readonly [number, number, number, number, number, number];
  bucketCols: readonly [number, number, number, number, number];
  totalCol: number;
  keyCol: number;
  /** cells that must be identical on every row */
  reportCellCount: number;
};

export const PATIENT_AGING_LAYOUT: AgingLayout = {
  kind: 'patient',
  header: [
    'Text2', 'textBox1', 'textBox2', 'textBox1', 'textBox6', 'textBox7', 'textBox8', 'textBox9',
    'textBox10', 'textBox11', 'textBox12', 'textBox1', 'textBox16', 'textBox17', 'textBox19',
    'textBox20', 'ServiceDate11', 'textBox2', 'textBox3', 'textBox4', 'textBox5', 'textBox15', 'textBox18',
  ],
  titlePattern: /^patient balance due as of/i,
  reportCols: [6, 5, 4, 11, 12, 14],
  bucketCols: [16, 18, 19, 20, 21],
  totalCol: 22,
  keyCol: 17,
  reportCellCount: 16,
};

export const INSURANCE_AGING_LAYOUT: AgingLayout = {
  kind: 'insurance',
  header: [
    'Text2', 'textBox6', 'textBox7', 'textBox8', 'textBox9', 'textBox10', 'textBox11', 'textBox12',
    'textBox1', 'textBox16', 'textBox17', 'textBox19', 'textBox20', 'ServiceDate11', 'textBox2',
    'textBox3', 'textBox4', 'textBox5', 'textBox15', 'textBox18',
  ],
  titlePattern: /^insurance balance due as of/i,
  reportCols: [3, 2, 1, 8, 9, 11],
  bucketCols: [13, 15, 16, 17, 18],
  totalCol: 19,
  keyCol: 14,
  reportCellCount: 13,
};

/** Kept for callers that only need the patient header */
export const AGING_HEADER = PATIENT_AGING_LAYOUT.header;

export type Buckets = [number, number, number, number, number];

export type AgingRow = {
  /** 1-based line in the file (header = line 1) */
  line: number;
  /** Valant patient ID (patient report) or payer name (insurance report) */
  key: string;
  bucketsCents: Buckets;
  totalCents: number;
  /** bucket 1..5 add up to the total */
  bucketsMatchTotal: boolean;
};

export type AgingReconcile = {
  buckets: [boolean, boolean, boolean, boolean, boolean];
  total: boolean;
  all: boolean;
};

export type AgingParse = {
  ok: boolean;
  error?: string;
  kind: AgingLayout['kind'];
  asOf: Date | null;
  rows: AgingRow[];
  errors: { line: number; error: string }[];
  /** Report-level totals as printed (bucket 1..5, total) */
  reportBucketsCents: (number | null)[];
  reportTotalCents: number | null;
  /** Our column sums over all parsed rows */
  columnSumsCents: Buckets;
  totalSumCents: number;
  /** Rows whose title / report-level cells differ from the first row (should be 0) */
  inconsistentReportCells: number;
  rowsWithBucketMismatch: number;
  reconcile: AgingReconcile;
};

/** "Patient balance due as of October 17, 2026" -> Date */
export function parseAgingAsOf(title: string): Date | null {
  const m = String(title ?? '').match(/as of\s+([A-Za-z]+\s+\d{1,2},\s*\d{4})/i);
  return m ? parseLongDate(m[1]) : null;
}

/** "ABRWEI: Some Name" -> "ABRWEI" (the name is not kept) */
export function agingPatientId(cell: string): string | null {
  // IDs are usually letters + digits but can hold spaces or punctuation
  const m = String(cell ?? '').match(/^\s*([^:]{1,40}?)\s*:/);
  return m ? m[1].replace(/\s+/g, ' ').toUpperCase() : null;
}

function rowKey(layout: AgingLayout, cells: readonly string[]): string | null {
  const raw = String(cells[layout.keyCol] ?? '');
  if (layout.kind === 'patient') return agingPatientId(raw);
  const payer = raw.trim().replace(/\s+/g, ' ');
  return payer || null;
}

export function parseAgingRow(
  cells: readonly string[],
  line: number,
  layout: AgingLayout = PATIENT_AGING_LAYOUT
): { row?: AgingRow; error?: string } {
  const key = rowKey(layout, cells);
  if (!key) {
    return { error: layout.kind === 'patient' ? 'No Valant patient ID before the colon' : 'Payer name is blank' };
  }
  const buckets = layout.bucketCols.map((c) => reportMoneyToCents(cells[c]));
  const total = reportMoneyToCents(cells[layout.totalCol]);
  const who = layout.kind === 'patient' ? `Patient ${key}` : `Line ${line}`;
  if (buckets.some((b) => b === null) || total === null) return { error: `${who}: an amount is not a dollar value` };
  const b = buckets as number[];
  return {
    row: {
      line,
      key,
      bucketsCents: [b[0], b[1], b[2], b[3], b[4]],
      totalCents: total,
      bucketsMatchTotal: b.reduce((s, n) => s + n, 0) === total,
    },
  };
}

function emptyParse(kind: AgingLayout['kind'], error: string): AgingParse {
  return {
    ok: false, error, kind, asOf: null, rows: [], errors: [],
    reportBucketsCents: [null, null, null, null, null], reportTotalCents: null,
    columnSumsCents: [0, 0, 0, 0, 0], totalSumCents: 0, inconsistentReportCells: 0, rowsWithBucketMismatch: 0,
    reconcile: { buckets: [false, false, false, false, false], total: false, all: false },
  };
}

/** records = all CSV records including the header row */
export function parseAgingReport(
  records: readonly (readonly string[])[],
  layout: AgingLayout = PATIENT_AGING_LAYOUT
): AgingParse {
  const label = layout.kind === 'patient' ? 'Patient Aging Summary' : 'Insurance Aging Summary';
  const [header, ...data] = records;
  if (!header || !headerMatches(header, layout.header)) {
    return emptyParse(layout.kind, `This is not the Valant ${label} export (the header row does not match).`);
  }
  const body = data.filter((r) => r.some((c) => String(c).trim()));
  if (!body.length) return emptyParse(layout.kind, 'The file has no rows.');
  const title = String(body[0][0] ?? '').trim();
  if (!layout.titlePattern.test(title)) return emptyParse(layout.kind, `The report title does not look like the ${label}.`);
  const asOf = parseAgingAsOf(title);
  if (!asOf) return emptyParse(layout.kind, 'Could not read the "as of" date from the report title.');

  const first = body[0];
  const reportKey = (cells: readonly string[]) => cells.slice(0, layout.reportCellCount).map((c) => String(c).trim()).join('|');
  const expectKey = reportKey(first);
  let inconsistent = 0;
  const rows: AgingRow[] = [];
  const errors: { line: number; error: string }[] = [];
  const seen = new Set<string>();
  body.forEach((cells, i) => {
    const line = i + 2;
    if (reportKey(cells) !== expectKey) inconsistent += 1;
    const r = parseAgingRow(cells, line, layout);
    if (r.error || !r.row) {
      errors.push({ line, error: r.error ?? 'Unreadable row' });
      return;
    }
    // A patient appears once; payer names can repeat (different plans) and every row is kept
    if (layout.kind === 'patient') {
      if (seen.has(r.row.key)) {
        errors.push({ line, error: `Patient ${r.row.key} appears more than once` });
        return;
      }
      seen.add(r.row.key);
    }
    rows.push(r.row);
  });

  const sums: Buckets = [0, 0, 0, 0, 0];
  let totalSum = 0;
  for (const r of rows) {
    r.bucketsCents.forEach((c, i) => (sums[i] += c));
    totalSum += r.totalCents;
  }
  const reportBucketsCents = layout.reportCols.slice(0, 5).map((c) => reportMoneyToCents(first[c]));
  const reportTotalCents = reportMoneyToCents(first[layout.reportCols[5]]);
  const bucketsOk = reportBucketsCents.map((v, i) => v === sums[i]) as AgingReconcile['buckets'];
  const totalOk = reportTotalCents === totalSum;
  return {
    ok: true,
    kind: layout.kind,
    asOf,
    rows,
    errors,
    reportBucketsCents,
    reportTotalCents,
    columnSumsCents: sums,
    totalSumCents: totalSum,
    inconsistentReportCells: inconsistent,
    rowsWithBucketMismatch: rows.filter((r) => !r.bucketsMatchTotal).length,
    reconcile: {
      buckets: bucketsOk,
      total: totalOk,
      all: bucketsOk.every(Boolean) && totalOk && inconsistent === 0 && errors.length === 0,
    },
  };
}

/** Five non-empty labels, falling back to the defaults */
export function normalizeAgingLabels(raw: unknown): string[] {
  const arr = Array.isArray(raw) ? raw : [];
  return DEFAULT_AGING_LABELS.map((d, i) => {
    const v = typeof arr[i] === 'string' ? (arr[i] as string).trim().slice(0, 40) : '';
    return v || d;
  });
}

/** Percent of total per bucket, one decimal (null when the total is 0) */
export function bucketPercents(buckets: readonly number[], totalCents: number): (number | null)[] {
  return buckets.map((b) => (totalCents === 0 ? null : Math.round((b / totalCents) * 1000) / 10));
}

/** Insurance rows aggregated by exact payer name (display only; rows stay separate in storage) */
export function groupByPayer<T extends { payerName: string; bucketsCents: readonly number[]; totalCents: number }>(
  rows: readonly T[]
): { payerName: string; rows: number; bucketsCents: Buckets; totalCents: number }[] {
  const map = new Map<string, { payerName: string; rows: number; bucketsCents: Buckets; totalCents: number }>();
  for (const r of rows) {
    const g = map.get(r.payerName) ?? { payerName: r.payerName, rows: 0, bucketsCents: [0, 0, 0, 0, 0] as Buckets, totalCents: 0 };
    g.rows += 1;
    r.bucketsCents.forEach((c, i) => (g.bucketsCents[i] += c));
    g.totalCents += r.totalCents;
    map.set(r.payerName, g);
  }
  return [...map.values()];
}
