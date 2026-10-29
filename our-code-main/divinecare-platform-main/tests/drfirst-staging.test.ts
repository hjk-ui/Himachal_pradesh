import assert from 'node:assert/strict';
import { test } from 'node:test';
import Module, { createRequire } from 'node:module';
import { encryptDrFirstAuditEvent } from '../src/lib/drfirst/audit-crypto';
import { generateDrFirstMac } from '../src/lib/drfirst/mac';
import { buildRcopiaRequest, buildSendPatientRequest, parseNotificationCounts } from '../src/lib/drfirst/rcopia/xml';
import { parseDrFirstSettings, publicDrFirstStatus } from '../src/lib/drfirst/settings';
import { validateLaunchResult } from '../src/lib/drfirst/validation';
import type { DrFirstExchangeAuditEvent, IntegrationPatient } from '../src/lib/drfirst/types';

const endpoint = 'https://engine201.staging.drfirst.com/servlet/rcopia.servlet.EngineServlet';
const ssoUrl = 'https://orca.staging.drfirst.com/orca/auth/extLogin/v10';
const auditKey = 'ab'.repeat(32);

const stagingEnv = {
  DRFIRST_ENABLED: 'true',
  DRFIRST_ENV: 'staging',
  DRFIRST_ENGINE_URL: endpoint,
  DRFIRST_UPDATE_URL: 'https://update201.staging.drfirst.com/servlet/rcopia.servlet.EngineServlet',
  DRFIRST_SSO_URL: ssoUrl,
  DRFIRST_VENDOR_USERNAME: 'vendor-user',
  DRFIRST_VENDOR_PASSWORD: 'secret-key',
  DRFIRST_PRACTICE_USERNAME: 'practice-user',
  DRFIRST_PORTAL_SYSTEM_NAME: 'vendor-user',
  DRFIRST_AUDIT_ENCRYPTION_KEY: auditKey,
  DRFIRST_PRESCRIBER_MAP_JSON: JSON.stringify({ 'provider@example.com': 'provider1_practice' }),
  DRFIRST_PATIENT_MAP_JSON: JSON.stringify({ 'ALT-TEST-001': 'patient1' }),
};

const patient: IntegrationPatient = {
  id: 'patient-local', organizationId: 'clinic-1', name: 'Test Patient', firstName: 'Test', lastName: 'Patient',
  dateOfBirth: '1990-01-02', sex: 'F', addressLine1: '100 Test Ave', city: 'Bowie', state: 'MD',
  postalCode: '20715', phone: '(301) 555-0100', mrn: 'ALT-TEST-001',
};

async function stagingProviderModule() {
  const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
  const originalLoad = loader._load;
  loader._load = function(id, ...args) { if (id === 'server-only') return {}; return originalLoad.call(this, id, ...args); };
  const require = createRequire(import.meta.url);
  try { return require('../src/lib/drfirst/staging-provider') as typeof import('../src/lib/drfirst/staging-provider'); }
  finally { loader._load = originalLoad; }
}

test('DrFirst staging configuration requires exact allowlisted endpoints, encrypted audit key, and prescriber mapping', () => {
  const settings = parseDrFirstSettings(stagingEnv);
  assert.equal(settings.stagingConfigured, true);
  assert.deepEqual(publicDrFirstStatus(settings), { enabled: true, environment: 'staging', configured: true });

  assert.equal(parseDrFirstSettings({ ...stagingEnv, DRFIRST_AUDIT_ENCRYPTION_KEY: '' }).stagingConfigured, false);
  assert.equal(parseDrFirstSettings({ ...stagingEnv, DRFIRST_PRESCRIBER_MAP_JSON: '{}' }).stagingConfigured, false);
  for (const badSsoUrl of [
    'http://orca.staging.drfirst.com/orca/auth/extLogin/v10',
    'https://untrusted.example/orca/auth/extLogin/v10',
    'https://orca.staging.drfirst.com/other',
  ]) assert.throws(() => parseDrFirstSettings({ ...stagingEnv, DRFIRST_SSO_URL: badSsoUrl }));
});

test('DrFirst patient upload uses the v2.54 envelope, escapes XML, and never fabricates demographics', () => {
  const request = buildSendPatientRequest({ ...patient, firstName: 'Test &', lastName: '<Patient>' }, 'external-1');
  const xml = buildRcopiaRequest({
    apiVersion: '2.54', vendorUsername: 'vendor', vendorPassword: 'secret&', application: 'Altrixs',
    applicationVersion: '1.0.0', practiceUsername: 'practice', systemName: 'system',
  }, 'message-1', request);
  assert.match(xml, /<RCExtRequest version="2\.54">/);
  assert.match(xml, /<VendorPassword>secret&amp;<\/VendorPassword>/);
  assert.match(xml, /<Command>send_patient<\/Command>/);
  assert.match(xml, /<FirstName>Test &amp;<\/FirstName>/);
  assert.match(xml, /<LastName>&lt;Patient&gt;<\/LastName>/);
  assert.match(xml, /<DOB>01\/02\/1990<\/DOB>/);
  assert.doesNotMatch(buildSendPatientRequest({ ...patient, addressLine1: undefined }, 'external-1'), /<Address1>/);
});

test('DrFirst MAC covers raw ordered values and URL-encodes only after signing', () => {
  const signed = generateDrFirstMac({ action: 'login', rcopia_user_external_id: 'provider one', time: '010226030405' }, 'secret', ssoUrl);
  assert.match(signed.mac, /^[A-F0-9]{32}$/);
  assert.match(signed.fullUrl, /^https:\/\/orca\.staging\.drfirst\.com\/orca\/auth\/extLogin\/v10\?/);
  assert.match(signed.queryString, /rcopia_user_external_id=provider%20one/);
  assert.equal(signed.fullUrl.includes('secret'), false);
});

test('DrFirst staging provider maps enrolled users/patients and produces an approved short-lived SSO launch', async () => {
  const { StagingDrFirstProvider } = await stagingProviderModule();
  const events: DrFirstExchangeAuditEvent[] = [];
  const settings = parseDrFirstSettings(stagingEnv);
  const provider = new StagingDrFirstProvider(settings, async event => { events.push(event); }, async () => {
    throw new Error('Mapped staging patient must not be uploaded again');
  });
  const patientResult = await provider.createOrSyncPatient(patient);
  const prescriberResult = await provider.createOrSyncPrescriber({
    id: 'provider-local', organizationId: 'clinic-1', name: 'Provider One', email: 'provider@example.com',
  });
  const organizationResult = await provider.createOrSyncOrganization({ id: 'clinic-1', name: 'Clinic' });
  const launch = await provider.createSsoLaunchSession({ patient: patientResult, prescriber: prescriberResult, organization: organizationResult });
  assert.equal(patientResult.externalId, 'patient1');
  assert.equal(prescriberResult.externalId, 'provider1_practice');
  assert.equal(launch.status, 'READY');
  assert.equal(validateLaunchResult(launch, 'staging').launchUrl, launch.launchUrl);
  assert.equal(events.length, 1);
  assert.equal(events[0].operation, 'sso-launch');
});

test('DrFirst staging provider uploads an unmapped patient using one URL-encoded xml parameter', async () => {
  const { StagingDrFirstProvider } = await stagingProviderModule();
  const events: DrFirstExchangeAuditEvent[] = [];
  let calls = 0;
  const settings = parseDrFirstSettings({ ...stagingEnv, DRFIRST_PATIENT_MAP_JSON: '{}' });
  const provider = new StagingDrFirstProvider(settings, async event => { events.push(event); }, async (_url, init) => {
    calls++;
    const body = new URLSearchParams(String(init?.body));
    assert.deepEqual([...body.keys()], ['xml']);
    assert.match(body.get('xml') || '', /<Command>send_patient<\/Command>/);
    return new Response('<RCExtResponse><Status>success</Status></RCExtResponse>');
  });
  const result = await provider.createOrSyncPatient({ ...patient, mrn: 'UNMAPPED' });
  assert.match(result.externalId, /^altrixs_[a-f0-9]{24}$/);
  assert.equal(calls, 1);
  assert.equal(events[0].responseXml?.includes('<Status>success</Status>'), true);
});

test('DrFirst exchange audit payload is AES-256-GCM encrypted and rejects weak keys', () => {
  const marker = 'patient-and-secret-marker';
  const encrypted = encryptDrFirstAuditEvent({ operation: 'patient-upload', outcome: 'succeeded', responseXml: marker }, auditKey);
  assert.equal(JSON.stringify(encrypted).includes(marker), false);
  assert.equal(encrypted.algorithm, 'aes-256-gcm');
  assert.throws(() => encryptDrFirstAuditEvent({ operation: 'sso-launch', outcome: 'failed' }, 'weak'));
});

test('DrFirst notification counts are parsed by element name and ignore unknown or malformed entries', () => {
  const xml = '<?xml version="1.0"?><RCExtResponse><Response><NotificationCountList>' +
    '<NotificationCount><Number>2</Number><Type>refill</Type><Future>x</Future></NotificationCount>' +
    '<NotificationCount><Type>rx_change</Type><Number>3</Number></NotificationCount>' +
    '<NotificationCount><Type>refill</Type><Number>4</Number></NotificationCount>' +
    '<NotificationCount><Type>bad</Type><Number>-1</Number></NotificationCount>' +
    '</NotificationCountList></Response></RCExtResponse>';
  assert.deepEqual(parseNotificationCounts(xml), { refill: 6, rx_change: 3 });
});
