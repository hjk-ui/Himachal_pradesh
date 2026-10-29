import test from 'node:test';
import assert from 'node:assert/strict';

import { ASSESSMENT_CATALOG } from '../src/features/ehr/assessments/catalog';
import { EVALUATION_TEMPLATES } from '../src/features/ehr/evaluations/templates';
import { LOCUS_DIMENSIONS, calculateLocusLevelOfCare } from '../src/features/ehr/locus/locusCatalog';
import { submitPriorAuth } from '../src/lib/integrations/prior-auth-adapter';

test('Clinical Assessment Catalog - PHQ-9 scoring & safety flag', () => {
  const phq9 = ASSESSMENT_CATALOG.find((i) => i.id === 'phq-9');
  assert.ok(phq9, 'PHQ-9 instrument must exist');
  
  // Test non-safety score
  const resultLow = phq9.calculateResult({ q1: 1, q2: 1, q3: 0, q9: 0 });
  assert.equal(resultLow.totalScore, 2);
  assert.equal(resultLow.severity, 'Minimal');
  assert.equal(resultLow.safetyFlagged, false);

  // Test PHQ-9 Item 9 safety trigger
  const resultFlag = phq9.calculateResult({ q1: 1, q2: 1, q9: 2 });
  assert.equal(resultFlag.totalScore, 4);
  assert.equal(resultFlag.safetyFlagged, true);
  assert.ok(resultFlag.interpretation.includes('CRITICAL'));
});

test('Clinical Assessment Catalog - C-SSRS Brief scoring & safety flags', () => {
  const cssrs = ASSESSMENT_CATALOG.find((i) => i.id === 'c-ssrs-brief');
  assert.ok(cssrs, 'C-SSRS Brief instrument must exist');

  const resultHigh = cssrs.calculateResult({ q1: 1, q2: 1, q4: 3 });
  assert.equal(resultHigh.safetyFlagged, true);
  assert.equal(resultHigh.severity, 'HIGH Suicide Risk');
});

test('Clinical Evaluation Templates - 8 Standard Templates Present', () => {
  assert.equal(EVALUATION_TEMPLATES.length, 12, 'Source evaluation types plus existing templates are retained');
  const ids = EVALUATION_TEMPLATES.map((t) => t.id);
  assert.ok(ids.includes('biopsychosocial'));
  assert.ok(ids.includes('psychiatric_eval'));
  assert.ok(ids.includes('mental_health_update'));
  assert.ok(ids.includes('crisis_evaluation'));
  assert.ok(ids.includes('sud_asam'));
  assert.ok(ids.includes('nursing_initial'));
  assert.ok(ids.includes('discharge_eval'));
  assert.ok(ids.includes('treatment_plan_eval'));
});

test('LOCUS / CALOCUS Catalog - Dimension scoring and Level of Care calculation', () => {
  assert.equal(LOCUS_DIMENSIONS.length, 7, 'LOCUS must have 7 dimension rating scales');

  // Test Level 1 calculation
  const lowLevel = calculateLocusLevelOfCare(10);
  assert.equal(lowLevel.level, 'Level 1');

  // Test Level 3 calculation
  const iopLevel = calculateLocusLevelOfCare(18);
  assert.equal(iopLevel.level, 'Level 3');

  // Test Level 6 inpatient calculation
  const inpatientLevel = calculateLocusLevelOfCare(29);
  assert.equal(inpatientLevel.level, 'Level 6');
});

test('Prior Authorization Adapter - explicit demo never grants payer approval', async (t) => {
  const before = process.env.CLINICAL_CLEARINGHOUSE_MODE;
  process.env.CLINICAL_CLEARINGHOUSE_MODE = 'demo';
  t.after(() => { if (before === undefined) delete process.env.CLINICAL_CLEARINGHOUSE_MODE; else process.env.CLINICAL_CLEARINGHOUSE_MODE = before; });
  const response = await submitPriorAuth({
    patientId: 'test-patient-1',
    patientName: 'Test Patient',
    dob: '1992-05-10',
    memberId: 'MEM-123456',
    payerId: 'CARE-01',
    payerName: 'Carelon Behavioral',
    vendor: 'Carelon',
    cptCodes: ['90837'],
    diagnosisCodes: ['F41.1'],
    startDate: '2026-09-15',
    endDate: '2027-03-15',
    requestedUnits: 12,
    clinicalRationale: 'Routine outpatient psychotherapy',
  });

  assert.ok(response.referenceNumber.startsWith('DEMO-'));
  assert.equal(response.status, 'PENDING_REVIEW');
  assert.equal(response.approvedUnits, undefined);
});
