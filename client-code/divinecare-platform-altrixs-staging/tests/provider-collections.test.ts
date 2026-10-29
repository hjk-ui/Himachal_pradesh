import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildCollectionsCsv,
  buildCollectionsReport,
  classifyCollectionCode,
  COLLECTION_CODES,
  percentOf,
  providerRef,
  PROVIDER_COLLECTIONS_PATH,
  type CollectionGroup,
  type SectionKey,
} from '../src/lib/billing/providerCollections';
import { canAccessPath } from '../src/lib/auth/roleAccess';

const EXPECTED: [string, SectionKey, string][] = [
  ['Auto Payment CC', 'payments', 'Auto Payment CC'],
  ['Cash', 'payments', 'Cash Payment'],
  ['Check', 'payments', 'Check Payment'],
  ['Credit Cd', 'payments', 'Credit Payment'],
  ['Denied 1', 'payments', 'Primary Insurance Denied'],
  ['Denied 2', 'payments', 'Secondary Insurance Denied'],
  ['Denied 3', 'payments', 'Tertiary Insurance Denied'],
  ['Ins Check 1', 'payments', 'Primary Ins Check Payment'],
  ['Ins Check 2', 'payments', 'Secondary Ins Check Payment'],
  ['Ins Check 3', 'payments', 'Tertiary Ins Check Payment'],
  ['Ins Check Partial 1', 'payments', 'Partial Primary Ins Check Payment'],
  ['Ins Check Partial 2', 'payments', 'Partial Secondary Ins Check Payment'],
  ['Ins Check Partial 3', 'payments', 'Partial Tertiary Ins Check Payment'],
  ['Ins EFT 1', 'payments', 'Primary Ins EFT Payment'],
  ['Ins EFT 2', 'payments', 'Secondary Ins EFT Payment'],
  ['Ins EFT 3', 'payments', 'Tertiary Ins EFT Payment'],
  ['Ins EFT Partial 1', 'payments', 'Partial Primary Ins EFT Payment'],
  ['Ins EFT Partial 2', 'payments', 'Partial Secondary Ins EFT Payment'],
  ['Ins EFT Partial 3', 'payments', 'Partial Tertiary Ins EFT Payment'],
  ['Ins CC 1', 'payments', 'Primary CC Ins Payment'],
  ['Pat Xfer From DOS', 'payments', 'Transfer Payment To Patient Account'],
  ['Prepay Xfer', 'payments', 'Prepayment Transfer'],
  ['Ins Chg Back', 'refunds', 'Insurance Charge Back'],
  ['Pat Refund', 'refunds', 'Patient Refund'],
  ['Pat Xfer To DOS', 'refunds', 'Transfer Payment From Patient Account'],
  ['AdjCredit', 'credit_adjustments', 'Credit Adjustment'],
  ['InsAdjust', 'credit_adjustments', 'Insurance Adjustment'],
  ['Pt Dsct', 'credit_adjustments', 'Patient Courtesy Discount'],
  ['Debt WO', 'credit_adjustments', 'Bad Debt Write Off'],
  ['AdjCharge', 'charge_adjustments', 'Charge Adjustment'],
];

test('every Valant code maps to its section and description', () => {
  assert.equal(COLLECTION_CODES.length, EXPECTED.length);
  for (const [code, section, description] of EXPECTED) {
    const c = classifyCollectionCode(code, 'other');
    assert.equal(c.kind, 'section', code);
    if (c.kind !== 'section') continue;
    assert.equal(c.section, section, code);
    assert.equal(c.description, description, code);
    assert.equal(c.code, code);
  }
});

test('codes match case-insensitively and trimmed; mapped code wins over our category', () => {
  const c = classifyCollectionCode('  ins  eft 1 ', 'insurance_payment');
  assert.ok(c.kind === 'section' && c.section === 'payments' && c.code === 'Ins EFT 1');
  // Ins Chg Back is an insurance_adjustment in our import but a Refund in Valant's report
  const r = classifyCollectionCode('INS CHG BACK', 'insurance_adjustment');
  assert.ok(r.kind === 'section' && r.section === 'refunds');
  const d = classifyCollectionCode('denied 2', 'insurance_adjustment');
  assert.ok(d.kind === 'section' && d.section === 'payments');
});

test('charges and fee/admin codes are excluded; unknown codes go to Other with the raw code', () => {
  assert.deepEqual(classifyCollectionCode('99214T', 'charge'), { kind: 'excluded', reason: 'charge' });
  for (const code of ['Cancelled', 'NSH - Thrpy', 'NSHInt', 'NSHDoc', 'RESCHEDULED', '0000']) {
    assert.deepEqual(classifyCollectionCode(code, 'other'), { kind: 'excluded', reason: 'fee' }, code);
  }
  const o = classifyCollectionCode(' Mystery  Code ', 'other');
  assert.ok(o.kind === 'section' && o.section === 'other' && o.code === 'Mystery Code');
});

test('provider label: staff name, else Valant provider code, else Unassigned', () => {
  const staff = new Map([['u1', 'Kim Daniel']]);
  assert.deepEqual(providerRef({ providerCode: 'K.Daniel', providerUserId: 'u1' }, staff), { key: 'u:u1', label: 'Kim Daniel', matchedStaff: true });
  assert.deepEqual(providerRef({ providerCode: 'K.Daniel', providerUserId: 'u9' }, staff), { key: 'u:u9', label: 'K.Daniel', matchedStaff: true });
  assert.deepEqual(providerRef({ providerCode: ' J.Smith ', providerUserId: null }, staff), { key: 'c:j.smith', label: 'J.Smith', matchedStaff: false });
  assert.deepEqual(providerRef({ providerCode: null, providerUserId: null }, staff), { key: 'none', label: 'Unassigned', matchedStaff: false });
  assert.deepEqual(providerRef({ providerCode: '  ', providerUserId: null }, staff), { key: 'none', label: 'Unassigned', matchedStaff: false });
});

test('percentOf: share of a whole, null on a zero whole', () => {
  assert.equal(percentOf(25, 100), 25);
  assert.equal(percentOf(1, 3)?.toFixed(4), '33.3333');
  assert.equal(percentOf(5, 0), null);
});

const g = (providerCode: string | null, providerUserId: string | null, code: string, cents: number, count = 1, category = 'other'): CollectionGroup => ({
  providerCode, providerUserId, code, category, cents, count,
});

/** Shaped like the staging import: refunds and charge adjustments use the reconciled staging totals */
const FIXTURE: CollectionGroup[] = [
  g('K.Daniel', 'u1', 'Ins EFT 1', -100000, 10, 'insurance_payment'),
  g('K.Daniel', 'u1', 'ins eft 1', -50000, 5, 'insurance_payment'), // case variant merges
  g('K.Daniel', 'u1', 'Cash', -25000, 2, 'patient_payment'),
  g('J.Smith', null, 'Ins Check 2', -75000, 3, 'insurance_payment'),
  g('J.Smith', null, 'Denied 1', 0, 4, 'insurance_adjustment'),
  g(null, null, 'Prepay Xfer', -10000, 1, 'transfer'),
  g('K.Daniel', 'u1', 'Ins Chg Back', 1279071, 20, 'insurance_adjustment'),
  g('J.Smith', null, 'Pat Refund', 90279, 3, 'patient_payment'),
  g('K.Daniel', 'u1', 'Pat Xfer To DOS', 1570605, 40, 'transfer'),
  g('K.Daniel', 'u1', 'InsAdjust', -300000, 30, 'insurance_adjustment'),
  g('J.Smith', null, 'Debt WO', -20000, 1, 'patient_adjustment'),
  g('J.Smith', null, 'AdjCredit', 5000, 1, 'patient_adjustment'), // nets opposite: shows negative
  g('J.Smith', null, 'AdjCharge', 9500, 1, 'patient_adjustment'),
  g('K.Daniel', 'u1', '99214T', 2500000, 100, 'charge'),
  g('K.Daniel', 'u1', 'NSHInt', 7500, 1, 'fee'),
  g('K.Daniel', 'u1', '0000', 0, 1, 'other'),
  g('J.Smith', null, 'Weird Code', -1234, 2, 'other'),
];
const STAFF = new Map([['u1', 'Kim Daniel']]);

test('report on the fixture: sections, signs, provider subtotals, percentages, totals', () => {
  const r = buildCollectionsReport(FIXTURE, STAFF);
  const sec = (k: SectionKey) => r.sections.find((s) => s.key === k)!;
  assert.deepEqual(r.sections.map((s) => s.key), ['payments', 'refunds', 'credit_adjustments', 'charge_adjustments', 'other']);

  // Payments: 1500 + 250 + 750 + 0 + 100 = 2,600.00, shown positive
  assert.equal(sec('payments').cents, 260000);
  const kim = sec('payments').providers[0];
  assert.equal(kim.label, 'Kim Daniel');
  assert.deepEqual(kim.valantCodes, ['K.Daniel']);
  assert.deepEqual(kim.rows.map((x) => [x.code, x.cents, x.count]), [['Cash', 25000, 2], ['Ins EFT 1', 150000, 15]]);
  assert.equal(kim.cents, 175000);
  assert.equal(kim.pctOfSection?.toFixed(2), '67.31');
  assert.equal(kim.rows[1].pctOfSection?.toFixed(2), '57.69');
  assert.deepEqual(sec('payments').providers.map((p) => p.label), ['Kim Daniel', 'J.Smith', 'Unassigned']);
  const smith = sec('payments').providers[1];
  assert.deepEqual(smith.rows.map((x) => x.code), ['Denied 1', 'Ins Check 2']);

  // Refunds reconcile to staging's $29,399.55
  assert.equal(sec('refunds').cents, 2939955);
  // Credit adjustments: 3000 + 200 - 50 (AdjCredit nets a debit -> negative row)
  assert.equal(sec('credit_adjustments').cents, 315000);
  const smithCredit = sec('credit_adjustments').providers.find((p) => p.label === 'J.Smith')!;
  assert.deepEqual(smithCredit.rows.map((x) => [x.code, x.cents]), [['AdjCredit', -5000], ['Debt WO', 20000]]);
  assert.equal(sec('charge_adjustments').cents, 9500);
  // Other keeps the stored sign and the raw code
  assert.deepEqual(sec('other').providers[0].rows.map((x) => [x.code, x.cents]), [['Weird Code', -1234]]);
  assert.deepEqual(r.unmappedCodes, [{ code: 'Weird Code', count: 2, cents: -1234 }]);

  assert.deepEqual(r.summary, {
    paymentsCents: 260000, refundsCents: 2939955, creditAdjustmentsCents: 315000, chargeAdjustmentsCents: 9500,
    otherCents: -1234, netCollectionsCents: 260000 - 2939955,
  });
  assert.deepEqual(r.excluded, { chargeRows: 100, chargeCents: 2500000, feeRows: 2, feeCents: 7500 });
  for (const s of r.sections) {
    const pct = s.providers.reduce((t, p) => t + (p.pctOfSection ?? 0), 0);
    assert.ok(Math.abs(pct - 100) < 1e-9, s.key);
  }
});

test('provider and section filters; empty sections stay empty', () => {
  const r = buildCollectionsReport(FIXTURE, STAFF, { provider: 'c:j.smith' });
  assert.ok(r.sections.every((s) => s.providers.every((p) => p.label === 'J.Smith')));
  assert.equal(r.summary.refundsCents, 90279);
  assert.equal(r.sections.find((s) => s.key === 'refunds')!.providers[0].pctOfSection, 100);
  assert.equal(r.providers.length, 3, 'filter list keeps every provider');
  const only = buildCollectionsReport(FIXTURE, STAFF, { section: 'refunds' });
  assert.deepEqual(only.sections.map((s) => s.key), ['refunds']);
  assert.equal(only.summary.paymentsCents, 260000, 'KPIs still cover every section');
  const empty = buildCollectionsReport([], STAFF);
  assert.ok(empty.sections.every((s) => s.providers.length === 0 && s.cents === 0));
  assert.equal(empty.summary.netCollectionsCents, 0);
});

test('CSV follows the report layout', () => {
  const csv = buildCollectionsCsv(buildCollectionsReport(FIXTURE, STAFF), { from: '2026-01-01', to: '2026-10-17', organizationName: 'Divine Counseling' });
  assert.match(csv, /Section,Provider,Code,Description,Transactions,Amount,% of section/);
  assert.match(csv, /Refunds,Kim Daniel,Ins Chg Back,Insurance Charge Back,20,12790\.71,/);
  assert.match(csv, /Refunds total,,,,63,29399\.55,100\.00%/);
  assert.match(csv, /Payments,Kim Daniel subtotal,,,17,1750\.00,67\.31%/);
  assert.match(csv, /Unmapped codes \(in Other\),Weird Code/);
  assert.match(csv, /date of service/i);
});

test('Provider Collections: same roles as Valant Balances; nav and route exist; route is audited', () => {
  for (const role of ['BILLING', 'ADMIN', 'PRACTICE_DIRECTOR', 'DIRECTOR']) {
    assert.equal(canAccessPath(role, PROVIDER_COLLECTIONS_PATH), true, role);
  }
  // Office Manager removed 2026-10-22 (owner: patient-side billing only)
  for (const role of ['OFFICE_MANAGER', 'THERAPIST', 'FRONT_DESK', 'PEER_SUPPORT', 'CASE_MANAGER']) {
    assert.equal(canAccessPath(role, PROVIDER_COLLECTIONS_PATH), false, role);
  }
  const root = path.join(__dirname, '..', 'src');
  // Sidebar links live in navConfig.ts (DashboardShell renders them).
  const shell = fs.readFileSync(path.join(root, 'components', 'layout', 'navConfig.ts'), 'utf8');
  assert.match(shell, /href: '\/dashboard\/billing\/provider-collections'/);
  const route = fs.readFileSync(path.join(root, 'app', 'api', 'billing', 'provider-collections', 'route.ts'), 'utf8');
  assert.match(route, /auditPhiAccess/);
  assert.match(route, /groupBy\(/);
  assert.match(route, /organizationId: orgId/);
});
