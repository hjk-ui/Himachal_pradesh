import assert from 'node:assert/strict';
import test from 'node:test';
import {
  claimPatientCents,
  lateCancelRate,
  noShowRate,
  pickCopayRule,
  providerTypeForRole,
  sumKind,
} from '../src/lib/billing/patientReference';

const base = {
  id: 'c1',
  status: 'READY',
  payer: 'Medicaid',
  amountCents: 10000,
  patientResponsibility: null,
  frequencyCode: null,
  primaryClaimId: null,
  eraProcessedAt: null,
};

test('draft, frequency 8, and a primary with a live secondary contribute nothing', () => {
  const secondary = { ...base, id: 'c2', primaryClaimId: 'c1', status: 'SUBMITTED' };
  assert.equal(claimPatientCents({ ...base, status: 'DRAFT' }, [base]), 0);
  assert.equal(claimPatientCents({ ...base, frequencyCode: '8' }, [base]), 0);
  assert.equal(claimPatientCents(base, [base, secondary]), 0);
});

test('patient responsibility is dollars converted to cents, and self-pay without an ERA uses the charge', () => {
  assert.equal(claimPatientCents({ ...base, patientResponsibility: 25.5 }, [base]), 2550);
  assert.equal(claimPatientCents({ ...base, payer: 'Self Pay', amountCents: 4000 }, [base]), 4000);
  assert.equal(claimPatientCents(base, [base]), 0);
});

test('copay picks CPT, then provider type, then a blank rule, and does not invent a fallback amount', () => {
  const rules = [
    { payerName: 'Medicaid', providerType: '', cptRule: '', amountCents: 1000, source: 'valant' },
    { payerName: 'Medicaid', providerType: 'THERAPIST', cptRule: '', amountCents: 2000, source: 'valant' },
    { payerName: 'Medicaid', providerType: '', cptRule: '90837', amountCents: 3000, source: 'valant' },
  ];
  assert.equal(providerTypeForRole('CLINICIAN'), 'THERAPIST');
  assert.equal(pickCopayRule(rules, 'Medicaid', 'THERAPIST', '90837').copay?.amountCents, 3000);
  assert.equal(pickCopayRule(rules, 'Medicaid', 'THERAPIST', null).copay?.specificity, 'provider');
  assert.equal(pickCopayRule([], 'Medicaid', 'THERAPIST', null).reason, 'no-rules');
  assert.equal(pickCopayRule(rules, '', 'THERAPIST', null).reason, 'payer-unknown');
  assert.equal(pickCopayRule(rules, 'Aetna', 'THERAPIST', null).reason, 'no-matching-rule');
});

test('active ledger kinds sum separately and visit rates use kept visits', () => {
  const rows = [
    { kind: 'opening_balance', amountCents: 5000, asOf: new Date('2026-01-01') },
    { kind: 'prepayment_credit', amountCents: -1500, asOf: new Date('2026-01-02') },
    { kind: 'manual_adjustment', amountCents: 200, asOf: new Date('2026-01-03') },
  ];
  assert.equal(sumKind(rows, 'opening_balance'), 5000);
  assert.equal(sumKind(rows, 'prepayment_credit'), -1500);
  assert.equal(noShowRate(8, 2), 0.2);
  assert.equal(lateCancelRate(8, 2, 2), 2 / 12);
  assert.equal(noShowRate(0, 0), null);
});
