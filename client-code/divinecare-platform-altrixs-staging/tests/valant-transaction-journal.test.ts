import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCsvText } from '../src/lib/migration/valantReportCommon';
import { chunkByPatient, isTransactionHeader, matchProviderCode, parseTransactionRow, TRANSACTION_HEADER } from '../src/lib/migration/valantTransactions';
import {
  JOURNAL_HEADER,
  JOURNAL_PATIENT_ID_COL,
  isJournalHeader,
  journalOccurrenceNumbers,
  mergeKey,
  parseJournalBasis,
  parseJournalRow,
  planJournalMerge,
  splitPayers,
  type ExistingTxn,
  type ValantJournalRow,
} from '../src/lib/migration/valantTransactionJournal';
import { journalRowHash, transactionRowHash } from '../src/lib/migration/valantTransactionsHash';

// Synthetic fixtures only (no real patients)
const BASIS = 'Transactions with initial charges between January 1, 2026 and ';
type J = Partial<{ id: string; billing: string; date: string; provider: string; facility: string; dx: string; code: string; ins: string; amount: string }>;
function jCells(o: J): string[] {
  return [
    'Facility: ALL FACILITIES', BASIS, 'Patient Type: ALL', 'Insurance: ALL', 'Transaction Code: ALL', 'Provider: ALL', 'Diagnosis: ',
    'Patient: ALL', 'Supervisee: ALL', o.id ?? 'TSTA01', o.billing ?? '100', o.date ?? '10/1/2026', o.provider ?? 'K.Daniel',
    o.facility ?? 'Outpatient Mental Health Clinic - Bowie', o.dx ?? 'F33.3', o.code ?? '90792C', o.ins ?? 'Maryland Public Behavioral Health System',
    o.amount ?? '$300.01',
  ];
}
const jrow = (o: J) => parseJournalRow(jCells(o)).row as ValantJournalRow;

let seq = 0;
/** A stored "Transactions"-layout row with the same merge fields */
function stored(o: J & { layout?: string | null; facility?: string | null; insurance?: string | null; providerCode?: string | null }): ExistingTxn {
  const r = jrow(o);
  seq += 1;
  return {
    id: `e${String(seq).padStart(4, '0')}`, valantPatientId: r.valantPatientId, billingId: r.billingId, serviceDate: r.serviceDate,
    code: o.code ? ` ${o.code.toLowerCase()} ` : r.code, amountCents: r.amountCents, rowHash: `tx-${seq}`, sourceLayout: o.layout ?? null,
    facility: o.facility ?? null, insurance: o.insurance ?? null, providerCode: o.providerCode === undefined ? 'K.Daniel' : o.providerCode,
  };
}
function withHashes(rows: ValantJournalRow[]) {
  const occ = journalOccurrenceNumbers(rows);
  return rows.map((row, i) => ({ row, rowHash: journalRowHash(row, occ[i]) }));
}
/** Apply a plan to an in-memory table, as the route does */
function apply(db: ExistingTxn[], j: ReturnType<typeof withHashes>, plan: ReturnType<typeof planJournalMerge>) {
  let changes = 0;
  for (const m of plan.matched) {
    if (!m.changed) continue;
    const e = db.find((x) => x.id === m.existingId) as ExistingTxn;
    e.facility = j[m.index].row.facility;
    e.insurance = j[m.index].row.insurance;
    if (m.fillProvider) e.providerCode = j[m.index].row.providerCode;
    changes += 1;
  }
  for (const i of plan.inserts) {
    const r = j[i].row;
    seq += 1;
    db.push({ id: `n${seq}`, valantPatientId: r.valantPatientId, billingId: r.billingId, serviceDate: r.serviceDate, code: r.code, amountCents: r.amountCents, rowHash: j[i].rowHash, sourceLayout: 'journal', facility: r.facility, insurance: r.insurance, providerCode: r.providerCode });
    changes += 1;
  }
  return changes;
}

test('journal: header detection distinguishes the two Valant layouts', () => {
  const csv = `${JOURNAL_HEADER.join(',')}\n${jCells({}).map((c) => (c.includes(',') ? `"${c}"` : c)).join(',')}\n`;
  const recs = parseCsvText(`﻿${csv}`);
  assert.ok(isJournalHeader(recs[0]));
  assert.ok(!isTransactionHeader(recs[0]));
  assert.ok(!isJournalHeader([...TRANSACTION_HEADER]));
  assert.ok(!isJournalHeader(JOURNAL_HEADER.slice(0, 17)));
  assert.equal(recs[1][1], BASIS);
});

test('journal: row parsing, money in $ and parentheses, empty and multi-payer insurance', () => {
  const r = jrow({ amount: '($100.00)', code: 'Ins EFT 1', ins: 'NOVITAS SOLUTIONS PART B, Maryland Public Behavioral Health System', date: '1/14/2025' });
  assert.equal(r.amountCents, -10000);
  assert.equal(r.category, 'insurance_payment');
  assert.equal(r.serviceDate?.toISOString().slice(0, 10), '2025-01-14');
  assert.equal(r.insurance, 'NOVITAS SOLUTIONS PART B, Maryland Public Behavioral Health System');
  assert.deepEqual(r.payers, ['NOVITAS SOLUTIONS PART B', 'Maryland Public Behavioral Health System']);
  assert.equal(r.facility, 'Outpatient Mental Health Clinic - Bowie');
  assert.equal(r.valantPatientId, 'TSTA01');
  assert.equal(r.pos, null);
  const empty = jrow({ ins: '' });
  assert.equal(empty.insurance, null);
  assert.deepEqual(empty.payers, []);
  assert.equal(jrow({ amount: '$1,300.01' }).amountCents, 130001);
  assert.deepEqual(splitPayers(' A ,  B '), ['A', 'B']);
  assert.ok(parseJournalRow(jCells({ amount: 'x' })).error);
  assert.ok(parseJournalRow(jCells({ id: '' })).error);
  assert.ok(parseJournalRow(jCells({ date: '2026-10-01' })).error);
  const b = parseJournalBasis(BASIS);
  assert.equal(b.text, BASIS.trim());
  assert.equal(b.start?.toISOString().slice(0, 10), '2026-01-01');
  assert.equal(b.end, null);
});

test('journal: category map is shared with the Transactions import (incl. Ins Chg Back)', () => {
  const cat = (code: string) => jrow({ code }).category;
  assert.equal(cat('Ins Chg Back'), 'insurance_adjustment');
  assert.equal(cat('Ins Chg Back 2'), 'insurance_adjustment');
  assert.equal(cat('InsAdjust'), 'insurance_adjustment');
  assert.equal(cat('Denied 2'), 'insurance_adjustment');
  assert.equal(cat('Auto Payment CC'), 'patient_payment');
  assert.equal(cat('99214T'), 'charge');
  assert.equal(jrow({ code: '99214T' }).codeBase, '99214');
});

test('journal: provider ids link to staff, including "Dr. A Last"', () => {
  const staff = [{ id: 'u1', name: 'Kay Daniel' }, { id: 'u2', name: 'Ann Gbadebo' }];
  assert.equal(matchProviderCode('Dr. A Gbadebo', staff), 'u2');
  assert.equal(matchProviderCode('K.Daniel', staff), 'u1');
  assert.equal(matchProviderCode('Dr. Gbadebo', staff), null);
});

test('journal: merge key ignores code case/spacing and matches a Transactions-layout row', () => {
  const t = parseTransactionRow([
    'All transactions', 'f', 'f', 'f', 'f', 'f', 'f', '$0', 'Patient TSTA01 Subtotal:', '$0', '', '100', '10/01/2026', 'K.Daniel', '11', 'F33.3', '90792c ', '$300.01', 'TSTA01', 'Note: ',
  ]).row!;
  assert.equal(mergeKey(t), mergeKey(jrow({})));
  assert.notEqual(transactionRowHash(t, 1), journalRowHash(jrow({}), 1));
});

test('journal: multiset matching — duplicate keys pair one-for-one, never reusing a stored row', () => {
  // Stored: 2 identical rows; journal: 3 identical rows -> 2 matched, 1 inserted
  const db = [stored({ code: '90834' }), stored({ code: '90834' }), stored({ code: '90837', amount: '$50.00' })];
  const j = withHashes([jrow({ code: '90834' }), jrow({ code: '90834' }), jrow({ code: '90834' }), jrow({ code: 'Ins EFT 1', amount: '($20.00)' })]);
  const plan = planJournalMerge(j, db);
  assert.equal(plan.matched.length, 2);
  assert.equal(new Set(plan.matched.map((m) => m.existingId)).size, 2);
  assert.deepEqual(plan.inserts, [2, 3]);
  assert.equal(plan.untouchedExisting, 1);
  assert.ok(plan.matched.every((m) => m.changed && !m.fillProvider));

  // Stored 3, journal 1 -> 1 matched, 2 stored untouched, none inserted
  const db2 = [stored({ id: 'TSTB02' }), stored({ id: 'TSTB02' }), stored({ id: 'TSTB02' })];
  const p2 = planJournalMerge(withHashes([jrow({ id: 'TSTB02' })]), db2);
  assert.equal(p2.matched.length, 1);
  assert.equal(p2.inserts.length, 0);
  assert.equal(p2.untouchedExisting, 2);
});

test('journal: blank provider on the stored row is filled; other values are not', () => {
  const db = [stored({ providerCode: null })];
  const p = planJournalMerge(withHashes([jrow({})]), db);
  assert.equal(p.matched[0].fillProvider, true);
});

test('journal: re-importing the same journal changes nothing (idempotent)', () => {
  const db = [
    stored({ code: '90834' }), stored({ code: '90834', facility: 'IOP', insurance: 'Old Payer' }), stored({ id: 'TSTC03' }),
  ];
  const rows = [
    jrow({ code: '90834', facility: 'IOP', ins: 'Payer X' }), jrow({ code: '90834', facility: 'Family Practice', ins: '' }),
    jrow({ code: '90834', facility: 'Family Practice', ins: '' }), jrow({ date: '12/30/2025', code: '99214T' }), jrow({ id: 'TSTC03' }),
  ];
  const j = withHashes(rows);
  const first = apply(db, j, planJournalMerge(j, db));
  assert.ok(first > 0);
  const size = db.length;
  // Same file again (fresh parse, fresh hashes)
  const again = withHashes(rows.map((r) => ({ ...r })));
  const plan2 = planJournalMerge(again, db);
  assert.equal(plan2.inserts.length, 0);
  assert.equal(plan2.matched.filter((m) => m.changed).length, 0);
  assert.equal(apply(db, again, plan2), 0);
  assert.equal(db.length, size);
  // Third run too
  assert.equal(apply(db, again, planJournalMerge(again, db)), 0);
});

test('journal: 2025 service rows charged in 2026 are inserted as new journal rows', () => {
  const db = [stored({ date: '1/5/2026' })];
  const j = withHashes([jrow({ date: '1/5/2026' }), jrow({ date: '11/14/2025', billing: '90' }), jrow({ date: '1/14/2025', billing: '91', code: 'InsAdjust', amount: '($10.00)' })]);
  const p = planJournalMerge(j, db);
  assert.deepEqual(p.inserts, [1, 2]);
  assert.deepEqual(p.inserts.map((i) => j[i].row.serviceDate?.getUTCFullYear()), [2025, 2025]);
  assert.equal(p.matched.length, 1);
});

test('journal: chunks by PatientID never split a patient', () => {
  const rows = ['A', 'A', 'B', 'B', 'B', 'C'].map((id) => jCells({ id }));
  const chunks = chunkByPatient(rows, 2, JOURNAL_PATIENT_ID_COL);
  assert.deepEqual(chunks, [[0, 2], [2, 5], [5, 6]]);
});
