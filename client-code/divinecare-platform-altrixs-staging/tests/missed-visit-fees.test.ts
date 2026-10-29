import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { isLateCancellation, isMedicaidCoverage, missedVisitFeeDecision, patientCancellationMessage } from '../src/lib/scheduling/missedVisitFees';

test('late cancel: inside the cancellation window only', () => {
  const now = new Date('2026-10-19T12:00:00Z');
  assert.equal(isLateCancellation(new Date('2026-10-20T11:00:00Z'), now, 24), true);
  assert.equal(isLateCancellation(new Date('2026-10-20T13:00:00Z'), now, 24), false);
  assert.equal(isLateCancellation(new Date('2026-10-19T13:00:00Z'), now, 0), false, 'window 0 = never late');
});

test('patient message: clear, says no fee was charged', () => {
  assert.equal(patientCancellationMessage(false, 24), 'Your appointment is cancelled.');
  const late = patientCancellationMessage(true, 24);
  assert.match(late, /late cancellation/);
  assert.match(late, /No fee has been charged/);
  assert.match(late, /24 hours/);
});

test('Medicaid / PBHS patients are never charged missed-visit fees', () => {
  for (const p of [
    { insuranceType: 'Medicaid' },
    { insurancePayer: 'Maryland Medicaid' },
    { insurancePayer: 'Carelon Behavioral Health of Maryland (PBHS)' },
    { insurancePayer: 'Priority Partners' },
    { insurancePayer: 'Maryland Physicians Care' },
    { insurancePayer: 'Wellpoint Maryland' },
    { insurancePayer: 'UnitedHealthcare Community Plan' },
  ]) {
    assert.equal(isMedicaidCoverage(p), true, JSON.stringify(p));
    assert.deepEqual(missedVisitFeeDecision(p, { feeEnabled: true }), { allowed: false, reason: 'medicaid_or_pbhs' });
  }
  assert.equal(isMedicaidCoverage({ insurancePayer: 'CareFirst BlueCross BlueShield', insuranceType: 'Commercial' }), false);
  assert.deepEqual(missedVisitFeeDecision({ insuranceType: 'Commercial', insurancePayer: 'Aetna' }, { feeEnabled: true }), { allowed: true });
  assert.deepEqual(missedVisitFeeDecision({}, { feeEnabled: true }), { allowed: false, reason: 'payer_unknown' });
  assert.deepEqual(missedVisitFeeDecision({ insuranceType: 'Commercial' }, { feeEnabled: false }), { allowed: false, reason: 'practice_setting_off' });
});

test('patient portal: book / reschedule check conflicts inside a locked transaction; cancel can be LATE_CANCEL', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/patient/application/appointments/service.ts'), 'utf8');
  assert.equal((src.match(/pg_advisory_xact_lock/g) || []).length, 2);
  assert.match(src, /hasScheduleConflict\(tx, clinician\.id/);
  assert.match(src, /late \? 'LATE_CANCEL' : 'CANCELLED'/);
});
