import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  shouldRegisterOnLaunch,
  missingDemographicsLabels,
} from '../src/lib/drfirst/register-on-launch';
import { parseDrFirstSettings } from '../src/lib/drfirst/settings';
import { PRODUCT_TTYS, MAX_NDCS } from '../src/lib/rxnorm/rxnav-client';
import {
  defaultGuardianAccessTier,
  proxyCanViewPart2,
  GUARDIAN_RELATIONSHIPS,
} from '../src/lib/clients/guardianAccess';
import { patientPaymentsLiveApproved } from '../src/lib/billing/patient-payments-gate';

test('DrFirst register-on-launch modes', () => {
  assert.equal(
    shouldRegisterOnLaunch('non_imported', { sourcePlatform: 'Valant', importedAt: new Date() }),
    'block'
  );
  assert.equal(shouldRegisterOnLaunch('non_imported', {}), 'register');
  assert.equal(
    shouldRegisterOnLaunch('true', { sourcePlatform: 'Valant', importedAt: new Date() }),
    'register'
  );
  assert.equal(shouldRegisterOnLaunch('off', {}), 'block');
  assert.equal(
    shouldRegisterOnLaunch('off', { rcopiaPatientId: 'rcopia-1' }),
    'use_existing'
  );
});

test('DrFirst demographics missing labels are human-readable', () => {
  const missing = missingDemographicsLabels({});
  assert.ok(missing.includes('Legal first name'));
  assert.ok(missing.includes('Date of birth'));
  assert.ok(missing.includes('ZIP code'));
});

test('parseDrFirstSettings reads register-on-launch', () => {
  const cfg = parseDrFirstSettings({
    DRFIRST_ENABLED: 'false',
    DRFIRST_REGISTER_ON_LAUNCH: 'non_imported',
  });
  assert.equal(cfg.registerOnLaunch, 'non_imported');
  const off = parseDrFirstSettings({ DRFIRST_ENABLED: 'false' });
  assert.equal(off.registerOnLaunch, 'off');
});

test('RxNorm product TTYs and NDC cap', () => {
  assert.deepEqual([...PRODUCT_TTYS].sort(), ['BPCK', 'GPCK', 'SBD', 'SCD']);
  assert.equal(MAX_NDCS, 10);
});

test('guardian age tiers and Part 2 hidden from proxies', () => {
  const child = new Date();
  child.setFullYear(child.getFullYear() - 8);
  const teen = new Date();
  teen.setFullYear(teen.getFullYear() - 15);
  const adult = new Date();
  adult.setFullYear(adult.getFullYear() - 20);
  assert.equal(defaultGuardianAccessTier(child), 'full');
  assert.equal(defaultGuardianAccessTier(teen), 'limited');
  assert.equal(defaultGuardianAccessTier(adult), 'aged_out');
  assert.equal(proxyCanViewPart2(true), false);
  assert.equal(proxyCanViewPart2(false), true);
  assert.deepEqual(GUARDIAN_RELATIONSHIPS, [
    'parent',
    'legal_guardian',
    'authorized_representative',
  ]);
});

test('patient payments live approval defaults off', () => {
  const prev = process.env.PATIENT_PAYMENTS_LIVE_APPROVED;
  delete process.env.PATIENT_PAYMENTS_LIVE_APPROVED;
  assert.equal(patientPaymentsLiveApproved(), false);
  process.env.PATIENT_PAYMENTS_LIVE_APPROVED = 'true';
  assert.equal(patientPaymentsLiveApproved(), true);
  if (prev === undefined) delete process.env.PATIENT_PAYMENTS_LIVE_APPROVED;
  else process.env.PATIENT_PAYMENTS_LIVE_APPROVED = prev;
});
