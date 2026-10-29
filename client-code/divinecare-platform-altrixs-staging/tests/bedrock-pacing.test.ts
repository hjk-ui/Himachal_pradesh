/**
 * Bedrock pacing (src/lib/ai/bedrockPacing.ts): calls stay under the account's per-minute quota and a
 * throttled call is retried; integration log entries name the feature and why the guardrail did not run.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_BEDROCK_RPM, RpmLimiter, bedrockRpm, bedrockThrottleRetries } from '../src/lib/ai/bedrockPacing';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

test('rpm setting: default 8 (under the quota of 10), env override, 0 turns pacing off', () => {
  assert.equal(DEFAULT_BEDROCK_RPM, 8);
  assert.equal(bedrockRpm('HAIKU', {}), 8);
  assert.equal(bedrockRpm('HAIKU', { BEDROCK_HAIKU_RPM: '40' }), 40);
  assert.equal(bedrockRpm('SONNET', { BEDROCK_HAIKU_RPM: '40' }), 8);
  assert.equal(bedrockRpm('SONNET', { BEDROCK_SONNET_RPM: '0' }), 0);
  assert.equal(bedrockRpm('SONNET', { BEDROCK_SONNET_RPM: 'abc' }), 8);
  assert.equal(bedrockThrottleRetries({}), 3);
  assert.equal(bedrockThrottleRetries({ BEDROCK_THROTTLE_RETRIES: '99' }), 6);
});

test('limiter: no more than rpm starts in any 60 seconds; later callers wait their turn in order', async () => {
  let clock = 0;
  const slept: number[] = [];
  const limiter = new RpmLimiter(3, () => clock, async (ms) => {
    slept.push(ms);
    clock += ms;
  });
  const starts: number[] = [];
  await Promise.all(
    Array.from({ length: 7 }, async () => {
      await limiter.acquire();
      starts.push(clock);
    })
  );
  assert.equal(starts.length, 7);
  for (const s of starts) assert.ok(starts.filter((t) => t >= s && t - s < 60_000).length <= 3, 'at most 3 starts per minute');
  assert.deepEqual(starts, [...starts].sort((a, b) => a - b));
  assert.ok(slept.length >= 2);
});

test('limiter with rpm 0 never waits', async () => {
  const limiter = new RpmLimiter(0, () => 0, async () => {
    throw new Error('should not sleep');
  });
  for (let i = 0; i < 20; i++) assert.equal(await limiter.acquire(), 0);
});

test('invokeBedrock paces and retries throttles; log says not_run_throttled / not_run_error, never a bare error', () => {
  const src = read('src/lib/ai/bedrockService.ts');
  assert.match(src, /bedrockLimiter\(opts\.model\)\.acquire\(\)/);
  assert.match(src, /withThrottleRetry\(/);
  assert.match(src, /'not_run_throttled'/);
  assert.match(src, /'not_run_error'/);
  assert.doesNotMatch(src, /meta\(blocked \? err\.reason : 'error'\)/);
});

test('background AI callers label their log entries', () => {
  assert.match(read('src/lib/ai/chartDigest/store.ts'), /feature: kind === 'medical' \? 'chart_digest_medical' : 'chart_digest'/);
  assert.match(read('src/lib/clinical/sudRadar/scan.ts'), /logContext: \{ feature: 'sud_radar' \}/);
  assert.match(read('src/lib/ai/previsit/prismaSource.ts'), /logContext: \{ feature: 'previsit_brief' \}/);
});
