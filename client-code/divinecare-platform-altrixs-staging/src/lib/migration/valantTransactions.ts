import { headerMatches, isoDate, parseUsDate, reportMoneyToCents } from './valantReportCommon';

/**
 * Valant "Transactions" report export (CSV). REFERENCE ONLY: nothing posts to the Altrixs ledger.
 *
 * Columns by position (names repeat): 0 report label ("All transactions on October 17, 2026"),
 * 1-6 filters, 7 report total, 8 "Patient <ID> Subtotal:", 9 that patient's subtotal (repeated on
 * each of the patient's rows), 10 PatientName1 (never stored), 11 Billing1 (Valant billing id),
 * 12 ServiceDate11, 13 ProviderCode1 ("K.Daniel"), 14 DefaultPOS1, 15 Diagnosis11, 16 TransactionCode1,
 * 17 Extended1 (signed amount), 18 ChartNumber1 (Valant patient ID), 19 Note ("Note: ..."). 20+ unused.
 *
 * Pure: safe in the browser (which chunks the file by patient) and on the server.
 */

export const TRANSACTION_HEADER = [
  'Text2', 'textBox1', 'textBox2', 'textBox1', 'textBox1', 'textBox1', 'textBox7', 'textBox2', 'textBox1',
  'textBox4', 'PatientName1', 'Billing1', 'ServiceDate11', 'ProviderCode1', 'DefaultPOS1', 'Diagnosis11',
  'TransactionCode1', 'Extended1', 'ChartNumber1', 'Note',
] as const;

export const NAME_COL = 10;
export const PATIENT_ID_COL = 18;

export type TransactionCategory =
  | 'charge'
  | 'fee'
  | 'insurance_payment'
  | 'insurance_adjustment'
  | 'patient_payment'
  | 'patient_adjustment'
  | 'transfer'
  | 'other';

export const CATEGORY_LABEL: Record<TransactionCategory, string> = {
  charge: 'Charge',
  fee: 'Fee (no-show / late cancel)',
  insurance_payment: 'Insurance payment',
  insurance_adjustment: 'Insurance adjustment',
  patient_payment: 'Patient payment',
  patient_adjustment: 'Patient adjustment / credit',
  transfer: 'Transfer',
  other: 'Other',
};

/**
 * Non-CPT codes seen in the October 2026 export. Keys are the code with any trailing sequence
 * number removed ("Ins EFT 2" -> "ins eft"), lower case. The owner can correct these; anything not
 * listed and not CPT-like is "other".
 */
export const CODE_CATEGORY: Record<string, TransactionCategory> = {
  'ins eft': 'insurance_payment',
  'ins check': 'insurance_payment',
  'ins eft partial': 'insurance_payment',
  'ins check partial': 'insurance_payment',
  'ins cc': 'insurance_payment',
  /** insurance take-back of an earlier payment */
  // Confirmed by the owner 2026-10-17: an insurance charge-back is an adjustment, not a payment
  'ins chg back': 'insurance_adjustment',
  insadjust: 'insurance_adjustment',
  denied: 'insurance_adjustment',
  'auto payment cc': 'patient_payment',
  cash: 'patient_payment',
  check: 'patient_payment',
  'credit cd': 'patient_payment',
  'pat refund': 'patient_payment',
  adjcredit: 'patient_adjustment',
  adjcharge: 'patient_adjustment',
  'pt dsct': 'patient_adjustment',
  'debt wo': 'patient_adjustment',
  'pat xfer from dos': 'transfer',
  'pat xfer to dos': 'transfer',
  'prepay xfer': 'transfer',
  'nsh - thrpy': 'fee',
  nshint: 'fee',
  nshdoc: 'fee',
  rescheduled: 'fee',
  cancelled: 'fee',
};

/** "99214T" -> 99214 + T; "90847C-ITPC" -> 90847 + C-ITPC; "99215-Spravato"; "H2017"; "S9981A" */
export function splitCptCode(code: string): { base: string; suffix: string | null } | null {
  const m = code.trim().match(/^(\d{5}|[A-Za-z]\d{4})([A-Za-z]{0,4})(-[A-Za-z]+)?$/);
  if (!m) return null;
  const rest = `${m[2] ?? ''}${m[3] ?? ''}`;
  return { base: m[1].toUpperCase(), suffix: rest ? rest.toUpperCase() : null };
}

/** Code with a trailing sequence number removed, lower case ("Ins EFT Partial 2" -> "ins eft partial") */
export function codeFamily(code: string): string {
  return code.trim().replace(/\s+\d+$/, '').replace(/\s+/g, ' ').toLowerCase();
}

export function classifyTransactionCode(
  code: string,
  overrides: Record<string, TransactionCategory> = {}
): { category: TransactionCategory; codeBase: string | null; codeSuffix: string | null } {
  const raw = code.trim();
  const fam = codeFamily(raw);
  const over = overrides[raw.toLowerCase()] ?? overrides[fam];
  const cpt = splitCptCode(raw);
  if (over) return { category: over, codeBase: cpt?.base ?? null, codeSuffix: cpt?.suffix ?? null };
  if (CODE_CATEGORY[fam]) return { category: CODE_CATEGORY[fam], codeBase: null, codeSuffix: null };
  if (cpt) return { category: 'charge', codeBase: cpt.base, codeSuffix: cpt.suffix };
  return { category: 'other', codeBase: null, codeSuffix: null };
}

/** "Patient ABCDEF Subtotal:" -> "ABCDEF" */
export function subtotalPatientId(label: string): string | null {
  const m = String(label ?? '').match(/^\s*Patient\s+(.+?)\s+Subtotal:?\s*$/i);
  return m ? m[1].trim().toUpperCase() : null;
}

/** "All transactions on October 17, 2026" (kept as the report label) */
export function transactionReportLabel(records: readonly (readonly string[])[]): string | null {
  return records[1]?.[0]?.trim() || null;
}

export function isTransactionHeader(header: readonly string[] | undefined): boolean {
  return Boolean(header && headerMatches(header, TRANSACTION_HEADER));
}

export type ValantTxnRow = {
  valantPatientId: string;
  billingId: string | null;
  serviceDate: Date | null;
  providerCode: string | null;
  pos: string | null;
  diagnosis: string | null;
  code: string;
  codeBase: string | null;
  codeSuffix: string | null;
  category: TransactionCategory;
  amountCents: number;
  note: string | null;
  /** the patient subtotal printed on the row (cross-check only) */
  patientSubtotalCents: number | null;
};

/** "Note: 12345" -> "12345"; "Note: " -> null */
export function parseNote(raw: string | undefined): string | null {
  const s = String(raw ?? '').replace(/^\s*Note:\s?/i, '').trim();
  return s || null;
}

export function parseTransactionRow(
  cells: readonly string[],
  overrides: Record<string, TransactionCategory> = {}
): { row?: ValantTxnRow; error?: string } {
  const cell = (i: number) => String(cells[i] ?? '').trim();
  const valantPatientId = cell(PATIENT_ID_COL).replace(/\s+/g, ' ').toUpperCase();
  if (!valantPatientId) return { error: 'ChartNumber (Valant patient ID) is blank' };
  const code = cell(16);
  if (!code) return { error: `Patient ${valantPatientId}: transaction code is blank` };
  const amountCents = reportMoneyToCents(cell(17));
  if (amountCents === null) return { error: `Patient ${valantPatientId}: amount is not a dollar value` };
  const dateRaw = cell(12);
  const serviceDate = dateRaw ? parseUsDate(dateRaw) : null;
  if (dateRaw && !serviceDate) return { error: `Patient ${valantPatientId}: service date is not MM/DD/YYYY` };
  const cls = classifyTransactionCode(code, overrides);
  return {
    row: {
      valantPatientId,
      billingId: cell(11) || null,
      serviceDate,
      providerCode: cell(13) || null,
      pos: cell(14) || null,
      diagnosis: cell(15) || null,
      code,
      codeBase: cls.codeBase,
      codeSuffix: cls.codeSuffix,
      category: cls.category,
      amountCents,
      note: parseNote(cells[19]),
      patientSubtotalCents: reportMoneyToCents(cell(9)),
    },
  };
}

/** Identity of a transaction for idempotent re-import (everything stored, nothing derived) */
export function transactionContentKey(r: ValantTxnRow): string {
  return [
    r.valantPatientId, r.billingId ?? '', isoDate(r.serviceDate) ?? '', r.providerCode ?? '', r.pos ?? '',
    r.diagnosis ?? '', r.code, r.amountCents, r.note ?? '',
  ].join('|');
}

/**
 * Occurrence number of each row among identical rows (1, 2, ...), computed over the whole file so
 * chunking never changes a row's identity.
 */
export function occurrenceNumbers(rows: readonly (ValantTxnRow | null)[]): number[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    if (!r) return 0;
    const k = transactionContentKey(r);
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    return n;
  });
}

export type SubtotalCheck = { patients: number; mismatched: string[]; inconsistent: string[] };

/** Each patient's printed subtotal vs the sum of their rows */
export function checkPatientSubtotals(rows: readonly ValantTxnRow[]): SubtotalCheck {
  const by = new Map<string, { sum: number; printed: Set<number | null> }>();
  for (const r of rows) {
    const p = by.get(r.valantPatientId) ?? { sum: 0, printed: new Set<number | null>() };
    p.sum += r.amountCents;
    p.printed.add(r.patientSubtotalCents);
    by.set(r.valantPatientId, p);
  }
  const mismatched: string[] = [];
  const inconsistent: string[] = [];
  for (const [id, p] of by) {
    if (p.printed.size > 1) inconsistent.push(id);
    else if ([...p.printed][0] !== p.sum) mismatched.push(id);
  }
  return { patients: by.size, mismatched, inconsistent };
}

/**
 * Split data rows (header excluded) into chunks of about `size` rows without splitting a patient,
 * so each chunk can cross-check its patients' subtotals. Returns [start, end) index pairs.
 */
export function chunkByPatient(rows: readonly (readonly string[])[], size: number, col: number = PATIENT_ID_COL): [number, number][] {
  const out: [number, number][] = [];
  let start = 0;
  for (let i = 1; i <= rows.length; i++) {
    const atEnd = i === rows.length;
    const boundary = atEnd || String(rows[i][col] ?? '').trim().toUpperCase() !== String(rows[i - 1][col] ?? '').trim().toUpperCase();
    if (atEnd || (boundary && i - start >= size)) {
      out.push([start, i]);
      start = i;
    }
  }
  return out;
}

/** Provider code "K.Daniel" (or the journal's "Dr. A Gbadehan") -> { initial: 'k', last: 'daniel' } */
export function parseProviderCode(code: string | null | undefined): { initial: string; last: string } | null {
  const s = String(code ?? '').trim();
  const m = s.match(/^([A-Za-z])\.\s*([A-Za-z][A-Za-z' -]*)$/) ?? s.match(/^Dr\.?\s+([A-Za-z])\.?\s+([A-Za-z][A-Za-z' -]*)$/i);
  return m ? { initial: m[1].toLowerCase(), last: m[2].trim().toLowerCase().replace(/\s+/g, ' ') } : null;
}

/** Link "K.Daniel" to the one staff member whose first name starts with K and last name is Daniel */
export function matchProviderCode(code: string | null | undefined, staff: readonly { id: string; name: string | null }[]): string | null {
  const p = parseProviderCode(code);
  if (!p) return null;
  const hits = staff.filter((s) => {
    const parts = String(s.name ?? '').toLowerCase().replace(/[^a-z' -]/g, ' ').trim().split(/\s+/).filter(Boolean);
    return parts.length >= 2 && parts[0][0] === p.initial && parts[parts.length - 1] === p.last;
  });
  return hits.length === 1 ? hits[0].id : null;
}
