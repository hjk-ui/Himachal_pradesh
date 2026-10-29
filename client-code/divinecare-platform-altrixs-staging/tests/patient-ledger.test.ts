import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  REPLACE_WARNING,
  VALANT_SOURCE,
  applyPostingWrites,
  autopayChargeCents,
  canPostValantLedger,
  claimPatientPortionCents,
  computePatientBalance,
  isSelfPayPayer,
  planOpeningBalances,
  planPrepaymentCredits,
  postingWrites,
  statementLineText,
  unpostWrites,
  type LedgerEntryLite,
  type PostingPlan,
  type ValantPostedKind,
} from '../src/lib/billing/patientLedgerMath';
import { canMutateLedger } from '../src/lib/billing/ledger';
import { canViewValantBalances } from '../src/lib/billing/valantBalances';

type Row = LedgerEntryLite & { supersededById: string | null };

let seq = 0;
const newId = () => `e${++seq}`;
const active = (rows: Row[], kind?: string) => rows.filter((r) => r.supersededAt == null && (!kind || r.kind === kind));
const sum = (rows: Row[]) => rows.reduce((s, r) => s + r.amountCents, 0);

/** Same steps as postOpeningBalances / postPrepaymentCredits, against an in-memory table */
function post(rows: Row[], plan: PostingPlan, kind: ValantPostedKind, asOf: string): Row[] {
  const write = postingWrites(plan, newId);
  return applyPostingWrites(rows, write, kind, asOf, new Date('2026-10-17T15:00:00Z'), (r) => r);
}

const AGING_A = [
  { clientId: 'c1', valantPatientId: 'V1', totalCents: 12_500 },
  { clientId: 'c2', valantPatientId: 'V2', totalCents: -4_000 },
  { clientId: null, valantPatientId: 'V9', totalCents: 7_700 },
  { clientId: 'c3', valantPatientId: 'V3', totalCents: 0 },
];

// ---------------------------------------------------------------------------------------------

test('opening balances: one entry per matched client, sign kept, unmatched listed not posted, reconciles', () => {
  const plan = planOpeningBalances(AGING_A, '2026-10-16', []);
  assert.deepEqual(plan.postings.map((p) => [p.clientId, p.amountCents]), [['c1', 12_500], ['c2', -4_000]]);
  assert.deepEqual(plan.unmatched, [{ valantPatientId: 'V9', totalCents: 7_700 }]);
  assert.deepEqual(plan.zero, ['c3']);
  assert.equal(plan.reconciliation.snapshotTotalCents, 16_200);
  assert.equal(plan.reconciliation.matchedTotalCents, 8_500);
  assert.equal(plan.reconciliation.unmatchedTotalCents, 7_700);
  assert.equal(plan.totals.postCents, plan.reconciliation.matchedTotalCents);
  assert.equal(plan.reconciliation.reconciles, true);
  assert.equal(plan.counts.post, 2);
  assert.equal(plan.counts.replace, 0);
  assert.equal(plan.counts.excluded, 1);
});

test('opening balances: two Valant IDs matched to one client are added together', () => {
  const plan = planOpeningBalances(
    [
      { clientId: 'c1', valantPatientId: 'V1', totalCents: 1_000 },
      { clientId: 'c1', valantPatientId: 'V1b', totalCents: 250 },
    ],
    '2026-10-16',
    []
  );
  assert.equal(plan.postings.length, 1);
  assert.equal(plan.postings[0].amountCents, 1_250);
  assert.equal(plan.reconciliation.reconciles, true);
});

test('re-posting REPLACES, never adds: one active entry per client, totals equal the new snapshot', () => {
  let rows: Row[] = [];
  rows = post(rows, planOpeningBalances(AGING_A, '2026-10-16', rows), 'opening_balance', '2026-10-16');
  assert.equal(active(rows).length, 2);
  assert.equal(sum(active(rows)), 8_500);

  // Re-post the SAME snapshot: still 2 active, same total (no double counting), history kept
  const again = planOpeningBalances(AGING_A, '2026-10-16', rows);
  assert.equal(again.counts.replace, 2);
  assert.equal(again.counts.unchanged, 2);
  assert.equal(again.totals.changeCents, 0);
  assert.equal(again.diffs.length, 0);
  rows = post(rows, again, 'opening_balance', '2026-10-16');
  assert.equal(active(rows).length, 2);
  assert.equal(sum(active(rows)), 8_500);
  assert.equal(rows.length, 4);

  // Final numbers at cutover: c1 changes, c2 drops out (paid off in Valant), c4 is new
  const final = [
    { clientId: 'c1', valantPatientId: 'V1', totalCents: 9_900 },
    { clientId: 'c4', valantPatientId: 'V4', totalCents: 3_000 },
  ];
  const cut = planOpeningBalances(final, '2026-11-08', rows);
  assert.equal(cut.counts.replace, 1);
  assert.equal(cut.counts.added, 1);
  assert.equal(cut.counts.removed, 1);
  assert.deepEqual(
    cut.diffs.map((d) => [d.clientId, d.beforeCents, d.afterCents]).sort(),
    [['c1', 12_500, 9_900], ['c2', -4_000, null], ['c4', null, 3_000]].sort()
  );
  rows = post(rows, cut, 'opening_balance', '2026-11-08');
  const live = active(rows);
  assert.deepEqual(live.map((r) => [r.clientId, r.amountCents]).sort(), [['c1', 9_900], ['c4', 3_000]]);
  assert.equal(sum(live), 12_900);
  for (const k of ['c1', 'c4']) assert.equal(live.filter((r) => r.clientId === k).length, 1);

  // Replaced rows point at their replacement; the dropped client's row is superseded with no replacement
  const oldC1 = rows.filter((r) => r.clientId === 'c1' && r.supersededAt != null);
  assert.ok(oldC1.every((r) => r.supersededById && rows.some((x) => x.id === r.supersededById)));
  const oldC2 = rows.filter((r) => r.clientId === 'c2');
  assert.ok(oldC2.every((r) => r.supersededAt != null));
  assert.equal(oldC2.at(-1)?.supersededById, null);
  // Nothing is ever deleted
  assert.equal(rows.length, 6);
});

test('posting one kind never touches the other kind', () => {
  let rows: Row[] = [];
  rows = post(rows, planOpeningBalances(AGING_A, '2026-10-16', rows), 'opening_balance', '2026-10-16');
  const pre = planPrepaymentCredits(
    [{ clientId: 'c1', valantName: 'A', date: '2026-03-01', amountCents: 5_000, periodStart: '2026-01-01' }],
    { periodStart: '2026-01-01', periodEnd: '2026-10-16' },
    rows
  );
  assert.equal(pre.supersede.length, 0);
  rows = post(rows, pre, 'prepayment_credit', '2026-10-16');
  assert.equal(active(rows, 'opening_balance').length, 2);
  assert.equal(active(rows, 'prepayment_credit').length, 1);
  assert.equal(active(rows, 'prepayment_credit')[0].amountCents, -5_000);
});

test('unpost: supersedes every active Valant entry (or one kind), no replacement, history kept', () => {
  let rows: Row[] = [];
  rows = post(rows, planOpeningBalances(AGING_A, '2026-10-16', rows), 'opening_balance', '2026-10-16');
  rows = post(
    rows,
    planPrepaymentCredits(
      [{ clientId: 'c2', valantName: 'B', date: '2026-02-01', amountCents: 2_000, periodStart: '2026-01-01' }],
      { periodStart: '2026-01-01', periodEnd: '2026-10-16' },
      rows
    ),
    'prepayment_credit',
    '2026-10-16'
  );
  const onlyPrepay = unpostWrites(rows, 'prepayment_credit');
  assert.equal(onlyPrepay.supersede.length, 1);
  const all = unpostWrites(rows);
  assert.equal(all.supersede.length, 3);
  assert.ok(all.supersede.every((s) => s.replacedById === null));
  assert.equal(all.insert.length, 0);
  rows = applyPostingWrites(rows, all, 'opening_balance', '2026-10-16', new Date(), (r) => r);
  assert.equal(active(rows).length, 0);
  assert.equal(rows.length, 3);
  // A second unpost is a no-op
  assert.equal(unpostWrites(rows).supersede.length, 0);
  // Re-posting after unpost adds back exactly one per client
  rows = post(rows, planOpeningBalances(AGING_A, '2026-10-16', rows), 'opening_balance', '2026-10-16');
  assert.equal(active(rows).length, 2);
});

test('manual or non-Valant entries are not superseded by a Valant posting', () => {
  const rows: Row[] = [
    { id: 'm1', clientId: 'c1', kind: 'manual_adjustment', source: 'altrixs', amountCents: -500, asOf: '2026-10-01', supersededAt: null, supersededById: null },
  ];
  const plan = planOpeningBalances(AGING_A, '2026-10-16', rows);
  assert.equal(plan.supersede.length, 0);
  assert.equal(unpostWrites(rows).supersede.length, 0);
});

// ---------------------------------------------------------------------------------------------

test('prepayment credits: positive complete net posts as -net; negative, pre-period, zero and unmatched are excluded with reasons', () => {
  const period = { periodStart: '2026-01-01', periodEnd: '2026-10-16' };
  const t = (clientId: string | null, valantName: string, date: string, amountCents: number) => ({ clientId, valantName, date, amountCents, periodStart: '2026-01-01' });
  const plan = planPrepaymentCredits(
    [
      t('ok', 'Ok Patient', '2026-02-01', 10_000),
      t('ok', 'Ok Patient', '2026-03-01', -2_500),
      t('neg', 'Neg Patient', '2026-02-01', 1_000),
      t('neg', 'Neg Patient', '2026-04-01', -3_000),
      // applied before any receipt in the period, then a larger receipt: net positive but incomplete
      t('pre', 'Pre Patient', '2026-01-05', -2_000),
      t('pre', 'Pre Patient', '2026-05-01', 5_000),
      t('zero', 'Zero Patient', '2026-02-01', 1_500),
      t('zero', 'Zero Patient', '2026-02-02', -1_500),
      t(null, 'Unknown Person', '2026-02-01', 4_000),
      // same-day receipt and transfer is fine (receipt first)
      t('same', 'Same Day', '2026-06-01', -700),
      t('same', 'Same Day', '2026-06-01', 1_000),
    ],
    period,
    []
  );
  assert.deepEqual(plan.postings.map((p) => [p.clientId, p.amountCents]), [['ok', -7_500], ['same', -300]]);
  const reasons = Object.fromEntries(plan.excluded.map((e) => [e.clientId ?? e.valantName, e.reason]));
  assert.deepEqual(reasons, { neg: 'negative_net', pre: 'pre_period', zero: 'zero_net', 'Unknown Person': 'unmatched' });
  assert.equal(plan.counts.excluded, 4);
  // Reconciliation: posted patients' net + excluded net = all rows
  assert.equal(plan.reconciliation.allRowsNetCents, 10_000 - 2_500 + 1_000 - 3_000 - 2_000 + 5_000 + 0 + 4_000 + 300);
  assert.equal(plan.reconciliation.postedNetCents, 7_800);
  assert.equal(plan.reconciliation.reconciles, true);
  assert.equal(plan.asOf, '2026-10-16');
});

test('prepayment credits: a transaction dated before the period start makes the client incomplete', () => {
  const plan = planPrepaymentCredits(
    [{ clientId: 'x', valantName: 'X', date: '2025-12-30', amountCents: 5_000, periodStart: '2026-01-01' }],
    { periodStart: '2026-01-01', periodEnd: '2026-10-16' },
    []
  );
  assert.equal(plan.postings.length, 0);
  assert.equal(plan.excluded[0].reason, 'pre_period');
});

// ---------------------------------------------------------------------------------------------

test('balance = opening balance + prepayment credit + claims patient responsibility - patient payments', () => {
  const entries: LedgerEntryLite[] = [
    { id: '1', clientId: 'c', kind: 'opening_balance', source: VALANT_SOURCE, amountCents: 20_000, asOf: '2026-10-16', supersededAt: null },
    { id: '0', clientId: 'c', kind: 'opening_balance', source: VALANT_SOURCE, amountCents: 99_999, asOf: '2026-10-01', supersededAt: '2026-10-16' },
    { id: '2', clientId: 'c', kind: 'prepayment_credit', source: VALANT_SOURCE, amountCents: -5_000, asOf: '2026-10-16', supersededAt: null },
  ];
  const claims = [
    { id: 'k1', status: 'PAID', payer: 'Aetna', amountCents: 15_000, patientResponsibility: 30 }, // ERA: $30 patient
    { id: 'k2', status: 'SUBMITTED', payer: 'Aetna', amountCents: 15_000, patientResponsibility: null }, // insurance A/R, not patient
    { id: 'k3', status: 'READY', payer: 'Self-Pay', amountCents: 12_000, patientResponsibility: null }, // self-pay, billed
    { id: 'k4', status: 'DRAFT', payer: null, amountCents: 9_000, patientResponsibility: null }, // draft ignored
    { id: 'k5', status: 'SUBMITTED', payer: 'Aetna', amountCents: 1_000, patientResponsibility: 10, frequencyCode: '8' }, // void
  ];
  const payments = [
    { amountCents: 4_000, method: 'CARD', claimId: null }, // against the opening balance
    { amountCents: 1_000, method: 'CASH', claimId: 'k1' },
    { amountCents: 12_000, method: 'INSURANCE', claimId: 'k1' }, // insurance never reduces patient balance
  ];
  const b = computePatientBalance({ entries, claims, payments });
  assert.equal(b.openingBalanceCents, 20_000);
  assert.equal(b.openingBalanceAsOf, '2026-10-16');
  assert.equal(b.prepaymentCreditCents, -5_000);
  assert.equal(b.claimsPatientCents, 3_000 + 12_000);
  assert.equal(b.claimCount, 2);
  assert.equal(b.patientPaymentsCents, 5_000);
  assert.equal(b.paymentCount, 2);
  assert.equal(b.balanceCents, 20_000 - 5_000 + 15_000 - 5_000);
});

test('balance: credit on account is negative; primary billed on to a secondary is not counted twice', () => {
  const b = computePatientBalance({
    entries: [{ id: '1', clientId: 'c', kind: 'opening_balance', source: VALANT_SOURCE, amountCents: -2_500, asOf: '2026-10-16', supersededAt: null }],
    claims: [
      { id: 'p', status: 'PAID', payer: 'BCBS', amountCents: 20_000, patientResponsibility: 40 },
      { id: 's', status: 'PAID', payer: 'Medicaid', amountCents: 4_000, patientResponsibility: 0 },
    ],
    payments: [],
    billedOnToSecondary: new Set(['p']),
  });
  assert.equal(b.claimsPatientCents, 0);
  assert.equal(b.balanceCents, -2_500);
  assert.equal(claimPatientPortionCents({ id: 'p', status: 'PAID', payer: 'BCBS', amountCents: 20_000, patientResponsibility: 40 }), 4_000);
  assert.equal(isSelfPayPayer(''), true);
  assert.equal(isSelfPayPayer('Sliding Scale / Reduced Fee'), true);
  assert.equal(isSelfPayPayer('Aetna'), false);
});

test('autopay "Balance or $X" charges the lower; fixed plan charges its amount; nothing when in credit', () => {
  assert.equal(autopayChargeCents({ amountCents: 5_000, upToBalance: true }, 3_200, 5_000), 3_200);
  assert.equal(autopayChargeCents({ amountCents: 5_000, upToBalance: true }, 9_000, 5_000), 5_000);
  assert.equal(autopayChargeCents({ amountCents: 5_000, upToBalance: true }, -1_000, 5_000), 0);
  assert.equal(autopayChargeCents({ amountCents: 2_500, upToBalance: false }, 0, 5_000), 2_500);
  assert.equal(autopayChargeCents(null, 0, 5_000), 5_000);
});

test('statement lines include the Valant opening balance line with its as-of date', () => {
  const lines = statementLineText({
    openingBalanceCents: 12_345, openingBalanceAsOf: '2026-10-16', prepaymentCreditCents: -2_000,
    claimsPatientCents: 3_000, patientPaymentsCents: 1_000, adjustmentsCents: 0,
  });
  assert.equal(lines[0], 'Previous balance (Valant, as of 2026-10-16): $123.45');
  assert.ok(lines.includes('Prepayment credit: -$20.00'));
  assert.ok(lines.includes('Payments received: -$10.00'));
});

// ---------------------------------------------------------------------------------------------

test('role gate: billing and leadership post; office manager (2026-10-22), front desk and therapists do not', () => {
  for (const r of ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'BILLING']) {
    assert.equal(canPostValantLedger(r), true, r);
    // Every poster opens the Valant Balances page and is billing core for other ledger changes
    assert.equal(canMutateLedger(r as never), true, r);
    assert.equal(canViewValantBalances(r), true, r);
  }
  // Office Manager: patient-side billing only (no Valant posting, no Valant Balances page)
  assert.equal(canViewValantBalances('OFFICE_MANAGER'), false);
  assert.equal(canMutateLedger('OFFICE_MANAGER' as never), false);
  for (const r of ['OFFICE_MANAGER', 'FRONT_DESK', 'THERAPIST', 'CLINICIAN', 'HR', 'MEDICAL_ASSISTANT', 'SUPER_ADMIN', '', null, undefined]) {
    assert.equal(canPostValantLedger(r as string | null | undefined), false, String(r));
  }
});

test('posting route: role-gated post/unpost, confirm required, replace warning, audit with counts only', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'api', 'billing', 'valant-balances', 'ledger', 'route.ts'), 'utf8');
  assert.match(src, /action !== 'preview' && !canPostValantLedger\(gate\.role\)/);
  assert.match(src, /confirm: z\.literal\(true\)/);
  assert.match(src, /auditPhiAccess/);
  assert.doesNotMatch(src, /clientName[^,]*metadata|metadata:[^}]*clientName/);
  assert.equal(REPLACE_WARNING, 'This replaces any earlier Valant opening balances');
});

test('migration: idempotent, one active entry per client/kind/source, no insurance kinds', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'prisma', 'migrations', '20261017_patient_ledger_entries.sql'), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "PatientLedgerEntry"/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS "PatientLedgerEntry_one_active_key"[\s\S]*WHERE "supersededAt" IS NULL/);
  assert.match(sql, /'opening_balance', 'prepayment_credit', 'manual_adjustment'/);
  assert.doesNotMatch(sql, /\bDROP\s|\bDELETE\s+FROM/i);
});
