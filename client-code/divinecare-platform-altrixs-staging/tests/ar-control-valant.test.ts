import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  FACILITY_NOTE,
  addTotals,
  buildValantWorklistCsv,
  buildWorklistRows,
  composeValantRunout,
  filterSortWorklist,
  groupByPayer,
  paginate,
  parseWorklistQuery,
  runoutNote,
  sumAgingRows,
  type CombinedLineInput,
} from '../src/lib/billing/arControlValant';
import { DEFAULT_AGING_LABELS } from '../src/lib/migration/valantAging';

const b = (b1: number, b2: number, b3: number, b4: number, b5: number) => ({
  bucket1Cents: b1, bucket2Cents: b2, bucket3Cents: b3, bucket4Cents: b4, bucket5Cents: b5, totalCents: b1 + b2 + b3 + b4 + b5,
});

const insuranceRows = [
  { payerName: 'Aetna', ...b(100, 0, 200, 0, 700) },
  { payerName: 'CareFirst', ...b(0, 500, 0, 0, 0) },
  { payerName: '  aetna ', ...b(0, 0, 0, 300, 0) },
];
const patientRows = [
  { clientId: 'c1', ...b(0, 0, 0, 0, 2500) },
  { clientId: null, ...b(1000, 0, 0, 0, 0) },
];

let n = 0;
const line = (o: Partial<CombinedLineInput> & { buckets: ReturnType<typeof b> }): CombinedLineInput => {
  n += 1;
  return {
    id: o.id ?? `l${n}`,
    valantPatientId: o.valantPatientId ?? `P${n}`,
    clientId: o.clientId === undefined ? `c${n}` : o.clientId,
    party: o.party ?? 'primary',
    payerName: o.payerName === undefined ? 'Aetna' : o.payerName,
    lastBilledAt: o.lastBilledAt ?? null,
    client: o.client === undefined ? { name: `Client ${n}`, mrn: null } : o.client,
    ...o.buckets,
  };
};

const combined: CombinedLineInput[] = [
  line({ id: 'a', valantPatientId: 'V1', clientId: 'c1', client: { name: 'Ann', mrn: 'M1' }, payerName: 'Aetna', buckets: b(0, 0, 0, 0, 400), lastBilledAt: new Date('2026-05-01T12:00:00Z') }),
  line({ id: 'a-pt', valantPatientId: 'V1', clientId: 'c1', client: { name: 'Ann', mrn: 'M1' }, party: 'patient', payerName: null, buckets: b(50, 0, 0, 0, 0) }),
  line({ id: 'b', valantPatientId: 'V2', clientId: null, client: null, payerName: 'CareFirst', buckets: b(0, 900, 0, 0, 0), lastBilledAt: new Date('2026-09-01T12:00:00Z') }),
  line({ id: 'c', valantPatientId: 'V3', clientId: 'c3', client: { name: 'Cy', mrn: null }, party: 'secondary', payerName: 'aetna', buckets: b(0, 0, 300, 0, 0) }),
  line({ id: 'credit', valantPatientId: 'V4', clientId: 'c4', payerName: 'Aetna', buckets: b(0, -200, 0, 0, 0) }),
];

test('sumAgingRows: Over-120 ON shows every total in bucket 5, originals kept', () => {
  const on = sumAgingRows(insuranceRows, true);
  assert.deepEqual(on.displayBucketsCents, [0, 0, 0, 0, 1800]);
  assert.deepEqual(on.valantBucketsCents, [100, 500, 200, 300, 700]);
  assert.equal(on.totalCents, 1800);
  assert.equal(on.rows, 3);
  const off = sumAgingRows(insuranceRows, false);
  assert.deepEqual(off.displayBucketsCents, [100, 500, 200, 300, 700]);
});

test('addTotals: insurance + patient, null when nothing imported', () => {
  assert.equal(addTotals(null, null), null);
  const all = addTotals(sumAgingRows(insuranceRows, false), sumAgingRows(patientRows, false))!;
  assert.deepEqual(all.displayBucketsCents, [1100, 500, 200, 300, 3200]);
  assert.equal(all.totalCents, 5300);
  assert.equal(addTotals(null, sumAgingRows(patientRows, false))!.totalCents, 3500);
});

test('groupByPayer: case/space-insensitive grouping, bucket split, row + combined line counts, largest first', () => {
  const insLines = combined.filter((l) => l.party !== 'patient');
  const payers = groupByPayer(insuranceRows, insLines, false);
  assert.deepEqual(payers.map((p) => p.payerName), ['Aetna', 'CareFirst']);
  assert.equal(payers[0].rowCount, 2);
  assert.equal(payers[0].combinedLines, 3); // a, c (lowercase), credit
  assert.deepEqual(payers[0].valantBucketsCents, [100, 0, 200, 300, 700]);
  assert.equal(payers[0].totalCents, 1300);
  assert.equal(payers[1].combinedLines, 1);
  const on = groupByPayer(insuranceRows, insLines, true);
  assert.deepEqual(on[0].displayBucketsCents, [0, 0, 0, 0, 1300]);
});

test('buildWorklistRows: insurance parties with a balance only (no patient lines, no credits)', () => {
  const rows = buildWorklistRows(combined, false);
  assert.deepEqual(rows.map((r) => r.id).sort(), ['a', 'b', 'c']);
  const a = rows.find((r) => r.id === 'a')!;
  assert.equal(a.clientName, 'Ann');
  assert.equal(a.lastBilledAt, '2026-05-01');
  assert.equal(a.oldestBucket, 4);
  assert.equal(rows.find((r) => r.id === 'b')!.oldestBucket, 1);
});

test('filterSortWorklist: default oldest sort, amount / lastBilled / name sorts', () => {
  const rows = buildWorklistRows(combined, false);
  assert.deepEqual(filterSortWorklist(rows).map((r) => r.id), ['a', 'c', 'b']);
  assert.deepEqual(filterSortWorklist(rows, { sort: 'amount' }).map((r) => r.id), ['b', 'a', 'c']);
  // never billed first, then oldest billing date
  assert.deepEqual(filterSortWorklist(rows, { sort: 'lastBilled' }).map((r) => r.id), ['c', 'a', 'b']);
  // unmatched (no name) last
  assert.deepEqual(filterSortWorklist(rows, { sort: 'name' }).map((r) => r.id), ['a', 'c', 'b']);
});

test('filterSortWorklist: payer, bucket, min amount, party, unmatched, search', () => {
  const rows = buildWorklistRows(combined, false);
  assert.deepEqual(filterSortWorklist(rows, { payer: ' AETNA ' }).map((r) => r.id), ['a', 'c']);
  assert.deepEqual(filterSortWorklist(rows, { bucket: 2 }).map((r) => r.id), ['c']);
  assert.deepEqual(filterSortWorklist(rows, { minCents: 400 }).map((r) => r.id), ['a', 'b']);
  assert.deepEqual(filterSortWorklist(rows, { party: 'secondary' }).map((r) => r.id), ['c']);
  assert.deepEqual(filterSortWorklist(rows, { unmatchedOnly: true }).map((r) => r.id), ['b']);
  assert.deepEqual(filterSortWorklist(rows, { q: 'm1' }).map((r) => r.id), ['a']);
  assert.deepEqual(filterSortWorklist(rows, { q: 'v2' }).map((r) => r.id), ['b']);
});

test('bucket filter follows the Over-120 display setting', () => {
  const rows = buildWorklistRows(combined, true);
  assert.equal(filterSortWorklist(rows, { bucket: 1 }).length, 0);
  assert.equal(filterSortWorklist(rows, { bucket: 4 }).length, 3);
  // with everything in one column, "oldest" ranks by amount
  assert.deepEqual(filterSortWorklist(rows).map((r) => r.id), ['b', 'a', 'c']);
});

test('paginate clamps page and page size', () => {
  const xs = Array.from({ length: 5 }, (_, i) => i);
  assert.deepEqual(paginate(xs, 2, 2), { rows: [2, 3], page: 2, pageSize: 2, total: 5 });
  assert.equal(paginate(xs, 99, 2).page, 3);
  assert.equal(paginate(xs, 0, 2).page, 1);
  assert.equal(paginate(xs, 1, 10_000).pageSize, 200);
});

test('parseWorklistQuery: valid values kept, junk dropped', () => {
  const q = parseWorklistQuery(new URLSearchParams('payer=Aetna&bucket=4&min=12.5&party=primary&sort=amount&page=2&unmatched=1&q=ann'));
  assert.deepEqual(q, { payer: 'Aetna', bucket: 4, minCents: 1250, party: 'primary', q: 'ann', unmatchedOnly: true, sort: 'amount', page: 2, pageSize: 50 });
  const bad = parseWorklistQuery(new URLSearchParams('bucket=9&min=-3&party=patient&sort=drop'));
  assert.equal(bad.bucket, null);
  assert.equal(bad.minCents, null);
  assert.equal(bad.party, null);
  assert.equal(bad.sort, 'oldest');
});

test('composeValantRunout: totals, unmatched counts, note, worklist paging', () => {
  const r = composeValantRunout(
    {
      labels: [...DEFAULT_AGING_LABELS],
      labelsConfirmed: false,
      displayAllOver120: true,
      asOf: { insurance: new Date('2026-10-10T12:00:00Z'), patient: new Date('2026-10-10T12:00:00Z'), combined: new Date('2026-10-12T12:00:00Z') },
      insuranceRows,
      patientRows,
      combinedLines: combined,
    },
    { pageSize: 2 }
  );
  assert.equal(r.available, true);
  assert.equal(r.latestAsOf, '2026-10-12');
  assert.equal(r.note, 'Insurance A/R from Valant is being worked to zero in Valant (run-out). Figures are as of 2026-10-12 from the last Valant import.');
  assert.equal(r.totals.insurance!.totalCents, 1800);
  assert.equal(r.totals.patient!.totalCents, 3500);
  assert.equal(r.totals.all!.totalCents, 5300);
  assert.deepEqual(r.totals.all!.displayBucketsCents, [0, 0, 0, 0, 5300]);
  assert.equal(r.combined!.patientLines.totalCents, 50);
  assert.equal(r.combined!.insuranceLines.totalCents, 400 + 900 + 300 - 200);
  assert.deepEqual(r.unmatched, { patientAgingRows: 1, patientAgingTotal: 2, combinedPatients: 1, combinedPatientsTotal: 4, combinedInsuranceLines: 1 });
  assert.equal(r.worklist.total, 3);
  assert.equal(r.worklist.rows.length, 2);
  assert.equal(r.worklist.totalCents, 1600);
  assert.deepEqual(r.worklist.payers, ['Aetna', 'CareFirst']);
  assert.equal(r.byFacility, null);
  assert.equal(r.facilityNote, FACILITY_NOTE);
  assert.equal(r.allWorklistRows.length, 3);
});

test('empty state: nothing imported', () => {
  const r = composeValantRunout({
    labels: [...DEFAULT_AGING_LABELS],
    labelsConfirmed: false,
    displayAllOver120: true,
    asOf: { insurance: null, patient: null, combined: null },
    insuranceRows: [],
    patientRows: [],
    combinedLines: [],
  });
  assert.equal(r.available, false);
  assert.equal(r.latestAsOf, null);
  assert.deepEqual(r.totals, { insurance: null, patient: null, all: null });
  assert.equal(r.combined, null);
  assert.deepEqual(r.byPayer, []);
  assert.equal(r.worklist.total, 0);
  assert.deepEqual(r.worklist.rows, []);
  assert.equal(r.worklist.page, 1);
  assert.match(runoutNote(null), /as of \(no import yet\)/);
});

test('worklist CSV: shown + original buckets, dollars, formula-safe text', () => {
  const rows = buildWorklistRows(
    [line({ id: 'x', valantPatientId: 'V9', client: { name: '=HYPERLINK("x")', mrn: null }, payerName: 'Aetna, Inc', buckets: b(0, 0, 1050, 0, 0) })],
    true
  );
  const csv = buildValantWorklistCsv(rows, DEFAULT_AGING_LABELS, '2026-10-12').split('\n');
  assert.equal(csv.length, 2);
  assert.match(csv[0], /^asOf,valantPatientId,clientName,mrn,matched,party,payer,lastBilled,shown 0–30,/);
  assert.match(csv[1], /^2026-10-12,V9,"'=HYPERLINK\(""x""\)",,yes,primary,"Aetna, Inc",,0\.00,0\.00,0\.00,0\.00,10\.50,10\.50,0\.00,0\.00,10\.50,0\.00,0\.00$/);
});
