import { parseAgingAsOf, agingPatientId, type Buckets } from './valantAging';
import { parseUsDate, reportMoneyToCents } from './valantReportCommon';

/**
 * Valant "Combined Aging" export (CSV, real column names). REFERENCE ONLY.
 *
 * Report-level (cross-check only): PatientGroupLabel (title with the as-of date), GrandTotal,
 * Total30, Total60, Total90, Total120, TotalOver120 (= buckets 1..5).
 * Per row: DetailTotal1..5 + DetailTotalTotal = that PATIENT's totals (repeated on each of the
 * patient's rows, so deduped by patient), GroupDetailPatientName "VALANTID: Name" (only the ID is
 * kept), then repeating blocks of InsuranceRowName / InsuranceRowLastBilled / InsuranceRowDetail1..5 /
 * InsuranceRowDetailTotal: one responsible-party line each ('Patient', '(Primary) <payer>',
 * '(Secondary) <payer>'). The header names repeat for every block, so blocks are read by position
 * from each InsuranceRowName column. Blank detail cells are $0.
 *
 * GroupDetailPhoneNumber and GroupDetailPatientAddress are PHI and are never read.
 */

export type ResponsibleParty = 'patient' | 'primary' | 'secondary' | 'other';

export type CombinedPartyRow = {
  line: number;
  valantPatientId: string;
  party: ResponsibleParty;
  payerName: string | null;
  lastBilledAt: Date | null;
  bucketsCents: Buckets;
  totalCents: number;
  bucketsMatchTotal: boolean;
};

export type CombinedPatient = {
  valantPatientId: string;
  bucketsCents: Buckets;
  totalCents: number;
  /** party lines add up to the patient's DetailTotalTotal */
  partiesMatchTotal: boolean;
  /** the patient's DetailTotal cells were identical on all of their rows */
  consistentAcrossRows: boolean;
};

export type CombinedParse = {
  ok: boolean;
  error?: string;
  asOf: Date | null;
  blocks: number;
  partyRows: CombinedPartyRow[];
  patients: CombinedPatient[];
  errors: { line: number; error: string }[];
  partyCounts: Record<ResponsibleParty, number>;
  reportBucketsCents: (number | null)[];
  reportGrandTotalCents: number | null;
  patientBucketSumsCents: Buckets;
  patientTotalSumCents: number;
  partyTotalSumCents: number;
  partyRowsWithBucketMismatch: number;
  patientsWithPartyMismatch: number;
  patientsInconsistent: number;
  reconcile: { buckets: boolean[]; patientTotal: boolean; partyTotal: boolean; all: boolean };
};

const REQUIRED = [
  'PatientGroupLabel', 'GrandTotal', 'TotalOver120', 'Total120', 'Total90', 'Total60', 'Total30',
  'DetailTotal1', 'DetailTotal2', 'DetailTotal3', 'DetailTotal4', 'DetailTotal5', 'DetailTotalTotal',
  'GroupDetailPatientName', 'InsuranceRowName',
] as const;
const BLOCK = [
  'InsuranceRowName', 'InsuranceRowLastBilled', 'InsuranceRowDetail1', 'InsuranceRowDetail2',
  'InsuranceRowDetail3', 'InsuranceRowDetail4', 'InsuranceRowDetail5', 'InsuranceRowDetailTotal',
] as const;

/** 'Patient' | '(Primary) Aetna' | '(Secondary) Medicare' */
export function parseResponsibleParty(raw: string): { party: ResponsibleParty; payerName: string | null } {
  const s = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (/^patient$/i.test(s)) return { party: 'patient', payerName: null };
  const m = s.match(/^\((primary|secondary)\)\s*(.*)$/i);
  if (m) return { party: m[1].toLowerCase() as 'primary' | 'secondary', payerName: m[2].trim() || null };
  return { party: 'other', payerName: s || null };
}

/** Column index of every block start, verified to have the full 8-column block layout */
export function combinedBlockStarts(header: readonly string[]): number[] | null {
  const h = header.map((c) => String(c).replace(/^﻿/, '').trim());
  const starts: number[] = [];
  h.forEach((name, i) => {
    if (name === 'InsuranceRowName') starts.push(i);
  });
  for (const s of starts) if (!BLOCK.every((name, k) => h[s + k] === name)) return null;
  return starts;
}

const money0 = (v: string | undefined) => {
  const s = String(v ?? '').trim();
  return s ? reportMoneyToCents(s) : 0;
};

export function parseCombinedAgingReport(records: readonly (readonly string[])[]): CombinedParse {
  const base: CombinedParse = {
    ok: false, asOf: null, blocks: 0, partyRows: [], patients: [], errors: [],
    partyCounts: { patient: 0, primary: 0, secondary: 0, other: 0 },
    reportBucketsCents: [null, null, null, null, null], reportGrandTotalCents: null,
    patientBucketSumsCents: [0, 0, 0, 0, 0], patientTotalSumCents: 0, partyTotalSumCents: 0,
    partyRowsWithBucketMismatch: 0, patientsWithPartyMismatch: 0, patientsInconsistent: 0,
    reconcile: { buckets: [false, false, false, false, false], patientTotal: false, partyTotal: false, all: false },
  };
  const [rawHeader, ...data] = records;
  const header = (rawHeader ?? []).map((c) => String(c).replace(/^﻿/, '').trim());
  const col = (name: string) => header.indexOf(name);
  if (!rawHeader || REQUIRED.some((n) => col(n) < 0)) {
    return { ...base, error: 'This is not the Valant Combined Aging export (expected columns are missing).' };
  }
  const starts = combinedBlockStarts(header);
  if (!starts || !starts.length) return { ...base, error: 'The responsible-party columns are not in the expected layout.' };
  const body = data.filter((r) => r.some((c) => String(c).trim()));
  if (!body.length) return { ...base, error: 'The file has no rows.' };
  const asOf = parseAgingAsOf(String(body[0][col('PatientGroupLabel')] ?? ''));
  if (!asOf) return { ...base, error: 'Could not read the "as of" date from the report title.' };

  const detailCols = ['DetailTotal1', 'DetailTotal2', 'DetailTotal3', 'DetailTotal4', 'DetailTotal5'].map(col);
  const totalCol = col('DetailTotalTotal');
  const idCol = col('GroupDetailPatientName');
  const errors: { line: number; error: string }[] = [];
  const partyRows: CombinedPartyRow[] = [];
  const patients = new Map<string, CombinedPatient & { key: string }>();

  body.forEach((cells, i) => {
    const line = i + 2;
    const id = agingPatientId(String(cells[idCol] ?? ''));
    if (!id) return errors.push({ line, error: 'No Valant patient ID before the colon' });
    const pb = detailCols.map((c) => money0(cells[c]));
    const pt = money0(cells[totalCol]);
    if (pb.some((v) => v === null) || pt === null) return errors.push({ line, error: `Patient ${id}: a patient total is not a dollar value` });
    const key = [...pb, pt].join('|');
    const prior = patients.get(id);
    if (prior) {
      if (prior.key !== key) prior.consistentAcrossRows = false;
    } else {
      const b = pb as number[];
      patients.set(id, {
        key, valantPatientId: id, bucketsCents: [b[0], b[1], b[2], b[3], b[4]], totalCents: pt,
        partiesMatchTotal: false, consistentAcrossRows: true,
      });
    }
    for (const s of starts) {
      const block = cells.slice(s, s + BLOCK.length).map((c) => String(c ?? '').trim());
      if (!block.some(Boolean)) continue;
      if (!block[0]) {
        errors.push({ line, error: `Patient ${id}: a responsible-party block has amounts but no name` });
        continue;
      }
      const amounts = block.slice(2, 7).map((v) => money0(v));
      const total = money0(block[7]);
      if (amounts.some((v) => v === null) || total === null) {
        errors.push({ line, error: `Patient ${id}: a responsible-party amount is not a dollar value` });
        continue;
      }
      const a = amounts as number[];
      const { party, payerName } = parseResponsibleParty(block[0]);
      partyRows.push({
        line,
        valantPatientId: id,
        party,
        payerName,
        lastBilledAt: parseUsDate(block[1]),
        bucketsCents: [a[0], a[1], a[2], a[3], a[4]],
        totalCents: total,
        bucketsMatchTotal: a.reduce((x, y) => x + y, 0) === total,
      });
    }
  });

  const partySumByPatient = new Map<string, number>();
  for (const r of partyRows) partySumByPatient.set(r.valantPatientId, (partySumByPatient.get(r.valantPatientId) ?? 0) + r.totalCents);
  const patientList: CombinedPatient[] = [...patients.values()].map(({ valantPatientId, bucketsCents, totalCents, consistentAcrossRows }) => ({
    valantPatientId,
    bucketsCents,
    totalCents,
    consistentAcrossRows,
    partiesMatchTotal: (partySumByPatient.get(valantPatientId) ?? 0) === totalCents,
  }));

  const sums: Buckets = [0, 0, 0, 0, 0];
  let patientTotal = 0;
  for (const p of patientList) {
    p.bucketsCents.forEach((c, i) => (sums[i] += c));
    patientTotal += p.totalCents;
  }
  const partyTotal = partyRows.reduce((s, r) => s + r.totalCents, 0);
  const first = body[0];
  const reportBucketsCents = ['Total30', 'Total60', 'Total90', 'Total120', 'TotalOver120'].map((n) => reportMoneyToCents(String(first[col(n)] ?? '')));
  const grand = reportMoneyToCents(String(first[col('GrandTotal')] ?? ''));
  const bucketsOk = reportBucketsCents.map((v, i) => v === sums[i]);
  const partyCounts: Record<ResponsibleParty, number> = { patient: 0, primary: 0, secondary: 0, other: 0 };
  for (const r of partyRows) partyCounts[r.party] += 1;
  const patientsWithPartyMismatch = patientList.filter((p) => !p.partiesMatchTotal).length;
  const patientsInconsistent = patientList.filter((p) => !p.consistentAcrossRows).length;
  const reconcile = {
    buckets: bucketsOk,
    patientTotal: grand === patientTotal,
    partyTotal: grand === partyTotal,
    all: false,
  };
  reconcile.all = bucketsOk.every(Boolean) && reconcile.patientTotal && reconcile.partyTotal &&
    patientsWithPartyMismatch === 0 && patientsInconsistent === 0 && errors.length === 0;

  return {
    ok: true,
    asOf,
    blocks: starts.length,
    partyRows,
    patients: patientList,
    errors,
    partyCounts,
    reportBucketsCents,
    reportGrandTotalCents: grand,
    patientBucketSumsCents: sums,
    patientTotalSumCents: patientTotal,
    partyTotalSumCents: partyTotal,
    partyRowsWithBucketMismatch: partyRows.filter((r) => !r.bucketsMatchTotal).length,
    patientsWithPartyMismatch,
    patientsInconsistent,
    reconcile,
  };
}
