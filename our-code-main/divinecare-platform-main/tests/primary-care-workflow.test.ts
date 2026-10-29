import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  STANDING_ORDER_SEED,
  STANDING_ORDER_ATTESTATION,
  approvedStandingOrdersOnly,
} from '../src/lib/medical/standing-orders';
import { emptyPrimaryCareSettings } from '../src/lib/medical/primary-care-settings';

test('standing orders seed six draft POC tests with exact attestation', () => {
  assert.equal(STANDING_ORDER_SEED.length, 6);
  assert.ok(STANDING_ORDER_SEED.every((o) => o.status === 'draft'));
  assert.deepEqual(
    STANDING_ORDER_SEED.map((o) => o.cpt).sort(),
    ['81002', '81025', '82962', '87804', '87811', '87880'].sort()
  );
  assert.equal(STANDING_ORDER_ATTESTATION, 'I authorize medical assistants to perform this test under this standing order');
  assert.deepEqual(approvedStandingOrdersOnly(STANDING_ORDER_SEED as never), []);
});

test('primary care settings start empty (none on file)', () => {
  const s = emptyPrimaryCareSettings();
  assert.equal(s.notifyPatientWithinDays, null);
  assert.equal(s.labExpectedDays, null);
  assert.equal(s.referralReportDays, null);
  assert.equal(s.suggestedNotifyDays, 7);
  assert.equal(s.suggestedLabDays, 14);
  assert.equal(s.suggestedReferralDays, 30);
});
