import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getSuggestedFrequency } from '../src/features/caseload/frequencyEngine';

test('Frequency Engine: SUD/AUD + High Risk -> 2x/week (8 spm)', () => {
  const result = getSuggestedFrequency({
    diagnosis: 'Substance Use Disorder (Severe), AUD',
    riskLevel: 'high',
    sessionCount: 2,
  });
  assert.equal(result.sessionsPerMonth, 8);
  assert.equal(result.cadenceRule, '2x/week');
  assert.equal(result.isUrgent, true);
  assert.equal(result.levelOfCare, 'IOP / Enhanced');
  assert.match(result.clinicalRationale, /Active safety planning/i);
});

test('Frequency Engine: PTSD + Medium Risk -> Weekly (4 spm)', () => {
  const result = getSuggestedFrequency({
    primaryDiagnosis: 'F43.10 Post-traumatic stress disorder',
    riskLevel: 'medium',
    sessionCount: 5,
  });
  assert.equal(result.sessionsPerMonth, 4);
  assert.equal(result.cadenceRule, 'Weekly');
  assert.equal(result.levelOfCare, 'Outpatient OP');
  assert.match(result.clinicalRationale, /Weekly trauma processing/i);
});

test('Frequency Engine: GAD + Low Risk + Maintenance -> Bi-weekly (2 spm)', () => {
  const result = getSuggestedFrequency({
    diagnosis: 'Generalized Anxiety Disorder',
    riskLevel: 'low',
    sessionCount: 12,
  });
  assert.equal(result.sessionsPerMonth, 2);
  assert.equal(result.cadenceRule, 'Bi-weekly');
  assert.equal(result.levelOfCare, 'Routine OP');
});

test('Frequency Engine: New client (< 4 sessions) bumped to minimum Weekly', () => {
  const result = getSuggestedFrequency({
    diagnosis: 'Attention Deficit Hyperactivity Disorder',
    riskLevel: 'low',
    sessionCount: 2,
  });
  assert.equal(result.sessionsPerMonth, 4);
  assert.equal(result.cadenceRule, 'Weekly');
  assert.match(result.clinicalRationale, /initial intake\/diagnostic stabilization/i);
});

test('Frequency Engine: High Complexity Level 3 bumped to minimum Weekly', () => {
  const result = getSuggestedFrequency({
    diagnosis: 'Generalized Anxiety Disorder',
    riskLevel: 'low',
    sessionCount: 10,
    complexity: 3,
  });
  assert.equal(result.sessionsPerMonth, 4);
  assert.equal(result.cadenceRule, 'Weekly');
  assert.match(result.clinicalRationale, /High complexity caseload score/i);
});
