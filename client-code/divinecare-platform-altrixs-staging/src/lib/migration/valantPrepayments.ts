import { createHash } from 'node:crypto';
import { headerMatches, isoDate, parseLongDate, parseUsDate, reportMoneyToCents } from './valantReportCommon';

/**
 * Valant "Prepayments" report export (CSV). REFERENCE ONLY: never posted to the ledger.
 *
 * Columns by position: 0 title "All prepayments between <start> and <end>", 1-3 filters,
 * 4 report net total, 5 type, 6 date, 7 reference, 8 signed amount, 9 patient name,
 * 10 applied-to number (blank on receipts), 11 second date.
 * Types: 'Credit Card' and 'Check' are prepayments received (positive); 'Prepayment Transfer'
 * applies prepayment to a charge (negative).
 *
 * The export has no Valant patient ID, so patients are matched by exact name only when exactly one
 * client in the organization has that name. A future export with a "Patient ID" / "Pt. ID" column is
 * matched by Valant ID instead.
 *
 * The report is limited to a date range: money received before the period start is missing, so a
 * client whose net is negative is shown as incomplete, never as a negative credit.
 */

export const PREPAYMENT_HEADER = [
  'Text2', 'textBox1', 'textBox2', 'textBox1', 'textBox16', 'textBox3', 'textBox1', 'textBox4',
  'textBox9', 'textBox2', 'textBox5', 'textBox6',
] as const;

export const RECEIVED_TYPES = ['credit card', 'check'] as const;
export const APPLIED_TYPES = ['prepayment transfer'] as const;

export type PrepaymentKind = 'received' | 'applied';

export type PrepaymentTxn = {
  line: number;
  type: string;
  kind: PrepaymentKind;
  date: Date;
  reference: string | null;
  amountCents: number;
  valantName: string;
  valantPatientId: string | null;
  appliedTo: string | null;
  secondaryDate: Date | null;
  /** Stable across re-exports of the same transaction (period excluded) */
  rowHash: string;
};

export type PrepaymentParse = {
  ok: boolean;
  error?: string;
  periodStart: Date | null;
  periodEnd: Date | null;
  txns: PrepaymentTxn[];
  errors: { line: number; error: string }[];
  /** Index of a Patient ID column, when the export has one */
  patientIdCol: number | null;
  reportNetCents: number | null;
  sumCents: number;
  reconciles: boolean;
  received: number;
  applied: number;
  distinctNames: number;
};

/** "All prepayments between January 1, 2026 and October 16, 2026" */
export function parsePrepaymentPeriod(title: string): { start: Date; end: Date } | null {
  const m = String(title ?? '').match(/between\s+([A-Za-z]+\s+\d{1,2},\s*\d{4})\s+and\s+([A-Za-z]+\s+\d{1,2},\s*\d{4})/i);
  if (!m) return null;
  const start = parseLongDate(m[1]);
  const end = parseLongDate(m[2]);
  return start && end && start <= end ? { start, end } : null;
}

/** Case- and space-insensitive full name key */
export function nameKey(raw: string | null | undefined): string {
  return String(raw ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function prepaymentKind(type: string): PrepaymentKind | null {
  const t = nameKey(type);
  if ((RECEIVED_TYPES as readonly string[]).includes(t)) return 'received';
  if ((APPLIED_TYPES as readonly string[]).includes(t)) return 'applied';
  return null;
}

export function findPatientIdCol(header: readonly string[]): number | null {
  const i = header.findIndex((h) => /^(patient\s*id|pt\.?\s*id)$/i.test(String(h).trim()));
  return i >= 0 ? i : null;
}

function contentKey(t: Omit<PrepaymentTxn, 'rowHash' | 'line'>) {
  return [
    nameKey(t.type), isoDate(t.date), (t.reference ?? '').trim(), t.amountCents, nameKey(t.valantName),
    (t.valantPatientId ?? '').toUpperCase(), (t.appliedTo ?? '').trim(), isoDate(t.secondaryDate),
  ].join('|');
}

/** sha256 of the transaction content plus its occurrence number among identical rows in the file */
export function prepaymentRowHash(content: string, occurrence: number): string {
  return createHash('sha256').update(`valant-prepayment|${content}|#${occurrence}`).digest('hex');
}

export function parsePrepaymentReport(records: readonly (readonly string[])[]): PrepaymentParse {
  const empty: PrepaymentParse = {
    ok: false, periodStart: null, periodEnd: null, txns: [], errors: [], patientIdCol: null,
    reportNetCents: null, sumCents: 0, reconciles: false, received: 0, applied: 0, distinctNames: 0,
  };
  const [header, ...data] = records;
  if (!header || !headerMatches(header, PREPAYMENT_HEADER)) {
    return { ...empty, error: 'This is not the Valant Prepayments export (the header row does not match).' };
  }
  const patientIdCol = findPatientIdCol(header);
  const body = data.filter((r) => r.some((c) => String(c).trim()));
  if (!body.length) return { ...empty, patientIdCol, error: 'The file has no prepayment rows.' };
  const period = parsePrepaymentPeriod(body[0][0] ?? '');
  if (!period) return { ...empty, patientIdCol, error: 'Could not read the report period from the title.' };

  const txns: PrepaymentTxn[] = [];
  const errors: { line: number; error: string }[] = [];
  const occurrences = new Map<string, number>();
  body.forEach((cells, i) => {
    const line = i + 2;
    const cell = (c: number) => String(cells[c] ?? '').trim();
    const type = cell(5);
    const kind = prepaymentKind(type);
    if (!kind) return errors.push({ line, error: `Unknown prepayment type "${type}"` });
    const date = parseUsDate(cell(6));
    if (!date) return errors.push({ line, error: 'Date is not MM/DD/YYYY' });
    const amountCents = reportMoneyToCents(cell(8));
    if (amountCents === null) return errors.push({ line, error: 'Amount is not a dollar value' });
    if ((kind === 'received' && amountCents < 0) || (kind === 'applied' && amountCents > 0)) {
      return errors.push({ line, error: `${type} amount has an unexpected sign` });
    }
    const valantName = cell(9).replace(/\s+/g, ' ');
    if (!valantName) return errors.push({ line, error: 'Patient name is blank' });
    const base = {
      type,
      kind,
      date,
      reference: cell(7) || null,
      amountCents,
      valantName,
      valantPatientId: patientIdCol !== null ? cell(patientIdCol).toUpperCase() || null : null,
      appliedTo: cell(10) || null,
      secondaryDate: parseUsDate(cell(11)),
    };
    const key = contentKey(base);
    const n = (occurrences.get(key) ?? 0) + 1;
    occurrences.set(key, n);
    txns.push({ ...base, line, rowHash: prepaymentRowHash(key, n) });
  });

  const sumCents = txns.reduce((s, t) => s + t.amountCents, 0);
  const reportNetCents = reportMoneyToCents(body[0][4]);
  return {
    ok: true,
    periodStart: period.start,
    periodEnd: period.end,
    txns,
    errors,
    patientIdCol,
    reportNetCents,
    sumCents,
    reconciles: errors.length === 0 && reportNetCents === sumCents,
    received: txns.filter((t) => t.kind === 'received').length,
    applied: txns.filter((t) => t.kind === 'applied').length,
    distinctNames: new Set(txns.map((t) => nameKey(t.valantName))).size,
  };
}

export type NameCandidate = {
  id: string;
  name?: string | null;
  legalFirstName?: string | null;
  middleInitial?: string | null;
  legalLastName?: string | null;
};

/** Every exact full-name form a client can be matched on */
export function clientNameKeys(c: NameCandidate): string[] {
  const keys = new Set<string>();
  const add = (v: string) => {
    const k = nameKey(v);
    if (k) keys.add(k);
  };
  add(c.name ?? '');
  const first = (c.legalFirstName ?? '').trim();
  const last = (c.legalLastName ?? '').trim();
  if (first && last) {
    add(`${first} ${last}`);
    const mi = (c.middleInitial ?? '').replace(/\./g, '').trim();
    if (mi) add(`${first} ${mi} ${last}`);
  }
  return [...keys];
}

/** name key -> ids of every client with that exact name */
export function buildNameIndex(clients: readonly NameCandidate[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const c of clients) {
    for (const k of clientNameKeys(c)) {
      const ids = index.get(k) ?? [];
      if (!ids.includes(c.id)) ids.push(c.id);
      index.set(k, ids);
    }
  }
  return index;
}

export type NameMatch =
  | { kind: 'matched'; clientId: string }
  | { kind: 'none' }
  | { kind: 'duplicate'; candidates: number };

/** Matched only when exactly one client has the name; never picks among duplicates */
export function matchByName(index: Map<string, string[]>, valantName: string): NameMatch {
  const ids = index.get(nameKey(valantName)) ?? [];
  if (ids.length === 1) return { kind: 'matched', clientId: ids[0] };
  if (ids.length === 0) return { kind: 'none' };
  return { kind: 'duplicate', candidates: ids.length };
}

export type PrepaymentStanding = {
  netCents: number;
  /** Remaining prepayment credit; null when the report cannot show it */
  remainingCents: number | null;
  incomplete: boolean;
  note: string | null;
};

/** A negative net means prepayments received before the period start are missing from the report */
export function prepaymentStanding(netCents: number, periodStart: Date | string | null): PrepaymentStanding {
  if (netCents >= 0) return { netCents, remainingCents: netCents, incomplete: false, note: null };
  const start = periodStart ? (typeof periodStart === 'string' ? periodStart.slice(0, 10) : isoDate(periodStart)) : 'the report start';
  return {
    netCents,
    remainingCents: null,
    incomplete: true,
    note: `Incomplete: prepayments received before ${start} are not in this report`,
  };
}
