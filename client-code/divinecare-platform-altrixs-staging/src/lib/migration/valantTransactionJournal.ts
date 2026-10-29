import { headerMatches, isoDate, parseLongDate, parseUsDate, reportMoneyToCents } from './valantReportCommon';
import { classifyTransactionCode, type TransactionCategory, type ValantTxnRow } from './valantTransactions';

/**
 * Valant "Transaction Journal" report export (CSV). REFERENCE ONLY: nothing posts to the Altrixs ledger.
 *
 * Columns by position: 0 "Facility: ALL FACILITIES", 1 report basis ("Transactions with initial charges
 * between January 1, 2026 and "), 2-8 more report filters, 9 PatientID (Valant patient ID), 10 BillingId,
 * 11 DateOfService (M/D/YYYY), 12 ProviderId ("K.Daniel", "Dr. A Gbadehan"), 13 Facility, 14 PrimaryDx,
 * 15 TransactionCode, 16 Insurance (blank, one payer, or a comma-joined list), 17 Amount ("($100.00)").
 * No patient name column.
 *
 * The journal overlaps the "Transactions" export already imported, so it is MERGED: a journal row that
 * matches an existing row (same patient, billing id, service date, code and amount; duplicates matched
 * one-for-one) only adds facility / insurance to it; the rest are inserted. Pure: browser and server.
 */

export const JOURNAL_HEADER = [
  'textBox1', 'Text2', 'textBox1', 'textBox1', 'textBox1', 'textBox1', 'textBox1', 'textBox1', 'textBox1',
  'PatientID', 'BillingId', 'DateOfService', 'ProviderId', 'Facility', 'PrimaryDx', 'TransactionCode', 'Insurance', 'Amount',
] as const;

export const JOURNAL_PATIENT_ID_COL = 9;
export const JOURNAL_BASIS_COL = 1;
/** Report filter columns that repeat on every row and are not stored (the browser blanks them) */
export const JOURNAL_FILTER_COLS = [2, 3, 4, 5, 6, 7, 8] as const;

export type TransactionLayout = 'transactions' | 'journal';

export function isJournalHeader(header: readonly string[] | undefined): boolean {
  return Boolean(header && headerMatches(header, JOURNAL_HEADER));
}

export type ValantJournalRow = ValantTxnRow & {
  facility: string | null;
  /** Insurance cell as exported (may list several payers) */
  insurance: string | null;
  payers: string[];
};

/** "NOVITAS SOLUTIONS PART B, Maryland Public Behavioral Health System" -> two payers; blank -> [] */
export function splitPayers(raw: string | null | undefined): string[] {
  return String(raw ?? '')
    .split(/,\s+/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/** "Transactions with initial charges between January 1, 2026 and " -> text + start date */
export function parseJournalBasis(raw: string | null | undefined): { text: string | null; start: Date | null; end: Date | null } {
  const text = String(raw ?? '').replace(/\s+/g, ' ').trim() || null;
  const m = text?.match(/between\s+([A-Za-z]+\s+\d{1,2},\s*\d{4})\s+and\s*([A-Za-z]+\s+\d{1,2},\s*\d{4})?/i);
  return { text, start: m?.[1] ? parseLongDate(m[1]) : null, end: m?.[2] ? parseLongDate(m[2]) : null };
}

export function parseJournalRow(
  cells: readonly string[],
  overrides: Record<string, TransactionCategory> = {}
): { row?: ValantJournalRow; error?: string } {
  const cell = (i: number) => String(cells[i] ?? '').trim();
  const valantPatientId = cell(JOURNAL_PATIENT_ID_COL).replace(/\s+/g, ' ').toUpperCase();
  if (!valantPatientId) return { error: 'PatientID (Valant patient ID) is blank' };
  const code = cell(15);
  if (!code) return { error: `Patient ${valantPatientId}: transaction code is blank` };
  const amountCents = reportMoneyToCents(cell(17));
  if (amountCents === null) return { error: `Patient ${valantPatientId}: amount is not a dollar value` };
  const dateRaw = cell(11);
  const serviceDate = dateRaw ? parseUsDate(dateRaw) : null;
  if (dateRaw && !serviceDate) return { error: `Patient ${valantPatientId}: date of service is not MM/DD/YYYY` };
  const cls = classifyTransactionCode(code, overrides);
  const insurance = cell(16).replace(/\s+/g, ' ') || null;
  return {
    row: {
      valantPatientId,
      billingId: cell(10) || null,
      serviceDate,
      providerCode: cell(12).replace(/\s+/g, ' ') || null,
      pos: null,
      diagnosis: cell(14) || null,
      code,
      codeBase: cls.codeBase,
      codeSuffix: cls.codeSuffix,
      category: cls.category,
      amountCents,
      note: null,
      patientSubtotalCents: null,
      facility: cell(13).replace(/\s+/g, ' ') || null,
      insurance,
      payers: splitPayers(insurance),
    },
  };
}

/** Identity of a journal row for idempotent re-import of the journal itself */
export function journalContentKey(r: ValantJournalRow): string {
  return [
    'journal', r.valantPatientId, r.billingId ?? '', isoDate(r.serviceDate) ?? '', r.providerCode ?? '', r.facility ?? '',
    r.diagnosis ?? '', r.code, r.insurance ?? '', r.amountCents,
  ].join('|');
}

/** Occurrence of each journal row among identical rows over the whole file (1, 2, ...) */
export function journalOccurrenceNumbers(rows: readonly (ValantJournalRow | null)[]): number[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    if (!r) return 0;
    const k = journalContentKey(r);
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    return n;
  });
}

/** Cross-layout match key: patient, billing id, service date, code (trimmed, any case), amount */
export function mergeKey(r: {
  valantPatientId: string;
  billingId: string | null;
  serviceDate: Date | null;
  code: string;
  amountCents: number;
}): string {
  return [
    r.valantPatientId.trim().toUpperCase(), (r.billingId ?? '').trim(), isoDate(r.serviceDate) ?? '',
    r.code.trim().replace(/\s+/g, ' ').toLowerCase(), r.amountCents,
  ].join('|');
}

/** A stored ValantTransaction as the merge needs it */
export type ExistingTxn = {
  id: string;
  valantPatientId: string;
  billingId: string | null;
  serviceDate: Date | null;
  code: string;
  amountCents: number;
  rowHash: string;
  sourceLayout: string | null;
  facility: string | null;
  insurance: string | null;
  providerCode: string | null;
};

export type JournalMergePlan = {
  /** journal index -> existing row it enriches (changed = facility/insurance/provider would change) */
  matched: { index: number; existingId: string; changed: boolean; fillProvider: boolean }[];
  /** journal rows already stored from an earlier journal import (same row hash) */
  alreadyImported: number[];
  /** journal rows to insert */
  inserts: number[];
  /** existing "Transactions" rows for these patients that no journal row matched (left untouched) */
  untouchedExisting: number;
};

/**
 * Plan the merge of journal rows into stored rows. Every patient in `journal` must have ALL of their
 * stored rows in `existing` (the browser chunks by patient). Multiset-aware: N identical keys on both
 * sides match N pairs and no stored row is used twice. Re-running the same journal yields no changes:
 * rows inserted earlier are found by hash, and enriched rows are preferred again for the same key.
 */
export function planJournalMerge(
  journal: readonly { row: ValantJournalRow; rowHash: string }[],
  existing: readonly ExistingTxn[]
): JournalMergePlan {
  const byHash = new Map<string, ExistingTxn>();
  const pool = new Map<string, ExistingTxn[]>();
  for (const e of existing) {
    if (e.sourceLayout === 'journal') byHash.set(e.rowHash, e);
    else {
      const k = mergeKey(e);
      const list = pool.get(k);
      if (list) list.push(e);
      else pool.set(k, [e]);
    }
  }
  for (const list of pool.values()) list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const plan: JournalMergePlan = { matched: [], alreadyImported: [], inserts: [], untouchedExisting: 0 };
  const pending: number[] = [];
  journal.forEach((j, i) => {
    if (byHash.has(j.rowHash)) plan.alreadyImported.push(i);
    else pending.push(i);
  });

  const used = new Set<string>();
  const take = (i: number, pick: (e: ExistingTxn) => boolean) => {
    const r = journal[i].row;
    const hit = (pool.get(mergeKey(r)) ?? []).find((e) => !used.has(e.id) && pick(e));
    if (!hit) return false;
    used.add(hit.id);
    const fillProvider = !hit.providerCode && Boolean(r.providerCode);
    plan.matched.push({
      index: i,
      existingId: hit.id,
      fillProvider,
      changed: fillProvider || hit.facility !== r.facility || hit.insurance !== r.insurance,
    });
    return true;
  };
  // Pass 1: stored rows already carrying exactly this row's facility/insurance (stable on re-run)
  const rest = pending.filter((i) => !take(i, (e) => e.facility === journal[i].row.facility && e.insurance === journal[i].row.insurance));
  // Pass 2: any unused stored row with the same key
  for (const i of rest) if (!take(i, () => true)) plan.inserts.push(i);
  plan.matched.sort((a, b) => a.index - b.index);

  for (const list of pool.values()) for (const e of list) if (!used.has(e.id)) plan.untouchedExisting += 1;
  return plan;
}

/** Group values into chunks of `size` (for updateMany / createMany batches) */
export function chunked<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
