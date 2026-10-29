import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { instrumentById, HIGHER_IS_BETTER } from '../src/lib/measures/instruments';
import { bandsFromScoring, measureGuideEntry, scoreFromTotal, SEE_MANUAL } from '../src/lib/measures/guide';
import { scoreItems } from '../src/lib/measures/scoring';
import { scorePaperMeasure } from '../src/lib/measures/paper';
import { safetyAlertsFor } from '../src/lib/measures/safety';
import { raiseSessionSafetyAlert, sessionScored } from '../src/lib/measures/sessionSafety';
import { bandFor } from '../src/components/measures/shared';
import { DASS21_ITEMS, DASS42_ITEMS, asrsShadedCount } from '../src/features/ehr/assessments/standardScoring';

// Synthetic data only; no real patient data.
const sev = (id: string, total: number) => scoreFromTotal(id, total)!.severity;
const items = (n: number, v: number | ((i: number) => number)) =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [`q${i + 1}`, typeof v === 'function' ? v(i + 1) : v]));
const calc = (id: string, answers: Record<string, number>) => instrumentById(id)!.calculateResult(answers);

// ─── Total-banded instruments (boundaries) ────────────────────────────────────

test('PCL-5: probable PTSD at 33 or more (VA National Center for PTSD)', () => {
  assert.equal(sev('pcl-5', 0), 'Below Threshold');
  assert.equal(sev('pcl-5', 32), 'Below Threshold');
  assert.equal(sev('pcl-5', 33), 'Probable PTSD');
  assert.equal(sev('pcl-5', 80), 'Probable PTSD');
  assert.deepEqual(bandsFromScoring('pcl-5')!.map((b) => [b.min, b.max]), [[0, 32], [33, 80]]);
});

test('WHO-5: raw 7 or under likely depression, under 13 poor wellbeing; percent = raw x 4', () => {
  assert.equal(sev('who-5', 0), 'Likely Depression');
  assert.equal(sev('who-5', 7), 'Likely Depression');
  assert.equal(sev('who-5', 8), 'Poor Wellbeing — Screen for Depression');
  assert.equal(sev('who-5', 12), 'Poor Wellbeing — Screen for Depression');
  assert.equal(sev('who-5', 13), 'Adequate Wellbeing');
  assert.equal(sev('who-5', 25), 'Adequate Wellbeing');
  const r = calc('who-5', items(5, 2));
  assert.equal(r.totalScore, 10);
  assert.match(r.interpretation, /\(40%\)/);
  const g = measureGuideEntry('who-5')!;
  assert.match(g.change.note!, /10-percentage-point/);
  assert.ok(HIGHER_IS_BETTER.has('who-5') && HIGHER_IS_BETTER.has('swls'));
});

test('ESS: 0-10 normal, 11-12 mild, 13-15 moderate, 16-24 severe', () => {
  assert.equal(sev('ess', 10), 'Normal');
  assert.equal(sev('ess', 11), 'Mild Excessive Daytime Sleepiness');
  assert.equal(sev('ess', 12), 'Mild Excessive Daytime Sleepiness');
  assert.equal(sev('ess', 13), 'Moderate Excessive Daytime Sleepiness');
  assert.equal(sev('ess', 15), 'Moderate Excessive Daytime Sleepiness');
  assert.equal(sev('ess', 16), 'Severe Excessive Daytime Sleepiness');
  assert.equal(sev('ess', 24), 'Severe Excessive Daytime Sleepiness');
});

test('HAM-D 17 (Zimmerman 2013): 0-7, 8-16, 17-23, 24+', () => {
  assert.deepEqual(bandsFromScoring('ham-d')!.map((b) => [b.min, b.max, b.label]), [
    [0, 7, 'No Depression'], [8, 16, 'Mild'], [17, 23, 'Moderate'], [24, 52, 'Severe'],
  ]);
  // Paper total-only follows the same source
  const p = scorePaperMeasure({ instrumentId: 'ham-d', mode: 'total', totalScore: 17 });
  assert.equal(p.ok && p.scored.severity, 'Moderate');
});

test('SWLS: published seven bands, 20 neutral', () => {
  assert.deepEqual(bandsFromScoring('swls')!.map((b) => [b.min, b.max, b.label]), [
    [5, 9, 'Extremely Dissatisfied'], [10, 14, 'Dissatisfied'], [15, 19, 'Slightly Dissatisfied'], [20, 20, 'Neutral'],
    [21, 25, 'Slightly Satisfied'], [26, 30, 'Satisfied'], [31, 35, 'Extremely Satisfied'],
  ]);
});

test('SPIN: under 21, 21-30, 31-40, 41-50, 51+; screening cutoff 19', () => {
  assert.deepEqual(bandsFromScoring('spin')!.map((b) => [b.min, b.max]), [[0, 20], [21, 30], [31, 40], [41, 50], [51, 68]]);
  assert.equal(sev('spin', 20), 'None or Very Mild');
  assert.equal(sev('spin', 21), 'Mild');
  assert.equal(sev('spin', 51), 'Very Severe');
  assert.match(measureGuideEntry('spin')!.publishedCutoff!, /19 or higher/);
});

// ─── Pattern / subscale scored ────────────────────────────────────────────────

test('ASRS v1.1 Part A: positive at 4 of 6 shaded; shows the shaded count; total-only cannot screen', () => {
  // Items 1-3 shaded from Sometimes (2); items 4-6 from Often (3)
  const three = { q1: 2, q2: 2, q3: 2, q4: 2, q5: 2, q6: 2 };
  assert.equal(asrsShadedCount(three), 3);
  const r3 = calc('asrs', three);
  assert.equal(r3.severity, 'Screen Negative (3 of 6 shaded)');
  assert.equal(r3.totalScore, 12, 'raw total kept');
  const four = { ...three, q4: 3 };
  assert.equal(calc('asrs', four).severity, 'Screen Positive (4 of 6 shaded)');
  // A high total without shaded answers is still negative
  assert.equal(calc('asrs', { q1: 1, q2: 1, q3: 1, q4: 2, q5: 2, q6: 2 }).severity, 'Screen Negative (0 of 6 shaded)');
  assert.equal(sev('asrs', 20), 'Shaded count needed for screening');
  const paper = scorePaperMeasure({ instrumentId: 'asrs', mode: 'total', totalScore: 20 });
  assert.equal(paper.ok && paper.scored.severity, 'Shaded count needed for screening');
  const link = scoreItems('asrs', four);
  assert.equal(link.ok && link.scored.severity, 'Screen Positive (4 of 6 shaded)');
  assert.equal(bandsFromScoring('asrs'), null);
});

test('DASS-21: three subscales, item sums x 2, published cutoffs at the boundaries', () => {
  const all = [...DASS21_ITEMS.depression, ...DASS21_ITEMS.anxiety, ...DASS21_ITEMS.stress].sort((a, b) => a - b);
  assert.deepEqual(all, Array.from({ length: 21 }, (_, i) => i + 1));
  const sub = (scale: 'depression' | 'anxiety' | 'stress', doubled: number) => {
    // Spread doubled/2 over the scale's items (max 3 each)
    let left = doubled / 2;
    const a = items(21, 0);
    for (const n of DASS21_ITEMS[scale]) { const v = Math.min(3, left); a[`q${n}`] = v; left -= v; }
    return calc('dass-21', a).subscales!;
  };
  const band = (scale: 'depression' | 'anxiety' | 'stress', d: number) => {
    const r = calc('dass-21', (() => {
      let left = d / 2; const a = items(21, 0);
      for (const n of DASS21_ITEMS[scale]) { const v = Math.min(3, left); a[`q${n}`] = v; left -= v; }
      return a;
    })());
    const name = scale[0].toUpperCase() + scale.slice(1);
    return new RegExp(`${name}: ([A-Za-z ]+) \\(${d}\\)`).exec(r.severity)![1];
  };
  assert.equal(sub('depression', 14).depression, 14);
  // Depression 0-9, 10-13, 14-20, 21-27 (odd sums cannot occur on DASS-21), 28+
  for (const [d, l] of [[8, 'Normal'], [10, 'Mild'], [12, 'Mild'], [14, 'Moderate'], [20, 'Moderate'], [22, 'Severe'], [26, 'Severe'], [28, 'Extremely Severe']] as const) assert.equal(band('depression', d), l, `D ${d}`);
  for (const [d, l] of [[6, 'Normal'], [8, 'Mild'], [10, 'Moderate'], [14, 'Moderate'], [16, 'Severe'], [18, 'Severe'], [20, 'Extremely Severe']] as const) assert.equal(band('anxiety', d), l, `A ${d}`);
  for (const [d, l] of [[14, 'Normal'], [16, 'Mild'], [18, 'Mild'], [20, 'Moderate'], [24, 'Moderate'], [26, 'Severe'], [32, 'Severe'], [34, 'Extremely Severe']] as const) assert.equal(band('stress', d), l, `S ${d}`);
  // Item assignment: item 3 is depression, item 2 anxiety, item 1 stress
  const one = calc('dass-21', { ...items(21, 0), q3: 3, q2: 2, q1: 1 }).subscales!;
  assert.deepEqual(one, { depression: 6, anxiety: 4, stress: 2 });
  assert.equal(sev('dass-21', 30), 'Subscale scores needed for severity');
  const g = measureGuideEntry('dass-21')!;
  assert.equal(g.verified, true);
  assert.deepEqual(g.subscaleBands!.map((s) => s.name), ['Depression', 'Anxiety', 'Stress']);
  assert.deepEqual(g.subscaleBands![2].bands.map((b) => b.min), [0, 15, 19, 26, 34]);
});

test('DASS-42: full sums (no x 2), same cutoffs; total-only needs subscales', () => {
  const all = [...DASS42_ITEMS.depression, ...DASS42_ITEMS.anxiety, ...DASS42_ITEMS.stress].sort((a, b) => a - b);
  assert.deepEqual(all, Array.from({ length: 42 }, (_, i) => i + 1));
  const a = items(42, 0);
  DASS42_ITEMS.depression.slice(0, 5).forEach((n) => { a[`q${n}`] = 2; }); // 10
  const r = calc('dass-42', a);
  assert.equal(r.subscales!.depression, 10);
  assert.match(r.severity, /Depression: Mild \(10\)/);
  assert.equal(sev('dass-42', 40), 'Subscale scores needed for severity');
});

test('MDQ: positive only with 7+ Part 1 yes AND Part 2 yes AND Part 3 moderate/serious', () => {
  const mdq = (yes: number, part2: number, part3: number) => calc('mdq', { ...items(13, (i) => (i <= yes ? 1 : 0)), q14: part2, q15: part3 });
  assert.equal(mdq(7, 1, 1).severity, 'Screen Positive');
  assert.equal(mdq(13, 1, 1).severity, 'Screen Positive');
  assert.equal(mdq(6, 1, 1).severity, 'Screen Negative');
  assert.equal(mdq(7, 0, 1).severity, 'Screen Negative');
  assert.equal(mdq(13, 1, 0).severity, 'Screen Negative', 'no or minor problem');
  assert.equal(mdq(7, 1, 1).totalScore, 9, 'raw total kept');
  // Part 3 options: no / minor score 0, moderate / serious score 1
  const p3 = instrumentById('mdq')!.questions!.find((q) => q.id === 'q15')!;
  assert.deepEqual(p3.options.map((o) => o.score), [0, 0, 1, 1]);
  assert.equal(sev('mdq', 10), 'Parts 2 and 3 required');
  assert.equal(bandsFromScoring('mdq'), null);
});

test('guide: these instruments are verified with a citation; others stay "See the instrument manual"', () => {
  for (const id of ['pcl-5', 'who-5', 'ess', 'ham-d', 'asrs', 'dass-21', 'dass-42', 'mdq', 'swls', 'spin']) {
    const e = measureGuideEntry(id)!;
    assert.equal(e.verified, true, id);
    assert.notEqual(e.citation, SEE_MANUAL, id);
    assert.equal(e.scoringLabels, null, `${id}: no "not verified" labels`);
  }
  assert.match(measureGuideEntry('pcl-5')!.citation, /National Center for PTSD/);
  assert.match(measureGuideEntry('ham-d')!.citation, /Zimmerman/);
  for (const id of ['ymrs', 'ham-a', 'bprs']) assert.equal(measureGuideEntry(id)!.verified, false, id);
  const page = readFileSync('src/app/dashboard/mbc/guide/page.tsx', 'utf8');
  assert.match(page, /e\.bands \|\| e\.verified \? null/);
});

test('trend tone: lowest band is the worst on higher-is-better measures', () => {
  const ranges = instrumentById('who-5')!.scoreRanges!;
  assert.equal(bandFor(5, ranges, true)!.tone, 'danger');
  assert.equal(bandFor(20, ranges, true)!.tone, 'success');
  const pcl = instrumentById('pcl-5')!.scoreRanges!;
  assert.equal(bandFor(40, pcl)!.tone, 'danger');
});

// ─── In-session safety alert ──────────────────────────────────────────────────

function alertDb() {
  const rows: { id: string; data: Record<string, unknown> }[] = [];
  return {
    rows,
    riskAlert: {
      findFirst: async ({ where }: { where: { organizationId: string; clientId: string; source: string; sourceId: string } }) =>
        rows.find((r) => r.data.organizationId === where.organizationId && r.data.clientId === where.clientId && r.data.source === where.source && r.data.sourceId === where.sourceId) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `alert${rows.length + 1}`, data };
        rows.push(row);
        return { id: row.id };
      },
    },
  };
}

const client = { id: 'clientA', name: 'Synthetic Client', assignedToId: 'treating' };

test('in session: PHQ-9 item 9 above 0 raises one HIGH alert to the treating clinician, not duplicated', async () => {
  const answers = { ...items(9, 0), q9: 1 };
  const result = calc('phq-9', answers);
  const scored = sessionScored({ instrumentId: 'phq-9', instrumentName: 'PHQ-9', category: 'Depression & Mood', answers, result });
  assert.equal(scored.safetyItemPositive, true);
  // Same plan as the patient-link / paper helper
  assert.equal(safetyAlertsFor([scored], 'session')[0].type, safetyAlertsFor([scored])[0].type);
  const db = alertDb();
  const input = { organizationId: 'org1', client, actorUserId: 'enteredBy', recordId: 'rec1', scored };
  const first = await raiseSessionSafetyAlert(db, input);
  assert.equal(first.created.length, 1);
  assert.equal(db.rows[0].data.severity, 'HIGH');
  assert.equal(db.rows[0].data.type, 'suicidal_ideation');
  assert.equal(db.rows[0].data.clinicianId, 'treating');
  assert.equal(db.rows[0].data.source, 'assessment');
  assert.equal(db.rows[0].data.sourceId, 'rec1');
  assert.match(String(db.rows[0].data.description), /entered in session/);
  const again = await raiseSessionSafetyAlert(db, input);
  assert.deepEqual(again, { created: [], existing: 'alert1' });
  assert.equal(db.rows.length, 1);
  // Unassigned client: the clinician who entered it
  const other = await raiseSessionSafetyAlert(db, { ...input, client: { ...client, assignedToId: null }, recordId: 'rec2' });
  assert.equal(other.created.length, 1);
  assert.equal(db.rows[1].data.clinicianId, 'enteredBy');
});

test('in session: PHQ-A item 9, EPDS item 10 at 1+, C-SSRS screener positive alert; negatives do not', async () => {
  const cases: [string, Record<string, number>, boolean][] = [
    ['phq-a', { ...items(instrumentById('phq-a')!.questions!.length, 0), q9: 2 }, true],
    ['epds', { ...items(10, 0), q10: 1 }, true],
    ['epds', items(10, 0), false],
    ['c-ssrs-brief', { ...items(instrumentById('c-ssrs-brief')!.questions!.length, 0), q4: 1 }, true],
    ['c-ssrs-brief', items(instrumentById('c-ssrs-brief')!.questions!.length, 0), false],
    ['phq-9', items(9, 0), false],
  ];
  for (const [id, answers, expect] of cases) {
    const i = instrumentById(id)!;
    const result = i.calculateResult(answers);
    const scored = sessionScored({ instrumentId: id, instrumentName: i.name, category: i.category, answers, result });
    const db = alertDb();
    const r = await raiseSessionSafetyAlert(db, { organizationId: 'org1', client, actorUserId: 'u', recordId: `r-${id}`, scored });
    assert.equal(r.created.length, expect ? 1 : 0, `${id} ${JSON.stringify(answers)}`);
  }
});

test('in-session route raises the alert after saving and audits it', () => {
  const src = readFileSync('src/app/api/clinical/assessments/route.ts', 'utf8');
  assert.match(src, /raiseSessionSafetyAlert\(prisma/);
  assert.match(src, /resourceType: 'riskAlert'/);
  assert.match(src, /feature: 'assessment-in-session'/);
  assert.match(src, /riskAlertIds/);
  // Score-only entries use the instrument's own scoring when no severity is typed
  assert.match(src, /scoreFromTotal\(instrument\.id/);
});
