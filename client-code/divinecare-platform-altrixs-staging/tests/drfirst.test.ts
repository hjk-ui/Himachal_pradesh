import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDrFirstSettings, publicDrFirstStatus } from '../src/lib/drfirst/settings';
import { createDrFirstProvider } from '../src/lib/drfirst/factory';
import { MockDrFirstProvider } from '../src/lib/drfirst/mock-provider';
import { mapPatient, mapPrescriber } from '../src/lib/drfirst/mapping';
import { assertDrFirstPrescriber, assertDrFirstSelf } from '../src/lib/drfirst/access';
import { safeDrFirstError } from '../src/lib/drfirst/errors';
import { canUseClinicModule } from '../src/lib/modules/access';
import { createRequire } from 'node:module';
import { validateIntegrationResult, validateLaunchResult, getApprovedLaunchUrl, MOCK_LAUNCH_PATH } from '../src/lib/drfirst/validation';

const patient = { id: 'test-patient', organizationId: 'test-clinic', name: 'Test Patient', dateOfBirth: '2000-01-01' };
const prescriber = { id: 'test-provider', organizationId: 'test-clinic', name: 'Test Provider', npi: '1234567890' };
test('mock environment defaults safely and explicit environment is validated', () => {
  assert.equal(parseDrFirstSettings({ NODE_ENV: 'development' }).environment, 'mock');
  assert.ok(createDrFirstProvider(parseDrFirstSettings({ DRFIRST_ENABLED: 'true' })) instanceof MockDrFirstProvider);
  assert.throws(() => parseDrFirstSettings({ DRFIRST_ENV: 'invalid' }));
  assert.throws(() => parseDrFirstSettings({ DRFIRST_ENABLED: 'yes' }));
  assert.throws(() => parseDrFirstSettings({ NODE_ENV: 'production', DRFIRST_ENABLED: 'true' }));
});
test('disabled provider blocks operations', () => {
  assert.throws(() => createDrFirstProvider({ enabled: false, environment: 'mock' }), { code: 'DRFIRST_DISABLED' });
});
test('only prescribing roles can launch; cross-user impersonation is blocked', () => {
  for (const role of ['BILLING', 'ADMIN', 'DIRECTOR', 'THERAPIST', 'FRONT_DESK', 'CLINICIAN', 'SUPER_ADMIN', 'HR', 'PEER_SUPPORT', 'CASE_MANAGER', 'PRP_SPECIALIST'] as const) {
    assert.throws(() => assertDrFirstPrescriber({ userId: 'u', organizationId: 'o', role }), { code: 'DRFIRST_UNAUTHORIZED' });
  }
  for (const role of ['PSYCHIATRIST', 'NP'] as const) assert.doesNotThrow(() => assertDrFirstPrescriber({ userId: 'u', organizationId: 'o', role }));
  assert.throws(() => assertDrFirstSelf('another', { userId: 'u', organizationId: 'o', role: 'NP' }));
});
test('patient mapping rejects missing, future and invalid DOB', () => {
  for (const dateOfBirth of [null, new Date('invalid'), new Date('2999-01-01')]) assert.throws(() => mapPatient({ id: 'p', name: 'Test', dateOfBirth }, 'o'), { code: 'DRFIRST_PATIENT_INVALID' });
  assert.throws(() => mapPatient({ id: 'p', name: ' ', dateOfBirth: new Date('2000-01-01') }, 'o'));
  assert.equal(mapPatient({ id: 'p', name: 'Test', dateOfBirth: new Date('2000-01-01') }, 'o').dateOfBirth, '2000-01-01');
});
test('prescriber mapping accepts absent NPI and validates only supplied identifiers', () => {
  for (const npi of [undefined, null, '', ' ']) assert.equal(mapPrescriber({ id: 'u', name: 'Test', npi }, 'o').npi, undefined);
  assert.throws(() => mapPrescriber({ id: 'u', name: 'Test', npi: 'not-an-npi' }, 'o'), { code: 'DRFIRST_PRESCRIBER_INVALID' });
  assert.throws(() => mapPrescriber({ id: 'u', name: null, npi: '1234567890' }, 'o'));
  assert.equal(mapPrescriber(prescriber, 'o').npi, prescriber.npi);
});
test('config normalizes explicit selections without falling back in production', () => {
  const config = parseDrFirstSettings({ DRFIRST_ENV: ' MOCK ', DRFIRST_ENABLED: ' TRUE ', DRFIRST_MOCK_FAILURE: ' NONE ' });
  assert.equal(config.environment, 'mock'); assert.equal(config.enabled, true);
  for (const environment of [undefined, '', ' ']) assert.throws(() => parseDrFirstSettings({ NODE_ENV: 'production', DRFIRST_ENABLED: 'true', DRFIRST_ENV: environment }));
  for (const environment of ['staging', 'production'] as const) {
    const selected = parseDrFirstSettings({ NODE_ENV: 'production', DRFIRST_ENABLED: 'true', DRFIRST_ENV: environment });
    assert.equal(selected.environment, environment); assert.equal(selected.allowMockFailures, false);
    assert.throws(() => createDrFirstProvider(selected), { code: 'DRFIRST_NOT_CONFIGURED' });
  }
});
test('server-only config cannot load through an unguarded client/default Node entry', () => {
  const require = createRequire(import.meta.url);
  assert.throws(() => require('../src/lib/drfirst/config'), /cannot be imported from a Client Component/);
});
test('adapter boundary strips secrets and blocks cross-environment IDs and unsafe redirects', () => {
  const result = { externalId: 'mock_patient_test', environment: 'mock', mode: 'MOCK', accessToken: 'secret-marker', demographics: { name: 'Synthetic' } };
  assert.deepEqual(validateIntegrationResult(result, 'mock'), { externalId: result.externalId, environment: 'mock', mode: 'MOCK' });
  assert.throws(() => validateIntegrationResult(result, 'staging'));
  assert.throws(() => validateIntegrationResult({ ...result, environment: 'production', mode: 'LIVE' }, 'production'));
  const launch = { ...result, status: 'SIMULATED', launchUrl: MOCK_LAUNCH_PATH, expiresAt: new Date(Date.now() + 60_000).toISOString() };
  assert.equal(JSON.stringify(validateLaunchResult(launch, 'mock')).includes('secret-marker'), false);
  for (const launchUrl of ['javascript:alert(1)', '//untrusted.invalid', 'https://untrusted.invalid', `${MOCK_LAUNCH_PATH}?token=secret`, '/dashboard']) {
    assert.throws(() => validateLaunchResult({ ...launch, launchUrl }, 'mock'));
    assert.throws(() => getApprovedLaunchUrl(launchUrl, 'mock'));
  }
  for (const expiresAt of ['not-a-date', '2000-01-01T00:00:00.000Z', new Date(Date.now() + 600_000).toISOString()]) assert.throws(() => validateLaunchResult({ ...launch, expiresAt }, 'mock'));
});
test('authorized mock flow returns stable tenant-separated IDs and internal simulated launch', async () => {
  assertDrFirstPrescriber({ userId: prescriber.id, organizationId: 'test-clinic', role: 'NP' });
  const provider = new MockDrFirstProvider();
  const p = await provider.createOrSyncPatient(patient);
  assert.match(p.externalId, /^mock_patient_/);
  assert.deepEqual(p, await provider.createOrSyncPatient(patient));
  assert.notEqual(p.externalId, (await provider.createOrSyncPatient({ ...patient, organizationId: 'another-clinic' })).externalId);
  const u = await provider.createOrSyncPrescriber(prescriber);
  assert.match(u.externalId, /^mock_prescriber_/);
  const o = await provider.createOrSyncOrganization({ id: 'test-clinic', name: 'Test Clinic' });
  const launch = await provider.createSsoLaunchSession({ patient: p, prescriber: u, organization: o });
  assert.equal(launch.mode, 'MOCK'); assert.equal(launch.status, 'SIMULATED');
  assert.match(launch.externalId, /^mock_session_/);
  assert.equal(provider.getLaunchUrl(launch), '/dashboard/ehr/prescriptions/mock');
  assert.ok(Date.parse(launch.expiresAt) > Date.now());
});
for (const environment of ['staging', 'production'] as const) test(`${environment} fails closed without official implementation`, () => {
  assert.throws(() => createDrFirstProvider({ enabled: true, environment }), { code: 'DRFIRST_NOT_CONFIGURED' });
});
test('public status whitelists fields and never returns secrets', () => {
  const config = { enabled: true, environment: 'mock' as const, credentials: { password: 'test-secret-marker' } };
  // The mock is never reported as a configured DrFirst connection
  assert.deepEqual(publicDrFirstStatus(config), { enabled: true, environment: 'mock', configured: false, mock: true });
  assert.equal(JSON.stringify(publicDrFirstStatus(config)).includes('test-secret-marker'), false);
  assert.equal(publicDrFirstStatus({ enabled: true, environment: 'staging' }).configured, false);
});
test('configurable mock failures are deterministic and forbidden outside development mock', async () => {
  await assert.rejects(new MockDrFirstProvider().createOrSyncPatient({ ...patient, dateOfBirth: '2000-02-30' }), { code: 'DRFIRST_PATIENT_INVALID' });
  await assert.rejects(new MockDrFirstProvider('patient').createOrSyncPatient(patient), { code: 'DRFIRST_PATIENT_INVALID' });
  await assert.rejects(new MockDrFirstProvider('prescriber').createOrSyncPrescriber(prescriber), { code: 'DRFIRST_PRESCRIBER_INVALID' });
  await assert.rejects(new MockDrFirstProvider('unavailable').checkConnection(), { code: 'DRFIRST_EXTERNAL_SERVICE_ERROR' });
  assert.throws(() => parseDrFirstSettings({ NODE_ENV: 'production', DRFIRST_ENV: 'mock', DRFIRST_MOCK_FAILURE: 'patient' }));
  assert.throws(() => parseDrFirstSettings({ DRFIRST_ENV: 'staging', DRFIRST_MOCK_FAILURE: 'patient' }));
});
test('upstream error contents are redacted and internal storage is denied to generic module API', () => {
  assert.equal(safeDrFirstError(new Error('PHI or credential marker')).message.includes('marker'), false);
  for (const role of ['ADMIN', 'NP', 'BILLING'] as const) {
    assert.equal(canUseClinicModule(role, 'drfirst:mapping:mock:patient'), false);
    assert.equal(canUseClinicModule(role, 'drfirst-session'), false);
  }
});
