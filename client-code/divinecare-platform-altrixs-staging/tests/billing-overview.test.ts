import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  canViewBillingOverview,
  choosePayerMix,
  countVisits,
  cptUsage,
  overviewCsv,
  parseOverviewRange,
  summarizeAltrixsClaims,
  summarizeAltrixsPayments,
  trailingMonths,
  valantKpis,
  valantPayerMix,
  valantTrend,
  NO_ALTRIXS_CLAIMS_NOTE,
  NO_FAMILY_PRACTICE_NOTE,
  BILLING_OVERVIEW_PATH,
  MEDICAL_BILLING_PATH,
} from '../src/lib/billing/overviewValant';
import { NO_PAYER } from '../src/lib/reports/outcomesReports';
import { canAccessPath } from '../src/lib/auth/roleAccess';

const ROOT = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// Valant stores payments / credits negative
const GROUPS = [
  { category: 'charge', cents: 100_000, count: 6 },
  { category: 'insurance_payment', cents: -50_000, count: 3 },
  { category: 'patient_payment', cents: -12_000, count: 2 },
  // patient refund (positive) nets against patient payments
  { category: 'patient_payment', cents: 2_000, count: 1 },
  { category: 'insurance_adjustment', cents: -20_000, count: 3 },
  { category: 'patient_adjustment', cents: -1_000, count: 1 },
  { category: 'fee', cents: 5_000, count: 1 },
  { category: 'transfer', cents: -3_000, count: 1 },
];

test('KPIs: signs, net collections, collection rate, average per visit', () => {
  const k = valantKpis(GROUPS, 4);
  assert.equal(k.chargesCents, 100_000);
  assert.equal(k.insurancePaymentsCents, 50_000);
  assert.equal(k.patientPaymentsCents, 10_000);
  assert.equal(k.adjustmentsCents, 21_000);
  assert.equal(k.netCollectionsCents, 60_000);
  assert.deepEqual(k.collectionRate, { numerator: 60_000, denominator: 100_000, pct: 60 });
  assert.equal(k.feesCents, 5_000, 'fees kept out of charges');
  assert.equal(k.otherCents, -3_000, 'transfers kept out of payments');
  assert.equal(k.visitsBilled, 4);
  assert.equal(k.avgChargePerVisitCents, 25_000);
});

test('KPIs with no data are null, not 0', () => {
  const k = valantKpis([], 0);
  assert.equal(k.collectionRate.pct, null);
  assert.equal(k.avgChargePerVisitCents, null);
  assert.equal(k.netCollectionsCents, 0);
});

test('visits = distinct patient + date of service', () => {
  const d = new Date('2026-10-02T12:00:00Z');
  assert.equal(
    countVisits([
      { valantPatientId: 'A1', serviceDate: d },
      { valantPatientId: 'A1', serviceDate: new Date('2026-10-02T12:00:00Z') },
      { valantPatientId: 'A1', serviceDate: new Date('2026-10-03T12:00:00Z') },
      { valantPatientId: 'B2', serviceDate: d },
      { valantPatientId: 'C3', serviceDate: null },
    ]),
    3
  );
});

test('payer mix credits the first payer of a multi-payer insurance cell', () => {
  const mix = valantPayerMix([
    { insurance: 'NOVITAS SOLUTIONS PART B, Maryland Public Behavioral Health System', category: 'charge', cents: 30_000, count: 2 },
    { insurance: 'NOVITAS SOLUTIONS PART B', category: 'insurance_payment', cents: -10_000, count: 1 },
    { insurance: 'Maryland Public Behavioral Health System', category: 'charge', cents: 20_000, count: 1 },
    { insurance: null, category: 'charge', cents: 5_000, count: 1 },
    { insurance: null, category: 'patient_payment', cents: -5_000, count: 1 },
  ]);
  assert.equal(mix.rowsInRange, 6);
  assert.equal(mix.rowsWithInsurance, 4);
  assert.deepEqual(mix.topByCharges.map((r) => [r.payer, r.chargesCents]), [
    ['NOVITAS SOLUTIONS PART B', 30_000],
    ['Maryland Public Behavioral Health System', 20_000],
    [NO_PAYER, 5_000],
  ]);
  assert.deepEqual(mix.topByPayments.map((r) => [r.payer, r.paymentsCents]), [
    ['NOVITAS SOLUTIONS PART B', 10_000],
    [NO_PAYER, 5_000],
  ]);
  const chosen = choosePayerMix({ valant: mix, insuranceAging: [{ payerName: 'X', totalCents: 1 }], clientInsurance: [] });
  assert.equal(chosen.source, 'valant_journal');
});

test('payer mix falls back to insurance aging, then chart insurance, and says so', () => {
  const noJournal = valantPayerMix([{ insurance: null, category: 'charge', cents: 1_000, count: 1 }]);
  const aging = choosePayerMix({
    valant: noJournal,
    insuranceAging: [
      { payerName: 'CareFirst', totalCents: 500 },
      { payerName: 'CareFirst ', totalCents: 250 },
      { payerName: 'Aetna', totalCents: 900 },
    ],
    clientInsurance: [],
  });
  assert.equal(aging.source, 'insurance_aging');
  assert.deepEqual(aging.fallback, [
    { payer: 'Aetna', cents: 900, clients: null },
    { payer: 'CareFirst', cents: 750, clients: null },
  ]);
  assert.equal(aging.topByCharges.length, 0);
  const chart = choosePayerMix({ valant: noJournal, insuranceAging: null, clientInsurance: [{ payer: 'Aetna', clients: 3 }] });
  assert.equal(chart.source, 'client_insurance');
  assert.match(chart.sourceNote, /no dollar amounts/);
  assert.equal(choosePayerMix({ valant: noJournal, insuranceAging: [], clientInsurance: [] }).source, 'none');
});

test('trend: 12 months ending with the range month, empty months are 0', () => {
  const months = trailingMonths('2026-10-17');
  assert.equal(months.length, 12);
  assert.equal(months[0], '2025-11');
  assert.equal(months[11], '2026-10');
  const t = valantTrend(
    [
      { serviceDate: new Date('2026-09-03T12:00:00Z'), category: 'charge', cents: 10_000, count: 1 },
      { serviceDate: new Date('2026-09-20T12:00:00Z'), category: 'insurance_payment', cents: -4_000, count: 1 },
      { serviceDate: new Date('2026-10-01T12:00:00Z'), category: 'patient_payment', cents: -1_000, count: 1 },
    ],
    months
  );
  const sep = t.find((p) => p.month === '2026-09')!;
  assert.equal(sep.chargesCents, 10_000);
  assert.equal(sep.paymentsCents, 4_000);
  assert.equal(t.find((p) => p.month === '2026-10')!.paymentsCents, 1_000);
  assert.equal(t.find((p) => p.month === '2026-01')!.chargesCents, 0);
});

test('CPT usage prices exact Valant codes from the fee schedule, never a default rate', () => {
  const rows = cptUsage(
    [
      { code: '90837', codeBase: '90837', cents: 36_000, lines: 2 },
      { code: '90837T', codeBase: '90837', cents: 18_000, lines: 1 },
      { code: '99214', codeBase: '99214', cents: 20_000, lines: 1 },
    ],
    [
      { code: '90837', feeCents: 18_000, active: true, description: 'Psychotherapy 60 min' },
      { code: '90837T', feeCents: 17_500, active: true },
      { code: '99214', feeCents: 1, active: false },
    ]
  );
  const p = rows.find((r) => r.codeBase === '90837')!;
  assert.equal(p.lines, 3);
  assert.equal(p.chargesCents, 54_000);
  assert.equal(p.expectedCents, 2 * 18_000 + 17_500);
  assert.equal(p.unpricedLines, 0);
  assert.deepEqual(p.codes, ['90837', '90837T']);
  assert.equal(p.description, 'Psychotherapy 60 min');
  const e = rows.find((r) => r.codeBase === '99214')!;
  assert.equal(e.expectedCents, null, 'inactive fee item is not used');
  assert.equal(e.unpricedLines, 1);
});

test('empty Altrixs state: zeros with the go-live note text', () => {
  const c = summarizeAltrixsClaims([]);
  assert.deepEqual(c, { total: 0, submitted: 0, pending: 0, paid: 0, denied: 0, billedCents: 0, paidCents: 0 });
  assert.match(NO_ALTRIXS_CLAIMS_NOTE, /No Altrixs claims yet — claims start after go-live/);
  assert.match(NO_FAMILY_PRACTICE_NOTE, /Transaction Journal/);
  const s = summarizeAltrixsClaims([
    { status: 'DRAFT', count: 1, amountCents: 100, paidAmount: null },
    { status: 'SUBMITTED', count: 2, amountCents: 300, paidAmount: null },
    { status: 'PAID', count: 1, amountCents: 200, paidAmount: 1.5 },
    { status: 'DENIED', count: 1, amountCents: 50, paidAmount: null },
  ]);
  assert.equal(s.submitted, 4);
  assert.equal(s.pending, 3);
  assert.equal(s.billedCents, 550);
  assert.equal(s.paidCents, 150);
  const pay = summarizeAltrixsPayments([
    { method: 'INSURANCE', count: 1, cents: 1000 },
    { method: 'CARD', count: 2, cents: 500 },
    { method: 'STUB', count: 9, cents: 99_999 },
  ]);
  assert.deepEqual(pay, { count: 3, insuranceCents: 1000, patientCents: 500, totalCents: 1500 });
});

test('range: default month to date, 90-day preset, custom, validation', () => {
  const now = new Date('2026-10-17T15:00:00Z');
  const mtd = parseOverviewRange(new URLSearchParams(), now);
  assert.ok('range' in mtd);
  assert.equal(mtd.range.preset, 'mtd');
  assert.equal(mtd.range.fromDate, '2026-10-01');
  assert.equal(mtd.range.toDate, '2026-10-17');
  assert.equal(mtd.range.valantFrom.toISOString(), '2026-10-01T00:00:00.000Z');
  assert.equal(mtd.range.valantToExclusive.toISOString(), '2026-10-18T00:00:00.000Z');
  const d90 = parseOverviewRange(new URLSearchParams('preset=90d'), now);
  assert.ok('range' in d90);
  assert.equal(d90.range.fromDate, '2026-07-20');
  const custom = parseOverviewRange(new URLSearchParams('from=2026-01-01&to=2026-03-31'), now);
  assert.ok('range' in custom);
  assert.equal(custom.range.preset, 'custom');
  assert.ok('error' in parseOverviewRange(new URLSearchParams('from=2026-02-30'), now));
  assert.ok('error' in parseOverviewRange(new URLSearchParams('from=2026-05-01&to=2026-04-01'), now));
  assert.ok('error' in parseOverviewRange(new URLSearchParams('preset=year'), now));
});

test('role gate matches the /dashboard/billing page rule (PRACTICE_DIRECTOR allowed; OFFICE_MANAGER not since 2026-10-22)', () => {
  for (const role of ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'BILLING']) {
    assert.equal(canViewBillingOverview(role), true, role);
    assert.equal(canViewBillingOverview(role), canAccessPath(role, BILLING_OVERVIEW_PATH));
  }
  for (const role of ['OFFICE_MANAGER', 'THERAPIST', 'FRONT_DESK', 'PEER_SUPPORT', 'client']) assert.equal(canViewBillingOverview(role), false, role);
  const route = read('src/app/api/billing/overview/route.ts');
  assert.match(route, /canViewBillingOverview\(gate\.role\)/);
  assert.doesNotMatch(route, /gate\.role !== 'ADMIN'/);
  assert.match(route, /auditPhiAccess/);
  assert.match(route, /'EXPORT'/);
});

test('medical billing summary keeps the medical billing page rule and uses the facility, not CPT', () => {
  assert.equal(canAccessPath('BILLING', MEDICAL_BILLING_PATH), true);
  const route = read('src/app/api/medical/billing/summary/route.ts');
  assert.match(route, /canAccessPath\(gate\.role, MEDICAL_BILLING_PATH\)/);
  assert.match(route, /auditPhiAccess/);
  const lib = read('src/lib/medical/billingSummary.ts');
  assert.match(lib, /FAMILY_PRACTICE_FACILITY/);
  assert.doesNotMatch(lib, /codeBase\s*:|\bcode\s*:\s*\{/, 'primary care is never picked by CPT');
});

test('overview never imports demo CPT rates', () => {
  for (const f of ['src/lib/billing/overview.ts', 'src/lib/billing/overviewValant.ts']) {
    assert.doesNotMatch(read(f), /billingHubData|constants\/cpt/, f);
  }
});

test('CSV export has source and range headers', () => {
  const csv = overviewCsv(
    'trend',
    { trend: valantTrend([], ['2026-10']), payerMix: choosePayerMix({ valant: valantPayerMix([]), insuranceAging: null, clientInsurance: [] }), cpt: [] },
    { title: 'Billing overview', source: 'Valant (imported)', fromDate: '2026-10-01', toDate: '2026-10-17' }
  );
  assert.match(csv, /Source: Valant \(imported\)/);
  assert.match(csv, /2026-10,0\.00,0\.00,0\.00,0\.00,0\.00/);
});
