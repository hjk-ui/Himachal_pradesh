import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatCents, parseCsvText, reportMoneyToCents } from '../src/lib/migration/valantReportCommon';
import {
  DEFAULT_AGING_LABELS,
  INSURANCE_AGING_LAYOUT,
  PATIENT_AGING_LAYOUT,
  bucketPercents,
  groupByPayer,
  normalizeAgingLabels,
  parseAgingAsOf,
  parseAgingReport,
} from '../src/lib/migration/valantAging';
import { parseCombinedAgingReport, parseResponsibleParty } from '../src/lib/migration/valantCombinedAging';
import {
  PREPAYMENT_HEADER,
  buildNameIndex,
  matchByName,
  nameKey,
  parsePrepaymentPeriod,
  parsePrepaymentReport,
  prepaymentStanding,
} from '../src/lib/migration/valantPrepayments';
import {
  COPAY_HEADER,
  copayRuleKey,
  normalizeProviderType,
  parseCopayReport,
  pickCopayRule,
  providerTypeForRole,
} from '../src/lib/migration/valantCopays';
import {
  TRANSACTION_HEADER,
  checkPatientSubtotals,
  chunkByPatient,
  classifyTransactionCode,
  matchProviderCode,
  occurrenceNumbers,
  parseNote,
  parseTransactionRow,
  splitCptCode,
  subtotalPatientId,
  type ValantTxnRow,
} from '../src/lib/migration/valantTransactions';
import { transactionRowHash } from '../src/lib/migration/valantTransactionsHash';
import {
  authIsExpired,
  importedAuthNotes,
  parseAuthorizationReport,
  valantAuthSubmissionKey,
} from '../src/lib/migration/valantAuthorizations';
import { selectPriorAuth, type PayerMappingConfig, type PriorAuthRecord } from '../src/lib/billing/waystarSftpClaims';
import { canAccessPath } from '../src/lib/auth/roleAccess';

// ---------- money / dates ----------

test('report money: dollars, commas, parentheses and minus negatives', () => {
  assert.equal(reportMoneyToCents('$337.86'), 33786);
  assert.equal(reportMoneyToCents('($79.17)'), -7917);
  assert.equal(reportMoneyToCents('-$79.17'), -7917);
  assert.equal(reportMoneyToCents('$-79.17'), -7917);
  assert.equal(reportMoneyToCents('1,448.37'), 144837);
  assert.equal(reportMoneyToCents('($9,999)'), -999900);
  assert.equal(reportMoneyToCents('$0'), 0);
  assert.equal(reportMoneyToCents('($167,923.28)'), -16792328);
  assert.equal(reportMoneyToCents(''), null);
  assert.equal(reportMoneyToCents('n/a'), null);
  assert.equal(formatCents(-7917), '-$79.17');
  assert.equal(formatCents(123456), '$1,234.56');
});

// ---------- patient aging ----------

const AGING_TITLE = 'Patient balance due as of October 17, 2026';
function agingRow(id: string, b: string[], total: string, report = ['$55.00', '$0.00', '$0.00', '$18962.64', '$5557.26', '$24574.90']) {
  // cols 0-15: title, 3 filters, report cells (4 = b3, 5 = b2, 6 = b1, 11 = b4, 12 = b5, 14 = total)
  const cells = [AGING_TITLE, 'Patient Type: ALL', 'Facility: ALL', 'Provider: ALL', report[0], report[1], report[2], '0.00 %', '0.00 %', '0.22 %', '77.16 %', report[3], report[4], '22.61 %', report[5], '100.00 %'];
  return [...cells, b[0], `${id}: Test Person`, b[1], b[2], b[3], b[4], total];
}

test('aging: as-of date, buckets by position, parentheses negatives, bucket/total check', () => {
  assert.equal(parseAgingAsOf(AGING_TITLE)?.toISOString().slice(0, 10), '2026-10-17');
  const report = ['$10.00', '$0.00', '$0.00', '$100.00', '($20.00)', '$90.00'];
  const recs = [
    [...PATIENT_AGING_LAYOUT.header],
    agingRow('AAA1', ['$0.00', '$0.00', '$10.00', '$60.00', '$0.00'], '$70.00', report),
    agingRow('BBB2', ['$0.00', '$0.00', '$0.00', '$40.00', '($20.00)'], '$20.00', report),
  ];
  const a = parseAgingReport(recs);
  assert.ok(a.ok);
  assert.equal(a.rows.length, 2);
  assert.deepEqual(a.rows[1].bucketsCents, [0, 0, 0, 4000, -2000]);
  assert.equal(a.rowsWithBucketMismatch, 0);
  assert.deepEqual(a.columnSumsCents, [0, 0, 1000, 10000, -2000]);
  assert.equal(a.totalSumCents, 9000);
  assert.ok(a.reconcile.all);
  // The patient name after the colon is never kept
  assert.ok(!JSON.stringify(a).includes('Test Person'));
});

test('aging: a row whose buckets do not add up is reported, not fixed', () => {
  const report = ['$0.00', '$0.00', '$0.00', '$0.00', '$0.00', '$5.00'];
  const a = parseAgingReport([[...PATIENT_AGING_LAYOUT.header], agingRow('CCC3', ['$0.00', '$0.00', '$0.00', '$0.00', '$0.00'], '$5.00', report)]);
  assert.equal(a.rowsWithBucketMismatch, 1);
  assert.equal(a.rows[0].totalCents, 500);
  assert.ok(a.reconcile.total);
});

test('aging: totals that disagree with the report do not reconcile; wrong header is rejected', () => {
  const a = parseAgingReport([[...PATIENT_AGING_LAYOUT.header], agingRow('DDD4', ['$0.00', '$0.00', '$1.00', '$0.00', '$0.00'], '$1.00')]);
  assert.equal(a.reconcile.all, false);
  assert.equal(parseAgingReport([['Patient ID', 'Balance'], ['X', '1']]).ok, false);
});

test('insurance aging: payer rows kept even when names repeat; grouped view and percents', () => {
  const title = 'Insurance balance due as of October 17, 2026';
  const row = (payer: string, b: string[], total: string) => [
    title, '$0.00', '$0.00', '$30.00', '0 %', '0 %', '0 %', '0 %', '$0.00', '$70.00', '0 %', '$100.00', '100 %',
    b[0], payer, b[1], b[2], b[3], b[4], total,
  ];
  const a = parseAgingReport(
    [[...INSURANCE_AGING_LAYOUT.header], row('Aetna', ['$10.00', '$0.00', '$0.00', '$0.00', '$40.00'], '$50.00'), row('Aetna', ['$20.00', '$0.00', '$0.00', '$0.00', '$30.00'], '$50.00')],
    INSURANCE_AGING_LAYOUT
  );
  assert.ok(a.ok);
  assert.equal(a.rows.length, 2);
  assert.ok(a.reconcile.all, JSON.stringify(a.reconcile));
  const g = groupByPayer(a.rows.map((r) => ({ payerName: r.key, bucketsCents: r.bucketsCents, totalCents: r.totalCents })));
  assert.equal(g.length, 1);
  assert.equal(g[0].rows, 2);
  assert.equal(g[0].totalCents, 10000);
  assert.deepEqual(bucketPercents([3000, 0, 0, 0, 7000], 10000), [30, 0, 0, 0, 70]);
});

test('aging labels: defaults inferred from Combined Aging column names; blanks fall back', () => {
  assert.deepEqual([...DEFAULT_AGING_LABELS], ['0–30', '31–60', '61–90', '91–120', 'Over 120']);
  assert.deepEqual(normalizeAgingLabels(['Current', '', 'x'.repeat(50)]), ['Current', '31–60', 'x'.repeat(40), '91–120', 'Over 120']);
});

// ---------- combined aging ----------

const COMBINED_HEAD = [
  'PatientGroupLabel', 'PatientTypeLabel', 'FacilityLabel', 'ProviderLabel', 'PatientLabel', 'GrandTotal', 'TotalOver120', 'Total120',
  'Total90', 'Total60', 'Total30', 'GroupHeading', 'GroupTwoHeading', 'GroupOver120Total', 'GroupTotalTotal', 'Group120Total',
  'Group90Total', 'Group60Total', 'Group30Total', 'DetailTotal1', 'DetailTotal2', 'DetailTotal3', 'DetailTotal4', 'DetailTotal5',
  'DetailTotalTotal', 'GroupDetailPatientName', 'GroupDetailPhoneNumber', 'GroupDetailPatientAddress',
];
const BLOCK = ['InsuranceRowName', 'InsuranceRowLastBilled', 'InsuranceRowDetail1', 'InsuranceRowDetail2', 'InsuranceRowDetail3', 'InsuranceRowDetail4', 'InsuranceRowDetail5', 'InsuranceRowDetailTotal'];

function combinedRow(id: string, patient: string[], blocks: string[][]) {
  const head = [
    'Patient balance due as of October 17, 2026', 'Type', 'Facility', 'Provider', 'Patient', '$150.00', '$150.00', '$0.00', '$0.00', '$0.00', '$0.00',
    '', '', '$150.00', '$150.00', '$0.00', '$0.00', '$0.00', '$0.00', ...patient, `${id}: Secret Name`, 'PHONE-SENTINEL', 'ADDRESS-SENTINEL',
  ];
  return [...head, ...blocks.flat()];
}

test('combined aging: header names with repeating blocks, patient dedupe, responsible parties, reconcile', () => {
  const header = [...COMBINED_HEAD, ...BLOCK, ...BLOCK];
  const empty = ['', '', '', '', '', '', '', ''];
  const recs = [
    header,
    combinedRow('P1', ['$0.00', '$0.00', '$0.00', '$0.00', '$100.00', '$100.00'], [['(Primary) Aetna', '09/01/2026', '', '', '', '', '$60.00', '$60.00'], empty]),
    combinedRow('P1', ['$0.00', '$0.00', '$0.00', '$0.00', '$100.00', '$100.00'], [['Patient', '09/15/2026', '', '', '', '', '$40.00', '$40.00'], empty]),
    // a second block filled on the same row
    combinedRow('P2', ['$0.00', '$0.00', '$0.00', '$0.00', '$50.00', '$50.00'], [['(Primary) Cigna', '', '', '', '', '', '$30.00', '$30.00'], ['(Secondary) Medicare', '10/01/2026', '', '', '', '', '$20.00', '$20.00']]),
  ];
  const c = parseCombinedAgingReport(recs);
  assert.ok(c.ok, c.error);
  assert.equal(c.blocks, 2);
  assert.equal(c.patients.length, 2);
  assert.equal(c.partyRows.length, 4);
  assert.deepEqual(c.partyCounts, { patient: 1, primary: 2, secondary: 1, other: 0 });
  assert.equal(c.patientTotalSumCents, 15000);
  assert.equal(c.partyTotalSumCents, 15000);
  assert.ok(c.reconcile.all, JSON.stringify(c.reconcile));
  assert.equal(c.partyRows[0].lastBilledAt?.toISOString().slice(0, 10), '2026-09-01');
  const json = JSON.stringify(c);
  assert.ok(!json.includes('PHONE-SENTINEL') && !json.includes('ADDRESS-SENTINEL') && !json.includes('Secret Name'));
  assert.deepEqual(parseResponsibleParty('(Secondary) AARP Medicare'), { party: 'secondary', payerName: 'AARP Medicare' });
});

test('combined aging: party lines that do not add up to the patient total are flagged', () => {
  const header = [...COMBINED_HEAD, ...BLOCK];
  const c = parseCombinedAgingReport([header, combinedRow('P9', ['$0.00', '$0.00', '$0.00', '$0.00', '$150.00', '$150.00'], [['Patient', '', '', '', '', '', '$100.00', '$100.00']])]);
  assert.equal(c.patientsWithPartyMismatch, 1);
  assert.equal(c.reconcile.all, false);
});

// ---------- prepayments ----------

const PRE_TITLE = 'All prepayments between January 1, 2026 and October 16, 2026';
const pre = (type: string, date: string, ref: string, amount: string, name: string, applied = '', net = '30.00') => [
  PRE_TITLE, 'Patient Type: ALL', 'Facility: ALL', 'Provider: ALL', net, type, date, ref, amount, name, applied, date,
];

test('prepayments: period, sign handling, reconciliation', () => {
  const p = parsePrepaymentPeriod(PRE_TITLE);
  assert.equal(p?.start.toISOString().slice(0, 10), '2026-01-01');
  assert.equal(p?.end.toISOString().slice(0, 10), '2026-10-16');
  const r = parsePrepaymentReport([
    [...PREPAYMENT_HEADER],
    pre('Credit Card', '01/12/2026', 'For appt', '100.00', 'Ann Lee'),
    pre('Check', '02/01/2026', '1234', '20.00', 'Bo Kim'),
    pre('Prepayment Transfer', '02/02/2026', '', '-90.00', 'ann  LEE', '18324'),
  ]);
  assert.ok(r.ok);
  assert.equal(r.received, 2);
  assert.equal(r.applied, 1);
  assert.equal(r.sumCents, 3000);
  assert.ok(r.reconciles);
  assert.equal(r.distinctNames, 2);
  assert.equal(r.txns[2].appliedTo, '18324');
  assert.equal(r.txns[2].kind, 'applied');
});

test('prepayments: unknown types and wrong signs are errors', () => {
  const r = parsePrepaymentReport([
    [...PREPAYMENT_HEADER],
    pre('Gift Card', '01/12/2026', '', '5.00', 'A B'),
    pre('Prepayment Transfer', '01/12/2026', '', '5.00', 'A B'),
    pre('Credit Card', '01/12/2026', '', '-5.00', 'A B'),
  ]);
  assert.equal(r.errors.length, 3);
  assert.equal(r.reconciles, false);
});

test('prepayments: row hash is stable across re-exports and identical rows stay distinct', () => {
  const rows = [[...PREPAYMENT_HEADER], pre('Credit Card', '03/01/2026', '', '10.00', 'Cy Doe'), pre('Credit Card', '03/01/2026', '', '10.00', 'Cy Doe')];
  const a = parsePrepaymentReport(rows);
  const wider = rows.map((r, i) => (i === 0 ? r : [r[0].replace('January 1, 2026', 'January 1, 2024'), ...r.slice(1)]));
  const b = parsePrepaymentReport(wider);
  assert.notEqual(a.txns[0].rowHash, a.txns[1].rowHash);
  assert.deepEqual(a.txns.map((t) => t.rowHash), b.txns.map((t) => t.rowHash));
});

test('prepayments: a Patient ID column is detected when a future export has one', () => {
  const header = [...PREPAYMENT_HEADER, 'Patient ID'];
  const r = parsePrepaymentReport([header, [...pre('Check', '03/01/2026', '', '30.00', 'Cy Doe'), 'abc12']]);
  assert.equal(r.patientIdCol, 12);
  assert.equal(r.txns[0].valantPatientId, 'ABC12');
});

test('name matching: unique exact names only; duplicates and misses go to Unmatched', () => {
  const index = buildNameIndex([
    { id: 'c1', name: 'Ann Lee' },
    { id: 'c2', name: 'Maria Bonilla' },
    { id: 'c3', name: 'Maria  BONILLA' },
    { id: 'c4', name: 'M J Argueta', legalFirstName: 'Maria', middleInitial: 'J.', legalLastName: 'Argueta' },
  ]);
  assert.deepEqual(matchByName(index, ' ann lee '), { kind: 'matched', clientId: 'c1' });
  assert.deepEqual(matchByName(index, 'Maria Bonilla'), { kind: 'duplicate', candidates: 2 });
  assert.deepEqual(matchByName(index, 'Maria J Argueta'), { kind: 'matched', clientId: 'c4' });
  assert.deepEqual(matchByName(index, 'Maria Argueta'), { kind: 'matched', clientId: 'c4' });
  assert.deepEqual(matchByName(index, 'Ann Leee'), { kind: 'none' });
  assert.equal(nameKey('  A   B '), 'a b');
});

test('negative net prepayment is incomplete, never a negative credit', () => {
  const s = prepaymentStanding(-5000, new Date(Date.UTC(2026, 0, 1, 12)));
  assert.equal(s.incomplete, true);
  assert.equal(s.remainingCents, null);
  assert.equal(s.note, 'Incomplete: prepayments received before 2026-01-01 are not in this report');
  assert.deepEqual(prepaymentStanding(2500, '2026-01-01'), { netCents: 2500, remainingCents: 2500, incomplete: false, note: null });
  assert.equal(prepaymentStanding(0, null).incomplete, false);
});

// ---------- copays ----------

const cop = (payer: string, id: string, amount: string, ptype = '', cpt = '', limit = '($9,999)') => [
  'Facility: ALL', 'Patient: ALL', 'Provider: ALL', 'Payer: ALL', 'CPT: ALL', payer, 'Hidden Name', id, amount, ptype, cpt, limit,
];

test('copays: parsing, provider type typo, limit kept raw, duplicates reported', () => {
  const c = parseCopayReport([
    [...COPAY_HEADER],
    cop('Aetna', 'BOOLUC', '$0'),
    cop('Aetna', 'booluc', '$55', 'Nurse Practioner', 'H2018', '$100'),
    cop('Aetna', 'BOOLUC', '$60', 'Nurse Practioner', 'H2018'),
    cop('Cigna', 'DE RAQ', '$20', '', 'Default'),
  ]);
  assert.ok(c.ok);
  assert.equal(c.rules.length, 3);
  assert.equal(c.duplicateKeys, 1);
  assert.equal(c.conflictingDuplicates, 1);
  assert.equal(c.rules[1].providerType, 'Nurse Practitioner');
  assert.equal(c.rules[1].cptRule, 'H2018');
  assert.equal(c.rules[1].valantLimitRaw, '$100');
  assert.equal(c.rules[1].valantLimitCents, 10000);
  assert.equal(c.rules[0].valantLimitCents, -999900);
  assert.equal(c.rules[2].valantPatientId, 'DE RAQ');
  assert.ok(!JSON.stringify(c).includes('Hidden Name'));
  assert.equal(normalizeProviderType(' nurse  practitioner '), 'Nurse Practitioner');
});

test('copays: rule key is stable for idempotent re-import', () => {
  const a = { clientId: 'c1', payerName: 'Aetna', providerType: 'Therapist', cptRule: 'h2018' };
  assert.equal(copayRuleKey(a), copayRuleKey({ ...a, payerName: 'AETNA', cptRule: 'H2018' }));
  assert.notEqual(copayRuleKey(a), copayRuleKey({ ...a, providerType: '' }));
});

test('copayFor picks the most specific rule: CPT > provider type > blank', () => {
  const r = (providerType: string, cptRule: string, amountCents: number, source = 'valant', payerName = 'Aetna') => ({ payerName, providerType, cptRule, amountCents, source });
  const rules = [r('', '', 2000), r('Psychiatrist', '', 4000), r('', 'H2018', 1000), r('Therapist', 'H2018', 500), r('', '90837', 3000)];
  const pick = (q: Parameters<typeof pickCopayRule>[1]) => {
    const p = pickCopayRule(rules, q);
    return p.ok ? p.amountCents : p.reason;
  };
  assert.equal(pick({ payerName: 'aetna', providerType: 'Therapist', cpt: 'H2018' }), 500);
  assert.equal(pick({ payerName: 'Aetna', providerType: 'Psychiatrist', cpt: 'H2018' }), 1000);
  assert.equal(pick({ payerName: 'Aetna', providerType: 'Psychiatrist', cpt: '99214' }), 4000);
  assert.equal(pick({ payerName: 'Aetna', providerType: 'Physician', cpt: '99214' }), 2000);
  assert.equal(pick({ payerName: 'Cigna', providerType: 'Therapist' }), 'no-matching-rule');
  assert.equal(pick({ providerType: 'Therapist' }), 2000);
  assert.equal(pickCopayRule([...rules, r('', '', 0, 'valant', 'Cigna')], {}).ok, false);
  // Altrixs-entered beats imported at the same specificity; blank beats 'Default'
  const tie = pickCopayRule([r('', 'Default', 900), r('', '', 2000), r('', '', 1500, 'altrixs')], { payerName: 'Aetna' });
  assert.ok(tie.ok && tie.amountCents === 1500 && tie.ambiguous);
  assert.equal(providerTypeForRole('MEDICAL_NP'), 'Nurse Practitioner');
  assert.equal(providerTypeForRole('FRONT_DESK'), null);
});

// ---------- transactions ----------

function txCells(o: Partial<{ id: string; code: string; amount: string; date: string; subtotal: string; billing: string; provider: string; note: string }>) {
  const id = o.id ?? 'ABC1';
  return [
    'All transactions on October 17, 2026', 'f', 'f', 'f', 'f', 'f', 'f', '($167,923.28)', `Patient ${id} Subtotal:`, o.subtotal ?? '$0.00',
    'Hidden Patient', o.billing ?? '54310', o.date ?? '10/01/2026', o.provider ?? 'K.Daniel', '11', 'F33.3', o.code ?? '90792C', o.amount ?? '$300.00', id, o.note ?? 'Note: ',
  ];
}

test('transactions: code classification keeps raw code and splits CPT base/suffix', () => {
  const c = (code: string) => classifyTransactionCode(code);
  assert.deepEqual(c('99214T'), { category: 'charge', codeBase: '99214', codeSuffix: 'T' });
  assert.deepEqual(c('90847C-ITPC'), { category: 'charge', codeBase: '90847', codeSuffix: 'C-ITPC' });
  assert.deepEqual(c('H0032'), { category: 'charge', codeBase: 'H0032', codeSuffix: null });
  assert.equal(c('99386s').codeSuffix, 'S');
  assert.equal(c('Ins EFT 1').category, 'insurance_payment');
  assert.equal(c('Ins EFT Partial 3').category, 'insurance_payment');
  assert.equal(c('Ins Check Partial 2').category, 'insurance_payment');
  assert.equal(c('InsAdjust').category, 'insurance_adjustment');
  assert.equal(c('Denied 2').category, 'insurance_adjustment');
  assert.equal(c('Auto Payment CC').category, 'patient_payment');
  assert.equal(c('AdjCredit').category, 'patient_adjustment');
  assert.equal(c('Prepay Xfer').category, 'transfer');
  assert.equal(c('NSH - Thrpy').category, 'fee');
  assert.equal(c('0000').category, 'other');
  assert.equal(classifyTransactionCode('Ins Chg Back', { 'ins chg back': 'insurance_adjustment' }).category, 'insurance_adjustment');
  assert.equal(splitCptCode('Cash'), null);
});

test('transactions: row parsing, amounts, note text, no patient name', () => {
  const r = parseTransactionRow(txCells({ amount: '($5.00)', code: 'AdjCredit', note: 'Note: ref 12345' })).row as ValantTxnRow;
  assert.equal(r.amountCents, -500);
  assert.equal(r.note, 'ref 12345');
  assert.equal(r.valantPatientId, 'ABC1');
  assert.equal(r.serviceDate?.toISOString().slice(0, 10), '2026-10-01');
  assert.equal(parseNote('Note: '), null);
  assert.equal(parseTransactionRow(txCells({ amount: '-$100.00' })).row?.amountCents, -10000);
  assert.ok(!JSON.stringify(r).includes('Hidden Patient'));
  assert.equal(subtotalPatientId('Patient BENJOS78 Subtotal:'), 'BENJOS78');
  assert.ok(parseTransactionRow(txCells({ amount: 'abc' })).error);
  assert.equal(TRANSACTION_HEADER[17], 'Extended1');
});

test('transactions: patient subtotal cross-check', () => {
  const rows = [
    parseTransactionRow(txCells({ id: 'A', amount: '$300.00', subtotal: '$250.00' })).row,
    parseTransactionRow(txCells({ id: 'A', amount: '-$50.00', subtotal: '$250.00', code: 'Ins EFT 1' })).row,
    parseTransactionRow(txCells({ id: 'B', amount: '$10.00', subtotal: '$99.00' })).row,
  ] as ValantTxnRow[];
  const s = checkPatientSubtotals(rows);
  assert.equal(s.patients, 2);
  assert.deepEqual(s.mismatched, ['B']);
});

test('transactions: idempotent hashing with occurrence numbers', () => {
  const a = parseTransactionRow(txCells({ amount: '$10.00' })).row as ValantTxnRow;
  const b = parseTransactionRow(txCells({ amount: '$10.00' })).row as ValantTxnRow;
  const c = parseTransactionRow(txCells({ amount: '$11.00' })).row as ValantTxnRow;
  const occ = occurrenceNumbers([a, b, c]);
  assert.deepEqual(occ, [1, 2, 1]);
  assert.notEqual(transactionRowHash(a, occ[0]), transactionRowHash(b, occ[1]));
  // Same file again -> same hashes (rows already stored are skipped)
  const again = occurrenceNumbers([a, b, c]);
  assert.equal(transactionRowHash(a, again[0]), transactionRowHash(a, occ[0]));
});

test('transactions: chunks never split a patient and cover every row', () => {
  const rows = ['A', 'A', 'A', 'B', 'C', 'C', 'D', 'D', 'D', 'D', 'E'].map((id) => txCells({ id }));
  const chunks = chunkByPatient(rows, 3);
  assert.deepEqual(chunks, [[0, 3], [3, 6], [6, 10], [10, 11]]);
  for (const [s] of chunks.slice(1)) assert.notEqual(rows[s][18], rows[s - 1][18]);
  assert.equal(chunks.reduce((n, [s, e]) => n + e - s, 0), rows.length);
  assert.deepEqual(chunkByPatient(rows, 100), [[0, 11]]);
});

test('transactions: provider codes link to staff only when unambiguous', () => {
  const staff = [{ id: 'u1', name: 'Kumutha Daniel' }, { id: 'u2', name: 'Ike Ayanleye' }, { id: 'u3', name: 'Ivy Ayanleye' }];
  assert.equal(matchProviderCode('K.Daniel', staff), 'u1');
  assert.equal(matchProviderCode('I.Ayanleye', staff), null);
  assert.equal(matchProviderCode('Daniel', staff), null);
});

// ---------- authorizations ----------

const AUTH_HEADER = [
  'insuranceAuthorizationsDate', 'patientType', 'assignedFacility', 'assignedProvider', 'insuranceProvider', 'remainingVisitsFilter',
  'expireDateFilter', 'insuranceProviderDescription', 'patientName', 'patientId', 'birthDate', 'groupNumber', 'insuredName',
  'insuredAddress', 'insuredRelation', 'insuredPhone', 'authorizationCode', 'allowedVisits', 'remainingVisits', 'startDate',
  'expirationDate', 'expiredAuthorizationWarning', 'remainingVisitsWarning', 'futureAuthorizationWarning', 'note',
];
const auth = (o: Partial<{ id: string; code: string; allowed: string; remaining: string; start: string; end: string; expired: string; note: string }>) => [
  'Insurance Authorizations on October 17, 2026', 't', 'f', 'p', 'i', 'r', 'e', 'Maryland Public Behavioral Health System', 'SECRET NAME',
  o.id ?? 'PAT1', '01/01/1990', 'GRP-SECRET', 'INSURED-SECRET', 'ADDR-SECRET', 'None', 'PHONE-SECRET', o.code ?? '000123456789',
  o.allowed ?? '24', o.remaining ?? '10', o.start ?? '07/01/2026', o.end ?? '12/31/2026', o.expired ?? '', '', '', o.note ?? 'OMHC',
];

test('authorizations: auth number kept as text, units, over-limit, PHI columns not read', () => {
  const a = parseAuthorizationReport([AUTH_HEADER, auth({}), auth({ id: 'PAT2', code: '12- 3456- 78', remaining: '-3', allowed: '10' })]);
  assert.ok(a.ok);
  assert.equal(a.reportDate?.toISOString().slice(0, 10), '2026-10-17');
  assert.equal(a.auths[0].authNumber, '000123456789');
  assert.equal(a.auths[1].authNumber, '12- 3456- 78');
  assert.equal(a.auths[0].unitsUsed, 14);
  assert.equal(a.auths[1].unitsUsed, 13);
  assert.equal(a.auths[1].overLimit, true);
  const json = JSON.stringify(a);
  for (const s of ['SECRET NAME', 'GRP-SECRET', 'INSURED-SECRET', 'ADDR-SECRET', 'PHONE-SECRET', '1990']) assert.ok(!json.includes(s), s);
  assert.equal(importedAuthNotes('OMHC', a.reportDate), 'OMHC (imported from Valant 2026-10-17)');
});

test('authorizations: expired by flag or end date; shared auth numbers get stable ranks and keys', () => {
  const today = new Date(Date.UTC(2026, 9, 17, 15));
  assert.equal(authIsExpired({ expiredFlag: true, endDate: null }, today), true);
  assert.equal(authIsExpired({ expiredFlag: false, endDate: new Date(Date.UTC(2026, 9, 16, 12)) }, today), true);
  assert.equal(authIsExpired({ expiredFlag: false, endDate: new Date(Date.UTC(2026, 9, 17, 12)) }, today), false);
  const r1 = auth({ end: '09/30/2026', allowed: '12' });
  const r2 = auth({ end: '12/31/2026', allowed: '24' });
  const a = parseAuthorizationReport([AUTH_HEADER, r1, r2]);
  const b = parseAuthorizationReport([AUTH_HEADER, r2, r1]);
  assert.equal(a.sharedAuthKeys, 1);
  const keysA = new Map(a.auths.map((x) => [x.endDate?.toISOString(), valantAuthSubmissionKey('org1', x)]));
  const keysB = new Map(b.auths.map((x) => [x.endDate?.toISOString(), valantAuthSubmissionKey('org1', x)]));
  assert.deepEqual([...keysA].sort(), [...keysB].sort());
  assert.equal(new Set(keysA.values()).size, 2);
  assert.ok([...keysA.values()][0].startsWith('valant:'));
  assert.notEqual(valantAuthSubmissionKey('org1', a.auths[0]), valantAuthSubmissionKey('org2', a.auths[0]));
});

// ---------- claims: REF*G1 from an imported (CPT-less) auth ----------

const mapping = (aliases: string[]): PayerMappingConfig => ({
  payerName: 'Maryland Medicaid', aliases, waystarPayerId: '100198', claimFilingCode: 'MC', telehealthModifier: '95',
  requiresPriorAuth: false, verified: true, active: true,
});
const pa = (o: Partial<PriorAuthRecord>): PriorAuthRecord => ({
  authNumber: 'A1', status: 'APPROVED', payer: 'Maryland Public Behavioral Health System', cptCodes: [],
  startDate: new Date(Date.UTC(2026, 6, 1)), endDate: new Date(Date.UTC(2026, 11, 31)), unitsApproved: 24, unitsUsed: 0, ...o,
});

test('prior auth selection: empty CPT list covers any service; CPT-specific preferred; payer via alias', () => {
  const input = { payerName: 'Maryland Medicaid', payerId: '100198', serviceDate: '2026-10-01', cpts: ['90837'] };
  // Valant payer name differs from the claim payer: no match without an alias
  assert.equal(selectPriorAuth([pa({})], { ...input, mapping: mapping([]) }).auth, null);
  const m = mapping(['Maryland Public Behavioral Health System']);
  assert.equal(selectPriorAuth([pa({})], { ...input, mapping: m }).auth?.authNumber, 'A1');
  const specific = pa({ authNumber: 'CPT1', cptCodes: ['90837'], startDate: new Date(Date.UTC(2026, 0, 1)) });
  const general = pa({ authNumber: 'GEN', startDate: new Date(Date.UTC(2026, 8, 1)) });
  assert.equal(selectPriorAuth([general, specific], { ...input, mapping: m }).auth?.authNumber, 'CPT1');
  assert.equal(selectPriorAuth([general, specific], { ...input, cpts: ['99214'], mapping: m }).auth?.authNumber, 'GEN');
  assert.equal(selectPriorAuth([pa({ status: 'EXPIRED' })], { ...input, mapping: m }).auth, null);
  assert.equal(selectPriorAuth([pa({})], { ...input, serviceDate: '2027-01-02', mapping: m }).auth, null);
});

// ---------- access ----------

test('Valant Balances page: billing roles and leadership only', () => {
  for (const role of ['BILLING', 'ADMIN', 'PRACTICE_DIRECTOR', 'DIRECTOR']) {
    assert.equal(canAccessPath(role, '/dashboard/billing/valant-balances'), true, role);
  }
  // Office Manager removed 2026-10-22 (owner: patient-side billing only)
  for (const role of ['OFFICE_MANAGER', 'THERAPIST', 'FRONT_DESK', 'PEER_SUPPORT', 'CASE_MANAGER']) {
    assert.equal(canAccessPath(role, '/dashboard/billing/valant-balances'), false, role);
  }
});

test('CSV parser keeps quoted commas and line breaks', () => {
  assert.deepEqual(parseCsvText('a,b\r\n"1,448.37","x\ny"\n'), [['a', 'b'], ['1,448.37', 'x\ny']]);
});

test('copay maximum caps the picked copay; ($9,999) means no maximum', async () => {
  const { pickCopayRule, copayCapCents, formatCopayMaximum } = await import('../src/lib/migration/valantCopays');
  const rule = (amountCents: number, valantLimitCents: number | null) =>
    ({ payerName: 'Aetna', providerType: '', cptRule: '', amountCents, source: 'valant', valantLimitCents });
  const capped = pickCopayRule([rule(15000, 10000)], { payerName: 'Aetna' });
  assert.ok(capped.ok && capped.amountCents === 10000 && capped.capped);
  const under = pickCopayRule([rule(5500, 10000)], { payerName: 'Aetna' });
  assert.ok(under.ok && under.amountCents === 5500 && !under.capped);
  const none = pickCopayRule([rule(5500, -999900)], { payerName: 'Aetna' });
  assert.ok(none.ok && none.amountCents === 5500 && !none.capped);
  assert.equal(copayCapCents(-999900), null);
  assert.equal(copayCapCents(999900), null);
  assert.equal(formatCopayMaximum('($9,999)', -999900), 'No maximum');
  assert.equal(formatCopayMaximum('$100', 10000), '$100');
});
