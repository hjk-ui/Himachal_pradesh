import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  OVER_120_INDEX,
  OVER_120_NOTE,
  presentAgingBuckets,
  presentAgingTotals,
  sumPresented,
} from '../src/lib/billing/valantAgingDisplay';
import { DEFAULT_AGING_LABELS } from '../src/lib/migration/valantAging';

// Like the patient / insurance summaries: money spread over buckets 3-5
const stored = [
  { buckets: [0, 0, 1000, 2500, 4000], total: 7500 },
  { buckets: [0, 0, 0, 300, 700], total: 1000 },
  { buckets: [0, 0, 5000, 0, 0], total: 5000 },
];
const report = { bucketsCents: [0, 0, 6000, 2800, 4700], totalCents: 13500 };

test('Over 120 is the fifth default label (owner-accepted headings)', () => {
  assert.equal(DEFAULT_AGING_LABELS[OVER_120_INDEX], 'Over 120');
  assert.deepEqual([...DEFAULT_AGING_LABELS], ['0–30', '31–60', '61–90', '91–120', 'Over 120']);
  assert.match(OVER_120_NOTE, /^Shown as Over 120 \(practice setting\)\. Valant's original buckets:$/);
});

test('ON: whole total shown in Over 120, originals kept and not mutated', () => {
  const src = [0, 0, 1000, 2500, 4000];
  const p = presentAgingBuckets(src, 7500, true);
  assert.deepEqual(p.displayBucketsCents, [0, 0, 0, 0, 7500]);
  assert.deepEqual(p.valantBucketsCents, [0, 0, 1000, 2500, 4000]);
  assert.equal(p.totalCents, 7500);
  assert.equal(p.shownAsOver120, true);
  assert.deepEqual(src, [0, 0, 1000, 2500, 4000]);
  assert.notEqual(p.valantBucketsCents, src);
});

test('ON: row whose Valant buckets do not add up still shows its total in Over 120', () => {
  const p = presentAgingBuckets([100, 0, 0, 0, 0], 250, true);
  assert.deepEqual(p.displayBucketsCents, [0, 0, 0, 0, 250]);
  assert.deepEqual(p.valantBucketsCents, [100, 0, 0, 0, 0]);
});

test('OFF: display = Valant buckets', () => {
  const p = presentAgingBuckets([0, 0, 1000, 2500, 4000], 7500, false);
  assert.deepEqual(p.displayBucketsCents, [0, 0, 1000, 2500, 4000]);
  assert.deepEqual(p.valantBucketsCents, [0, 0, 1000, 2500, 4000]);
  assert.equal(p.shownAsOver120, false);
});

test('ON: totals preserved, Over 120 column = grand total = report total, reconciliation uses originals', () => {
  const rows = stored.map((r) => presentAgingBuckets(r.buckets, r.total, true));
  const t = presentAgingTotals(rows, report);
  assert.equal(t.totalCents, 13500);
  assert.deepEqual(t.displayBucketsCents, [0, 0, 0, 0, 13500]);
  assert.equal(t.displayBucketsCents[OVER_120_INDEX], t.totalCents);
  assert.deepEqual(t.valantBucketsCents, [0, 0, 6000, 2800, 4700]);
  assert.deepEqual(t.bucketsMatchReport, [true, true, true, true, true]);
  assert.equal(t.totalMatchesReport, true);
});

test('OFF: same totals and reconciliation', () => {
  const rows = stored.map((r) => presentAgingBuckets(r.buckets, r.total, false));
  const t = presentAgingTotals(rows, report);
  assert.deepEqual(t.displayBucketsCents, [0, 0, 6000, 2800, 4700]);
  assert.equal(t.totalCents, 13500);
  assert.deepEqual(t.bucketsMatchReport, [true, true, true, true, true]);
  assert.equal(t.totalMatchesReport, true);
});

test('reconciliation still catches a real mismatch in the original buckets; missing report figures = null', () => {
  const rows = stored.map((r) => presentAgingBuckets(r.buckets, r.total, true));
  const t = presentAgingTotals(rows, { bucketsCents: [0, 0, 6001, 2800, null], totalCents: 13501 });
  assert.deepEqual(t.bucketsMatchReport, [true, true, false, true, null]);
  assert.equal(t.totalMatchesReport, false);
  const none = presentAgingTotals(rows);
  assert.deepEqual(none.bucketsMatchReport, [null, null, null, null, null]);
  assert.equal(none.totalMatchesReport, null);
});

test('Combined aging (all already in Over 120): ON and OFF look the same and reconcile', () => {
  const parties = [
    presentAgingBuckets([0, 0, 0, 0, 1200], 1200, true),
    presentAgingBuckets([0, 0, 0, 0, 800], 800, true),
  ];
  const patient = sumPresented(parties, true);
  assert.deepEqual(patient.displayBucketsCents, [0, 0, 0, 0, 2000]);
  assert.deepEqual(patient.valantBucketsCents, [0, 0, 0, 0, 2000]);
  const t = presentAgingTotals([patient], { bucketsCents: [0, 0, 0, 0, 2000], totalCents: 2000 });
  assert.equal(t.totalMatchesReport, true);
  assert.deepEqual(t.bucketsMatchReport, [true, true, true, true, true]);
});

test('grouping presented rows (insurance by payer) sums both shown and original buckets', () => {
  const g = sumPresented(stored.map((r) => presentAgingBuckets(r.buckets, r.total, true)), true);
  assert.deepEqual(g.displayBucketsCents, [0, 0, 0, 0, 13500]);
  assert.deepEqual(g.valantBucketsCents, [0, 0, 6000, 2800, 4700]);
  assert.equal(g.totalCents, 13500);
  assert.equal(g.shownAsOver120, true);
});
