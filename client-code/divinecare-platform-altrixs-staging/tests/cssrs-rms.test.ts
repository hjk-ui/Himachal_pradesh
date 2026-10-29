import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeRisk } from '../src/lib/clinical/cssrsRisk';
import { ASSESSMENT_CATALOG } from '../src/features/ehr/assessments/catalog';

test('computeRisk: imminent when q5 and any behavior', () => {
  assert.equal(computeRisk({ q5: 1, q6: 1 }), 'imminent');
  assert.equal(computeRisk({ q5: 1, q10: 1 }), 'imminent');
});

test('computeRisk: high for ideation method/intent/plan or behavior without imminent combo', () => {
  assert.equal(computeRisk({ q3: 1 }), 'high');
  assert.equal(computeRisk({ q4: 1 }), 'high');
  assert.equal(computeRisk({ q5: 1 }), 'high');
  assert.equal(computeRisk({ q6: 1 }), 'high');
});

test('computeRisk: moderate for q2 only', () => {
  assert.equal(computeRisk({ q2: 1 }), 'moderate');
});

test('computeRisk: low for q1 or none', () => {
  assert.equal(computeRisk({ q1: 1 }), 'low');
  assert.equal(computeRisk({}), 'low');
});

test('RMS digital instrument present with 10 items and bipolar cutoff', () => {
  const rms = ASSESSMENT_CATALOG.find((i) => i.id === 'rms');
  assert.ok(rms, 'RMS must exist in catalog');
  assert.equal(rms.hasDigitalQuestionnaire, true);
  assert.equal(rms.questions?.length, 10);
  assert.equal(rms.maxScore, 10);
  const negative = rms.calculateResult({
    q1: 0, q2: 0, q3: 0, q4: 0, q5: 0, q6: 0, q7: 0, q8: 0, q9: 0, q10: 0,
  });
  assert.equal(negative.totalScore, 0);
  assert.match(negative.severity, /Negative/i);
  const positive = rms.calculateResult({
    q1: 1, q2: 1, q3: 1, q4: 1, q5: 1, q6: 0, q7: 0, q8: 0, q9: 0, q10: 0,
  });
  assert.equal(positive.totalScore, 5);
  assert.match(positive.severity, /Positive/i);
});
