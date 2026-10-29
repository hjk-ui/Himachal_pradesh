/**
 * Admin > Integrations > Logs (owner 2026-10-26, DrFirst support request): one append-only
 * integration call log with central redaction, metadata-only rows for SMS / email / AI, a
 * DrFirst payload viewer + vendor download (patient identifiers masked by default), audited views
 * and downloads, ADMIN / PRACTICE_DIRECTOR only, 90-day payload / 1-year metadata retention.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  isSecretKey,
  maskPatientIdentifiers,
  prettyPrintXml,
  redactSecrets,
  redactValue,
  sanitizeErrorMessage,
} from '../src/lib/integrations/callLog/redact';
import {
  buildIntegrationCallRow,
  normalizeOperation,
  recordIntegrationCall,
  setIntegrationLogWriter,
  withIntegrationCall,
  type IntegrationCallRow,
} from '../src/lib/integrations/callLog/record';
import { instrumentAwsClient } from '../src/lib/integrations/callLog/awsInstrument';
import { stripeOperation } from '../src/lib/integrations/callLog/stripeInstrument';
import {
  AUDIT_INTEGRATION_LOG_DOWNLOAD,
  AUDIT_INTEGRATION_LOG_VIEW,
  buildLogWhere,
  buildTiles,
  canViewIntegrationLogs,
  healthState,
  loadIntegrationLogDetail,
  parseLogFilters,
  retentionCutoffs,
  selectForPurge,
  type DetailDeps,
  type LogRowView,
} from '../src/lib/integrations/callLog/view';
import { canAccessPath } from '../src/lib/auth/roleAccess';

const ROOT = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ─── Redaction ────────────────────────────────────────────────────────────────

test('redaction: passwords, vendor pass, tokens, MAC, Authorization, card numbers, SSN', () => {
  const xml =
    '<RCExtRequest><Caller><VendorName>avendor</VendorName><VendorPassword>s3cr3t!</VendorPassword></Caller>' +
    '<Password>hunter2</Password><AccessToken>abc.def</AccessToken></RCExtRequest>';
  const out = redactSecrets(xml);
  assert.doesNotMatch(out, /s3cr3t!|hunter2|abc\.def/);
  assert.match(out, /<VendorPassword>\[redacted\]<\/VendorPassword>/);

  const sso = 'https://web.drfirst.com/sso/portalServices?rcopia_user_id=x&time=1&MAC=ABCDEF0123456789&skip_auth=n';
  assert.match(redactSecrets(sso), /MAC=\[redacted\]&skip_auth=n/);
  assert.doesNotMatch(redactSecrets(sso), /ABCDEF0123456789/);

  assert.doesNotMatch(redactSecrets('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl'), /eyJ|c2lnbmF0dXJl/);
  assert.doesNotMatch(redactSecrets('{"authorization":"Basic dXNlcjpwYXNz"}'), /dXNlcjpwYXNz/);
  assert.doesNotMatch(redactSecrets('GET /x?api_key=AKIDKEY123&access_token=tok123'), /AKIDKEY123|tok123/);
  assert.doesNotMatch(redactSecrets('{"password": "pa55word", "vendor_pass": "vp"}'), /pa55word|"vp"/);
  assert.match(redactSecrets('key AKIAABCDEFGHIJKLMNOP used'), /\[aws-key\]/);
  assert.match(redactSecrets('sk_live_abcdefghijkl1234 and whsec_abcdefgh1234'), /\[stripe-key\] and \[stripe-key\]/);

  // Luhn-valid card numbers (grouped or not) are removed; a non-Luhn number is not
  assert.match(redactSecrets('card 4242 4242 4242 4242 declined'), /card \[card\] declined/);
  assert.match(redactSecrets('pan=4111111111111111'), /\[card\]|\[redacted\]/);
  assert.match(redactSecrets('claim 1234567890123'), /1234567890123/);
  assert.match(redactSecrets('ssn 123-45-6789 on file'), /ssn \[ssn\] on file/);
});

test('redaction: secret key names are replaced whatever the value; nested values scrubbed', () => {
  for (const k of ['password', 'vendorPassword', 'VENDOR_PASS', 'apiKey', 'x-api-key', 'Authorization', 'accessToken', 'mac', 'cardNumber', 'cvc', 'ssn', 'client_secret', 'signature']) {
    assert.ok(isSecretKey(k), k);
  }
  for (const k of ['operation', 'inputTokens', 'outputTokens', 'model', 'fileName', 'status']) assert.ok(!isSecretKey(k), k);
  const v = redactValue({ a: { password: 'x', note: 'Bearer abcdefghijkl' }, list: ['ssn 123-45-6789'] }) as Record<string, any>;
  assert.equal(v.a.password, '[redacted]');
  assert.doesNotMatch(JSON.stringify(v), /abcdefghijkl|123-45-6789/);
});

test('error messages: secrets, emails and phones removed; Prisma query text withheld; bounded length', () => {
  const m = sanitizeErrorMessage(new Error('550 mailbox jane.doe@example.com unavailable; call (410) 555-1212; token=abc123'));
  assert.ok(m);
  assert.doesNotMatch(m!, /jane\.doe|555-1212|abc123/);
  const prismaErr = Object.assign(new Error('Invalid `prisma.client.findMany()` invocation: where { lastName: "Smith" }'), { code: 'P2010' });
  assert.equal(sanitizeErrorMessage(prismaErr), 'Database query failed P2010');
  assert.ok((sanitizeErrorMessage('x'.repeat(2000)) || '').length <= 500);
  assert.equal(sanitizeErrorMessage(null), null);
});

test('patient masking for vendor downloads keeps vendor ids, masks demographics', () => {
  const xml =
    '<Patient><RcopiaID>123</RcopiaID><ExternalID>cl_9</ExternalID><FirstName>Jane</FirstName><LastName>Doe</LastName>' +
    '<DOB>01/02/1980</DOB><Address1>1 Main St</Address1><HomePhone>4105551212</HomePhone><Email>j@x.com</Email></Patient>';
  const out = maskPatientIdentifiers(xml);
  assert.doesNotMatch(out, /Jane|Doe|1980|Main St|4105551212|j@x\.com/);
  assert.match(out, /<RcopiaID>123<\/RcopiaID>/);
  assert.match(out, /<ExternalID>cl_9<\/ExternalID>/);
  const pretty = prettyPrintXml('<a><b>1</b><c><d>2</d></c></a>');
  assert.equal(pretty, '<a>\n  <b>1</b>\n  <c>\n    <d>2</d>\n  </c>\n</a>');
});

// ─── recordIntegrationCall ────────────────────────────────────────────────────

test('recordIntegrationCall: row shape, operation normalized, duration from startedAt', async () => {
  const rows: IntegrationCallRow[] = [];
  setIntegrationLogWriter(async (r) => {
    rows.push(r);
  });
  try {
    const startedAt = new Date(Date.now() - 250);
    const row = await recordIntegrationCall({
      integration: 'drfirst',
      operation: 'send_patient',
      status: 'error',
      organizationId: 'org1',
      actorUserId: 'u1',
      clientId: 'c1',
      httpStatus: 200,
      vendorStatus: 'error',
      errorCode: 'E1',
      errorMessage: 'bad <VendorPassword>pw</VendorPassword>',
      startedAt,
      correlationId: 'corr-1',
      sourceTable: 'drfirst_api_logs',
      sourceId: '00000000-0000-0000-0000-000000000001',
    });
    assert.ok(row);
    assert.equal(rows.length, 1);
    const r = rows[0];
    for (const k of ['id', 'createdAt', 'startedAt', 'finishedAt', 'organizationId', 'integration', 'operation', 'direction', 'status', 'httpStatus', 'vendorStatus', 'errorCode', 'errorMessage', 'durationMs', 'correlationId', 'actorUserId', 'clientId', 'sourceTable', 'sourceId', 'metadata']) {
      assert.ok(k in r, k);
    }
    assert.equal(r.direction, 'outbound');
    assert.ok((r.durationMs ?? 0) >= 200);
    assert.doesNotMatch(r.errorMessage || '', />pw</);
    assert.equal(normalizeOperation('InvokeModelCommand'), 'invoke_model');
    assert.equal(normalizeOperation('get /locations/0b5f2a43-1c1d-4a5e-9a61-1234567890ab/shifts'), 'get_/locations/:id/shifts');
  } finally {
    setIntegrationLogWriter(null);
  }
});

test('SMS / email / AI rows never carry a body, prompt, output or address', () => {
  const sms = buildIntegrationCallRow({
    integration: 'sms',
    operation: 'send_sms',
    status: 'success',
    metadata: { template: 'appointment_reminder', channel: 'sms', body: 'Your visit with Dr X', to: '+14105551212', phone: '+14105551212' },
  });
  assert.deepEqual(sms.metadata, { template: 'appointment_reminder', channel: 'sms' });
  const email = buildIntegrationCallRow({
    integration: 'email',
    operation: 'send_email',
    status: 'success',
    metadata: { template: 'invite', subject: 'Results for Jane', html: '<p>x</p>', text: 'x', to: 'a@b.com', recipientCount: 1 },
  });
  assert.deepEqual(email.metadata, { template: 'invite', recipientCount: 1 });
  const ai = buildIntegrationCallRow({
    integration: 'bedrock',
    operation: 'invoke_model',
    status: 'success',
    metadata: { model: 'sonnet', inputTokens: 10, outputTokens: 20, guardrailOutcome: 'passed', prompt: 'PHI', userPrompt: 'PHI', system: 's', output: 'o', completion: 'c' },
  });
  assert.deepEqual(ai.metadata, { model: 'sonnet', inputTokens: 10, outputTokens: 20, guardrailOutcome: 'passed' });

  // Call sites: the SMS / email / Bedrock log calls pass template / model metadata only
  const smsSrc = read('src/lib/sms/send.ts');
  assert.match(smsSrc, /recordIntegrationCall\(/);
  assert.match(smsSrc, /metadata: \{ template: context, channel: extra\.channel \}/);
  const mailSrc = read('src/lib/email/smtp.ts');
  assert.match(mailSrc, /integration: 'email', operation: 'send_email'/);
  assert.doesNotMatch(mailSrc.slice(mailSrc.indexOf('const logSend'), mailSrc.indexOf('try {', mailSrc.indexOf('const logSend'))), /input\.(subject|text|html)\b/);
  const bedrockSrc = read('src/lib/ai/bedrockService.ts');
  const metaFn = bedrockSrc.slice(bedrockSrc.indexOf('const meta = (guardrailOutcome'), bedrockSrc.indexOf('try {', bedrockSrc.indexOf('const meta = (guardrailOutcome')));
  assert.doesNotMatch(metaFn, /userPrompt|opts\.system|\btext\b|grounding\.source/);
});

test('recordIntegrationCall never throws; withIntegrationCall records success and error (rethrown)', async () => {
  setIntegrationLogWriter(async () => {
    throw new Error('db down');
  });
  assert.equal(await recordIntegrationCall({ integration: 'cron', operation: 'x', status: 'success' }), null);
  const rows: IntegrationCallRow[] = [];
  setIntegrationLogWriter(async (r) => {
    rows.push(r);
  });
  try {
    assert.equal(await withIntegrationCall({ integration: 'cron', operation: 'job-a', direction: 'job' }, async () => 7), 7);
    await assert.rejects(
      withIntegrationCall({ integration: 'cron', operation: 'job-b', direction: 'job' }, async () => {
        throw Object.assign(new Error('Rate exceeded'), { name: 'ThrottlingException' });
      })
    );
    assert.deepEqual(rows.map((r) => [r.operation, r.status, r.direction]), [['job-a', 'success', 'job'], ['job-b', 'throttled', 'job']]);
  } finally {
    setIntegrationLogWriter(null);
  }
});

test('AWS middleware records command, status and request id, never the input', async () => {
  const rows: IntegrationCallRow[] = [];
  setIntegrationLogWriter(async (r) => {
    rows.push(r);
  });
  try {
    type Mw = (next: (a: unknown) => Promise<unknown>, ctx: { commandName?: string }) => (a: unknown) => Promise<unknown>;
    let mw: Mw | null = null;
    const client = { middlewareStack: { add: (m: Mw) => { mw = m; } } };
    instrumentAwsClient(client, 'textract');
    assert.ok(mw);
    const handler = (mw as unknown as Mw)(async () => ({ output: { $metadata: { httpStatusCode: 200, requestId: 'req-1' } } }), { commandName: 'DetectDocumentTextCommand' });
    await handler({ input: { Document: { Bytes: 'PHI' } } });
    await new Promise((r) => setImmediate(r));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].operation, 'detect_document_text');
    assert.equal(rows[0].correlationId, 'req-1');
    assert.doesNotMatch(JSON.stringify(rows[0]), /PHI/);
    assert.equal(stripeOperation('POST', '/v1/customers/cus_ABC123def/sources'), 'post_/v1/customers/:id/sources');
  } finally {
    setIntegrationLogWriter(null);
  }
});

// ─── Access, audit, download ──────────────────────────────────────────────────

test('access: ADMIN / PRACTICE_DIRECTOR only (page rule + API gate)', () => {
  for (const r of ['ADMIN', 'PRACTICE_DIRECTOR']) {
    assert.ok(canViewIntegrationLogs(r), r);
    assert.ok(canAccessPath(r, '/dashboard/admin/integrations/logs'), r);
  }
  for (const r of ['HR', 'BILLING', 'FRONT_DESK', 'OFFICE_MANAGER', 'DIRECTOR', 'THERAPIST', 'CLINICIAN', 'PSYCHIATRIST']) {
    assert.ok(!canViewIntegrationLogs(r), r);
    assert.ok(!canAccessPath(r, '/dashboard/admin/integrations/logs'), r);
  }
  const list = read('src/app/api/admin/integrations/logs/route.ts');
  const detail = read('src/app/api/admin/integrations/logs/[id]/route.ts');
  assert.match(list, /requireFullAdmin\(\)/);
  assert.match(detail, /requireFullAdmin\(\)/);
});

const ROW: LogRowView = {
  id: '11111111-2222-3333-4444-555555555555',
  createdAt: new Date('2026-10-26T12:00:01Z'),
  startedAt: new Date('2026-10-26T12:00:00Z'),
  finishedAt: new Date('2026-10-26T12:00:01Z'),
  organizationId: 'org1',
  integration: 'drfirst',
  operation: 'send_patient',
  direction: 'outbound',
  status: 'error',
  httpStatus: 200,
  vendorStatus: 'error',
  errorCode: 'E100',
  errorMessage: 'Patient not found',
  durationMs: 812,
  correlationId: 'trace-77',
  actorUserId: 'u1',
  clientId: 'c1',
  sourceTable: 'drfirst_api_logs',
  sourceId: '99999999-2222-3333-4444-555555555555',
  metadata: null,
};
const PAYLOAD = '<RCExtResponse><Caller><VendorPassword>pw1</VendorPassword></Caller><Patient><RcopiaID>7</RcopiaID><FirstName>Jane</FirstName><LastName>Doe</LastName></Patient></RCExtResponse>';

function fakeDeps(audits: Array<{ action: string; metadata: Record<string, unknown>; resourceId: string }>): DetailDeps {
  return {
    findLog: async (id, org) => (id === ROW.id && org === 'org1' ? ROW : null),
    findPayload: async () => ({ kind: 'response', text: PAYLOAD }),
    writeAudit: async (e) => {
      audits.push(e);
    },
  };
}

test('detail view is audited (ids only) and masked by default; unmasked on request; never shows vendor password', async () => {
  const audits: Array<{ action: string; metadata: Record<string, unknown>; resourceId: string }> = [];
  const caller = { userId: 'u9', role: 'ADMIN', organizationId: 'org1' };
  const res = await loadIntegrationLogDetail(fakeDeps(audits), caller, { id: ROW.id });
  assert.equal(res.ok, true);
  assert.equal(res.masked, true);
  assert.doesNotMatch(res.payload?.text || '', /Jane|Doe|pw1/);
  assert.match(res.payload?.text || '', /<RcopiaID>7<\/RcopiaID>/);
  assert.equal(audits[0].action, AUDIT_INTEGRATION_LOG_VIEW);
  assert.equal(audits[0].resourceId, ROW.id);
  assert.doesNotMatch(JSON.stringify(audits[0].metadata), /Jane|Doe|Patient not found|VendorPassword/);

  const open = await loadIntegrationLogDetail(fakeDeps(audits), caller, { id: ROW.id, masked: false });
  assert.match(open.payload?.text || '', /Jane/);
  assert.doesNotMatch(open.payload?.text || '', /pw1/);
  assert.equal(audits[1].metadata.masked, false);

  // other practice / non-admin / bad id
  assert.equal((await loadIntegrationLogDetail(fakeDeps(audits), { ...caller, organizationId: 'org2' }, { id: ROW.id })).status, 404);
  assert.equal((await loadIntegrationLogDetail(fakeDeps(audits), { ...caller, role: 'BILLING' }, { id: ROW.id })).status, 403);
  assert.equal((await loadIntegrationLogDetail(fakeDeps(audits), caller, { id: 'x' })).status, 400);
  assert.equal(audits.length, 2);
});

test('vendor download: audited as DOWNLOAD, masked by default, includes correlation id, timestamps, operation', async () => {
  const audits: Array<{ action: string; metadata: Record<string, unknown>; resourceId: string }> = [];
  const res = await loadIntegrationLogDetail(fakeDeps(audits), { userId: 'u9', role: 'PRACTICE_DIRECTOR', organizationId: 'org1' }, { id: ROW.id, download: true });
  assert.equal(res.ok, true);
  assert.equal(audits[0].action, AUDIT_INTEGRATION_LOG_DOWNLOAD);
  assert.equal(audits[0].metadata.masked, true);
  const text = res.text || '';
  assert.match(text, /Correlation id:\s+trace-77/);
  assert.match(text, /Operation:\s+send_patient/);
  assert.match(text, /Started \(UTC\):\s+2026-10-26T12:00:00\.000Z/);
  assert.match(text, /Patient identifiers: MASKED/);
  assert.doesNotMatch(text, /Jane|Doe|pw1/);
  assert.match(res.fileName || '', /^altrixs-drfirst-send_patient-.*\.txt$/);
});

// ─── Retention, filters, health ───────────────────────────────────────────────

test('retention: payload bodies 90 days, metadata 1 year; purge selection', () => {
  const now = new Date('2026-10-26T00:00:00Z');
  const c = retentionCutoffs(now, {});
  assert.equal(c.payloadDays, 90);
  assert.equal(c.metadataDays, 365);
  const d = (n: number) => new Date(now.getTime() - n * 86_400_000);
  const rows = [
    { id: 'a', createdAt: d(10), hasPayload: true },
    { id: 'b', createdAt: d(100), hasPayload: true },
    { id: 'c', createdAt: d(100), hasPayload: false },
    { id: 'd', createdAt: d(400), hasPayload: true },
  ];
  const s = selectForPurge(rows, now, {});
  assert.deepEqual(s.deleteRows.map((r) => r.id), ['d']);
  assert.deepEqual(s.dropPayloads.map((r) => r.id), ['b']);
  assert.match(read('scripts/integration-logs-purge.ts'), /purgeRcopiaLogs\(\)/);
  assert.match(read('prisma/migrations/20261026_integration_call_log.sql'), /CREATE TABLE IF NOT EXISTS "integration_call_logs"/);
});

test('filters: parsed safely and always org-scoped', () => {
  const f = parseLogFilters(new URLSearchParams('integration=waystar&status=error&operation=SFTP&from=2026-10-01&to=2026-10-26&page=2&pageSize=9999&mrn=A100'));
  assert.equal(f.integration, 'waystar');
  assert.equal(f.status, 'error');
  assert.equal(f.operation, 'sftp');
  assert.equal(f.pageSize, 200);
  assert.equal(f.page, 2);
  const bad = parseLogFilters(new URLSearchParams('integration=evil&status=drop'));
  assert.equal(bad.integration, null);
  assert.equal(bad.status, null);
  const where = buildLogWhere(f, 'org1', []) as { AND: Array<Record<string, unknown>> };
  assert.deepEqual(where.AND[0], { OR: [{ organizationId: 'org1' }, { organizationId: null }] });
  assert.ok(JSON.stringify(where).includes('__none__'), 'unknown MRN matches nothing');
});

test('health: OK / degraded / failing / idle by last-hour error rate', () => {
  assert.equal(healthState(0, 0), 'idle');
  assert.equal(healthState(10, 0), 'ok');
  assert.equal(healthState(10, 2), 'degraded');
  assert.equal(healthState(10, 5), 'failing');
  const tiles = buildTiles({
    counts24h: [{ integration: 'sms', status: 'success', count: 8 }, { integration: 'sms', status: 'error', count: 2 }],
    counts1h: [{ integration: 'sms', status: 'error', count: 1 }],
    lastSuccess: [{ integration: 'sms', at: new Date('2026-10-26T10:00:00Z') }],
    lastError: [{ integration: 'sms', at: new Date('2026-10-26T11:00:00Z'), message: 'boom' }],
  });
  const sms = tiles.find((t) => t.integration === 'sms')!;
  assert.equal(sms.errorRate24h, 20);
  assert.equal(sms.health, 'failing');
  assert.equal(sms.lastError, 'boom');
  assert.equal(tiles.length, 13);
});

// ─── Page ─────────────────────────────────────────────────────────────────────

test('page: filters, health card, tiles, scroll-wrapped table, drawer with copy + masked vendor download; linked from Admin + Settings', () => {
  const page = read('src/app/dashboard/admin/integrations/logs/page.tsx');
  for (const f of ['Integration', 'Operation', 'Status', 'From', 'To', 'Patient MRN', 'User']) assert.match(page, new RegExp(`>${f}<`), f);
  assert.match(page, /Integration health/);
  assert.match(page, /overflow-x-auto/);
  assert.match(page, /role="dialog"/);
  assert.match(page, /aria-modal="true"/);
  assert.match(page, /Download for vendor support/);
  assert.match(page, /download=1&masked=\$\{masked \? '1' : '0'\}/);
  assert.match(page, /useState\(true\)/, 'masked by default');
  assert.match(page, /<Copy className/);
  assert.match(page, /Newer/);
  assert.match(page, /Older/);
  assert.doesNotMatch(page, /[\u{1F300}-\u{1FAFF}]/u, 'no emoji');
  assert.match(read('src/app/dashboard/admin/page.tsx'), /href="\/dashboard\/admin\/integrations\/logs"/);
  assert.match(read('src/app/dashboard/settings/page.tsx'), /href="\/dashboard\/admin\/integrations\/logs"/);
});

test('call boundaries are instrumented', () => {
  const checks: Array<[string, RegExp]> = [
    ['src/lib/drfirst/persistence.ts', /integration: 'drfirst'/],
    ['src/lib/billing/waystarSftpSubmit.ts', /operation: 'sftp_upload_837p'/],
    ['src/lib/billing/waystarInbound/retrieval.ts', /operation: 'sftp_retrieve'/],
    ['src/lib/integrations/availity/http.ts', /integration: 'availity'/],
    ['src/lib/hr/homebase/client.ts', /integration: 'homebase'/],
    ['src/lib/stripe/client.ts', /instrumentStripe\(/],
    ['src/lib/patientPayments/stripeGateway.ts', /instrumentStripe\(/],
    ['src/app/api/webhooks/stripe/route.ts', /direction: 'webhook'/],
    ['src/lib/docIntake/ocr.ts', /'textract'\)/],
    ['src/lib/scribe/uploadAws.ts', /'transcribe'\)/],
    ['src/lib/telehealth/chime.ts', /'chime'\)/],
    ['src/lib/healthlake/client.ts', /integration: 'healthlake'/],
    ['src/lib/jobs/advisoryLock.ts', /integration: 'cron'/],
  ];
  for (const [file, re] of checks) assert.match(read(file), re, file);
});
