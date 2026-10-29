import assert from 'node:assert/strict';
import { test } from 'node:test';
import Module, { createRequire } from 'node:module';
import { DrFirstError } from '../src/lib/drfirst/errors';
import { parseFdbSettings, publicFdbStatus, requireFdbSettings } from '../src/lib/drfirst/fdb/settings';
import { drugAllergySearchSchema } from '../src/lib/drfirst/fdb/validation';
import { buildDrugAllergySearchXml, escapeXmlText, parseDrugAllergySearchResponse } from '../src/lib/drfirst/fdb/xml';
import type { FdbSettings } from '../src/lib/drfirst/fdb/types';

const configured: FdbSettings & {
  endpoint: string; vendorName: string; vendorPassword: string; practiceUsername: string; systemName: string;
} = {
  enabled: true,
  configured: true,
  endpoint: 'https://engine101.staging.drfirst.com/servlet/rcopia.servlet.EngineServlet',
  vendorName: 'vendor<&',
  vendorPassword: 'password&<secret>',
  application: 'Altrixs',
  applicationVersion: '1.0.0',
  practiceName: 'Practice',
  station: 'Station',
  practiceUsername: 'practice-user',
  systemName: 'altrixs',
  apiVersion: '2.54',
};

test('FDB settings are disabled by default, redact credentials, and allow only DrFirst HTTPS engine URLs', () => {
  const disabled = parseFdbSettings({});
  assert.deepEqual(publicFdbStatus(disabled), { enabled: false, configured: false, apiVersion: '2.54' });
  assert.throws(() => requireFdbSettings(disabled), { code: 'DRFIRST_NOT_CONFIGURED' });
  for (const url of [
    'http://engine101.staging.drfirst.com/servlet/rcopia.servlet.EngineServlet',
    'https://untrusted.example/servlet/rcopia.servlet.EngineServlet',
    'https://engine101.staging.drfirst.com/other',
    'https://engine101.staging.drfirst.com/servlet/rcopia.servlet.EngineServlet?target=x',
  ]) assert.throws(() => parseFdbSettings({ DRFIRST_FDB_URL: url }));
  const parsed = parseFdbSettings({
    DRFIRST_FDB_ENABLED: 'true', DRFIRST_FDB_URL: configured.endpoint,
    DRFIRST_FDB_VENDOR_NAME: 'vendor', DRFIRST_FDB_VENDOR_PASSWORD: 'secret-marker',
    DRFIRST_FDB_PRACTICE_USERNAME: 'practice', DRFIRST_FDB_SYSTEM_NAME: 'system',
  });
  assert.equal(parsed.configured, true);
  assert.equal(JSON.stringify(publicFdbStatus(parsed)).includes('secret-marker'), false);
});

test('DrFirst certification: API version is mandatory, valid, and defaults to current v2.54', () => {
  assert.equal(parseFdbSettings({}).apiVersion, '2.54');
  assert.equal(parseFdbSettings({ DRFIRST_FDB_API_VERSION: '2.12' }).apiVersion, '2.12');
  for (const apiVersion of ['0.9', '0.0', 'latest', '2', '2.54-beta']) {
    assert.throws(
      () => parseFdbSettings({ DRFIRST_FDB_API_VERSION: apiVersion }),
      { code: 'DRFIRST_NOT_CONFIGURED' },
    );
  }
});

test('DrFirst certification: all documented non-production regional engine URLs are configurable', () => {
  for (const endpoint of [
    'https://engine101.staging.drfirst.com/servlet/rcopia.servlet.EngineServlet',
    'https://engine201.staging.drfirst.com/servlet/rcopia.servlet.EngineServlet',
    'https://engine.demo.drfirst.com/servlet/rcopia.servlet.EngineServlet',
  ]) {
    const settings = parseFdbSettings({ DRFIRST_FDB_URL: endpoint });
    assert.equal(settings.endpoint, endpoint);
  }
});

test('DrFirst certification: drug allergy search accepts two searchable characters and maximum 1-200', () => {
  assert.deepEqual(
    drugAllergySearchSchema.parse({ searchString: '  am  ', maximum: 200 }),
    { searchString: 'am', maximum: 200 },
  );
  assert.equal(drugAllergySearchSchema.parse({ searchString: 'A 1', maximum: 1 }).searchString, 'A 1');

  for (const input of [
    { searchString: 'a' },
    { searchString: 'a-' },
    { searchString: ' & ' },
    { searchString: 'am', maximum: 0 },
    { searchString: 'am', maximum: 201 },
    { searchString: 'am', maximum: 1.5 },
    { searchString: 'am', unexpected: true },
  ]) assert.equal(drugAllergySearchSchema.safeParse(input).success, false);
});

test('FDB request XML escapes values before the complete message is form encoded', () => {
  assert.equal(escapeXmlText('a<&>b'), 'a&lt;&amp;&gt;b');
  const xml = buildDrugAllergySearchXml(configured, { requestMessageId: 'message-1', searchString: 'amox & <test>', maximum: 50 });
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?><RCExtRequest version="2\.54">/);
  assert.match(xml, /<VendorName>vendor&lt;&amp;<\/VendorName>/);
  assert.match(xml, /<SearchString>amox &amp; &lt;test&gt;<\/SearchString>/);
  assert.match(xml, /<Command>search_drug_allergy<\/Command>/);
  assert.equal(new URLSearchParams({ xml }).get('xml'), xml);
  assert.throws(() => escapeXmlText('invalid\u0000value'), { code: 'DRFIRST_INVALID_INPUT' });
});

test('DrFirst certification: Maximum is optional and only serialized when supplied', () => {
  const withoutMaximum = buildDrugAllergySearchXml(configured, {
    requestMessageId: 'message-optional',
    searchString: 'am',
  });
  assert.doesNotMatch(withoutMaximum, /<Maximum>/);

  const withMaximum = buildDrugAllergySearchXml(configured, {
    requestMessageId: 'message-limited',
    searchString: 'am',
    maximum: 200,
  });
  assert.match(withMaximum, /<Maximum>200<\/Maximum>/);
});

test('FDB response parsing is tag-order independent and tolerates missing optional tags', () => {
  const xml = `<?xml version="1.0"?><RCExtResponse><Warning><Text>More results are available.</Text><Code>truncated</Code></Warning><DrugList><Drug>
    <Strength>20 mg</Strength><GenericName>Example generic</GenericName><RcopiaID>123</RcopiaID>
    <DrugGroupList><DrugGroup><GroupName>Example allergy</GroupName><GroupID>g1</GroupID></DrugGroup></DrugGroupList>
    <Ingredient><FirstDataBankMedID>f1</FirstDataBankMedID><RxnormIDType>SCD</RxnormIDType><RxnormID>r1</RxnormID></Ingredient>
  </Drug><Drug><BrandName>Brand only</BrandName></Drug></DrugList></RCExtResponse>`;
  const result = parseDrugAllergySearchResponse(xml);
  assert.equal(result.drugs.length, 2);
  assert.equal(result.drugs[0].genericName, 'Example generic');
  assert.equal(result.drugs[0].strength, '20 mg');
  assert.deepEqual(result.drugs[0].allergyGroups, [{ groupId: 'g1', groupName: 'Example allergy' }]);
  assert.deepEqual(result.drugs[0].ingredients, [{ rxNormId: 'r1', rxNormIdType: 'SCD', firstDataBankMedId: 'f1' }]);
  assert.deepEqual(result.warnings, [{ code: 'truncated', text: 'More results are available.' }]);
  assert.equal(result.drugs[1].rcopiaId, undefined);
  assert.throws(() => parseDrugAllergySearchResponse('<R><Error><Code>bad_provider_id</Code></Error></R>'), { code: 'DRFIRST_UPSTREAM_REJECTED' });
  assert.throws(() => parseDrugAllergySearchResponse('<!DOCTYPE r><r/>'), { code: 'DRFIRST_EXTERNAL_SERVICE_ERROR' });
});

test('DrFirst certification: documented warning messages and the 200-result safety cap are preserved', () => {
  const warningTexts = [
    'Search results exceed the system maximum; more results are available.',
    'Search results were truncated per request; more results are available.',
    'No drugs found.',
  ];
  const drugs = Array.from({ length: 201 }, (_, index) =>
    `<Drug><RcopiaID>${index + 1}</RcopiaID><RxnormIDType>${['BPCK', 'SBD', 'GPCK', 'SCD'][index % 4]}</RxnormIDType></Drug>`,
  ).join('');
  const warnings = warningTexts.map(text => `<Warning><Code></Code><Text>${text}</Text></Warning>`).join('');
  const result = parseDrugAllergySearchResponse(`<RCExtResponse>${warnings}<DrugList>${drugs}</DrugList></RCExtResponse>`);

  assert.equal(result.drugs.length, 200);
  assert.deepEqual(result.drugs.slice(0, 4).map(drug => drug.rxNormIdType), ['BPCK', 'SBD', 'GPCK', 'SCD']);
  assert.deepEqual(result.warnings.map(warning => warning.text), warningTexts);
});

test('FDB client sends one URL-encoded xml parameter and does not retry HTTP or valid XML errors', async () => {
  const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
  const originalLoad = loader._load;
  loader._load = function(id, ...args) { if (id === 'server-only') return {}; return originalLoad.call(this, id, ...args); };
  const require = createRequire(import.meta.url);
  let FdbClient: typeof import('../src/lib/drfirst/fdb/client').FdbClient;
  try { ({ FdbClient } = require('../src/lib/drfirst/fdb/client')); } finally { loader._load = originalLoad; }

  let calls = 0;
  const client = new FdbClient(configured, async (_input, init) => {
    calls++;
    assert.equal(init?.method, 'POST');
    assert.equal(new URLSearchParams(String(init?.body)).has('xml'), true);
    return new Response('<RCExtResponse><DrugList><Drug><BrandName>Amox</BrandName></Drug></DrugList></RCExtResponse>', { status: 200, headers: { 'content-type': 'application/xml' } });
  });
  assert.equal((await client.searchDrugAllergy('amox', 50)).drugs[0].brandName, 'Amox');
  assert.equal(calls, 1);

  calls = 0;
  const rejected = new FdbClient(configured, async () => { calls++; return new Response('<R><Error><Code>bad_provider_id</Code></Error></R>'); });
  await assert.rejects(rejected.searchDrugAllergy('amox'), { code: 'DRFIRST_UPSTREAM_REJECTED' });
  assert.equal(calls, 1);

  calls = 0;
  const httpFailure = new FdbClient(configured, async () => { calls++; return new Response('', { status: 503 }); });
  await assert.rejects(httpFailure.searchDrugAllergy('amox'), (error: unknown) => error instanceof DrFirstError);
  assert.equal(calls, 1);
});

test('FDB client retries only timeouts, at most three times after the initial request', async () => {
  const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
  const originalLoad = loader._load;
  loader._load = function(id, ...args) { if (id === 'server-only') return {}; return originalLoad.call(this, id, ...args); };
  const require = createRequire(import.meta.url);
  let FdbClient: typeof import('../src/lib/drfirst/fdb/client').FdbClient;
  try { ({ FdbClient } = require('../src/lib/drfirst/fdb/client')); } finally { loader._load = originalLoad; }
  let calls = 0;
  const client = new FdbClient(configured, async () => {
    calls++;
    if (calls < 4) throw new DOMException('timed out', 'TimeoutError');
    return new Response('<RCExtResponse><DrugList/></RCExtResponse>');
  });
  assert.deepEqual(await client.searchDrugAllergy('amox'), { drugs: [], warnings: [] });
  assert.equal(calls, 4);
});
