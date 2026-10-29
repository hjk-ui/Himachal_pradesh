import test from 'node:test';
import assert from 'node:assert/strict';

test('Amazon Connect calling & communications suite', async (t) => {
  process.loadEnvFile('.env');
  const mod = await import('../src/lib/connect/service');

  await t.test('detects live Connect configuration from .env', () => {
    assert.equal(mod.isConnectLive(), true);
    const status = mod.getConnectStatus();
    assert.equal(status.live, true);
    assert.equal(status.demoMode, false);
    assert.equal(status.sourceLast4, '7110');
    assert.equal(status.hasQueue, true);
    assert.equal(status.region, 'us-east-1');
  });

  await t.test('US E.164 phone validation', () => {
    assert.equal(mod.isUsE164('+18447727110'), true);
    assert.equal(mod.isUsE164('+14155550142'), true);
    assert.equal(mod.isUsE164('4155550142'), false);
    assert.equal(mod.isUsE164('+447911123456'), false);
    assert.equal(mod.isUsE164(''), false);
    assert.equal(mod.isUsE164(null), false);
  });

  await t.test('connectSourceLast4 extracts last 4 digits', () => {
    assert.equal(mod.connectSourceLast4(), '7110');
  });

  await t.test('listCalls returns clinician names and durationSec', async () => {
    const calls = await mod.listCalls('cmssvv9oe0000wclg1wka3u5t', 'cmul4byrk0025wcgo6eryq5wf');
    assert.ok(Array.isArray(calls));
    assert.ok(calls.length > 0);
    const firstCall = calls[0];
    assert.ok('clinicianName' in firstCall);
    assert.ok('durationSec' in firstCall);
    assert.equal(firstCall.status, 'COMPLETED');
  });

  await t.test('updateCallStatus correctly persists completed status and duration', async () => {
    const updated = await mod.updateCallStatus({
      organizationId: 'cmssvv9oe0000wclg1wka3u5t',
      callId: 'cmup487h30005wcbceghkm78l',
      status: 'COMPLETED',
      durationSec: 185,
    });
    assert.ok(updated);
    assert.equal(updated.status, 'COMPLETED');
    const analysis = updated.analysisJson as Record<string, unknown>;
    assert.equal(analysis.durationSec, 185);
    assert.ok(analysis.endedAt);
  });

  await t.test('getCallAnalysis returns analysis object or demo fallback', async () => {
    const analysisRes = await mod.getCallAnalysis(
      'cmssvv9oe0000wclg1wka3u5t',
      '6ef9a88d-10ca-4975-9c8b-870e340f2533'
    );
    assert.ok(analysisRes);
    assert.ok(analysisRes.analysis);
    assert.ok(analysisRes.analysis.sentiment);
  });
});
