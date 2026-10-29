/**
 * Nightly chart-history prep (scripts/chart-digest-prep.ts + src/lib/ai/chartDigest/prep.ts) and
 * the bounded chunk concurrency of a single digest generation (concurrency.ts).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  PREP_DEFAULTS,
  digestKindForVisit,
  formatPrepSummary,
  needingPrep,
  parsePrepArgs,
  prepWindow,
  runPrep,
  selectPrepTargets,
  type PrepTarget,
} from '../src/lib/ai/chartDigest/prep';
import { chunkConcurrency, isRetryableError, mapLimit, withThrottleRetry } from '../src/lib/ai/chartDigest/concurrency';

const ROOT = path.join(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const TZ = 'America/New_York';
// Sunday 2026-10-25 21:00 ET (01:00 UTC Monday): "tomorrow" is Monday 2026-10-26 on the practice clock
const NOW = new Date('2026-10-26T01:00:00Z');
const et = (ymd: string, hh: string) => new Date(`${ymd}T${hh}:00-04:00`);

test('args: defaults (tomorrow, concurrency 4, $75, 200 clients) and bounds', () => {
  const a = parsePrepArgs([]);
  assert.deepEqual([a.days, a.concurrency, a.maxCostUsd, a.maxClients, a.apply, a.org], [1, 4, 75, 200, false, null]);
  assert.deepEqual(PREP_DEFAULTS, { days: 1, concurrency: 4, maxCostUsd: 75, maxClients: 200 });
  const b = parsePrepArgs(['--days=3', '--concurrency=50', '--max-cost=12.5', '--max-clients=10', '--apply', '--org=o1']);
  assert.deepEqual([b.days, b.concurrency, b.maxCostUsd, b.maxClients, b.apply, b.org], [3, 8, 12.5, 10, true, 'o1']);
  assert.equal(parsePrepArgs([], { DEFAULT_ORG: 'o2' }).org, 'o2');
});

test('window: tomorrow on the practice clock (and --days=N ahead)', () => {
  const w = prepWindow(NOW, TZ, 1);
  assert.deepEqual(w.dates, ['2026-10-26']);
  assert.equal(w.from.toISOString(), '2026-10-26T04:00:00.000Z');
  assert.equal(w.to.toISOString(), '2026-10-27T04:00:00.000Z');
  assert.deepEqual(prepWindow(NOW, TZ, 2).dates, ['2026-10-26', '2026-10-27']);
});

test('selection: tomorrow scheduled visits across clinicians, one target per client + kind (BH vs medical)', () => {
  const w = prepWindow(NOW, TZ, 1);
  const t = selectPrepTargets(
    [
      { clientId: 'c1', startsAt: et('2026-10-26', '09:00'), type: 'Individual Therapy', status: 'SCHEDULED', clinicianRole: 'THERAPIST' },
      { clientId: 'c1', startsAt: et('2026-10-26', '15:00'), type: 'Medication Management', status: 'SCHEDULED', clinicianRole: 'PSYCHIATRIST' },
      { clientId: 'c2', startsAt: et('2026-10-26', '10:00'), type: 'Telehealth', status: 'SCHEDULED', clinicianRole: 'PHYSICIAN' },
      { clientId: 'c3', startsAt: et('2026-10-26', '11:00'), type: 'Individual Therapy', status: 'CANCELLED' },
      { clientId: 'c4', startsAt: et('2026-10-27', '09:00'), type: 'Individual Therapy', status: 'SCHEDULED' },
      { clientId: 'c5', startsAt: et('2026-10-25', '20:00'), type: 'Individual Therapy', status: 'SCHEDULED' },
    ],
    w
  );
  assert.deepEqual(t.map((x) => [x.clientId, x.kind]), [['c1', 'bh'], ['c2', 'medical']]);
  assert.equal(digestKindForVisit({ type: 'Annual Physical' }), 'medical');
  assert.equal(digestKindForVisit({ type: 'Psychiatric Evaluation' }), 'bh');
});

test('staleness: only missing or stale digests are prepared, by kind', async () => {
  const targets: PrepTarget[] = [
    { clientId: 'c1', kind: 'bh', visitAt: NOW },
    { clientId: 'c2', kind: 'medical', visitAt: NOW },
    { clientId: 'c3', kind: 'bh', visitAt: NOW },
  ];
  const seen: string[] = [];
  const todo = await needingPrep(targets, async (t) => {
    seen.push(`${t.clientId}:${t.kind}`);
    return t.clientId === 'c1' ? 'fresh' : t.clientId === 'c2' ? 'stale' : 'missing';
  });
  assert.deepEqual(seen, ['c1:bh', 'c2:medical', 'c3:bh']);
  assert.deepEqual(todo.map((x) => [x.clientId, x.kind, x.reason]), [['c2', 'medical', 'stale'], ['c3', 'bh', 'missing']]);
});

const targetsN = (n: number): PrepTarget[] => Array.from({ length: n }, (_, i) => ({ clientId: `c${i}`, kind: 'bh' as const, visitAt: NOW }));

test('runner: bounded concurrency (never more than --concurrency in flight)', async () => {
  let inFlight = 0;
  let peak = 0;
  const s = await runPrep({
    targets: targetsN(12),
    concurrency: 3,
    maxCostUsd: 1000,
    maxClients: 100,
    async generate() {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return { status: 'generated', costUsd: 0.5 };
    },
  });
  assert.equal(peak, 3);
  assert.equal(s.maxInFlight, 3);
  assert.equal(s.generated, 12);
  assert.equal(s.costUsd, 6);
});

test('runner: the budget cap stops the run (no new client once the cap would be reached)', async () => {
  let calls = 0;
  const s = await runPrep({
    targets: targetsN(20),
    concurrency: 2,
    maxCostUsd: 10,
    maxClients: 100,
    estimateUsd: 3,
    async generate() {
      calls++;
      return { status: 'generated', costUsd: 3 };
    },
  });
  assert.ok(s.costUsd <= 10, `spent ${s.costUsd}`);
  assert.equal(s.budgetReached, true);
  assert.equal(calls, s.attempted);
  assert.ok(s.attempted < 20 && s.skippedByBudget === 20 - s.attempted);
  assert.equal(s.generated, 3);
});

test('runner: client cap, outcomes and failures counted; summary line has counts and dollars only', async () => {
  const s = await runPrep({
    targets: [...targetsN(4), { clientId: 'c0', kind: 'medical', visitAt: NOW }],
    concurrency: 4,
    maxCostUsd: 75,
    maxClients: 3,
    async generate(t) {
      if (t.clientId === 'c1') return { status: 'not_generated', costUsd: 0, reason: 'ai_consent_declined' };
      if (t.clientId === 'c2') throw new Error('Jordan Rivers boom');
      return { status: t.kind === 'medical' ? 'up_to_date' : 'generated', costUsd: 0.25 };
    },
  });
  assert.equal(s.skippedByClientCap, 1, 'c3 is beyond the 3-client cap; c0 medical is the same client as c0 bh');
  assert.deepEqual([s.generated, s.upToDate, s.notGenerated, s.failed], [1, 1, 1, 1]);
  assert.deepEqual(s.reasons, { ai_consent_declined: 1, Error: 1 });
  const line = formatPrepSummary(s, { org: 'org1' });
  assert.match(line, /generated=1 .*skippedByClientCap=1 .*cost=\$0\.5000/);
  assert.doesNotMatch(line, /Jordan|Rivers|boom|c[0-9]\b/);
});

test('chunk concurrency: mapLimit keeps order and the limit; throttling retried with backoff', async () => {
  let inFlight = 0;
  let peak = 0;
  const out = await mapLimit([5, 1, 4, 2, 3, 0], 4, async (n) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, n));
    inFlight--;
    return n * 10;
  });
  assert.deepEqual(out, [50, 10, 40, 20, 30, 0]);
  assert.equal(peak, 4);
  assert.equal(chunkConcurrency({}), 4);
  assert.equal(chunkConcurrency({ CHART_DIGEST_CONCURRENCY: '2' }), 2);

  let tries = 0;
  const sleeps: number[] = [];
  const v = await withThrottleRetry(
    async () => {
      tries++;
      if (tries < 3) throw Object.assign(new Error('slow down'), { name: 'ThrottlingException' });
      return 'ok';
    },
    { sleep: async (ms) => void sleeps.push(ms), random: () => 0.5 }
  );
  assert.equal(v, 'ok');
  assert.equal(tries, 3);
  assert.equal(sleeps.length, 2);
  assert.ok(sleeps[1] > sleeps[0], 'exponential backoff');
  await assert.rejects(withThrottleRetry(async () => { throw new TypeError('bad'); }, { sleep: async () => {} }), TypeError);
  assert.equal(isRetryableError({ $metadata: { httpStatusCode: 429 } }), true);
  assert.equal(isRetryableError(new Error('x')), false);
});

test('digest generation runs its chunk calls concurrently (bounded) in both services', () => {
  for (const f of ['src/lib/ai/chartDigest/service.ts', 'src/lib/ai/chartDigest/medical/service.ts']) {
    const s = read(f);
    assert.match(s, /mapLimit\(chunks, deps\.chunkConcurrency \?\? chunkConcurrency\(\)/, f);
    assert.match(s, /withThrottleRetry\(\(\) => deps\.invokeModel/, f);
    assert.doesNotMatch(s, /for \(const chunk of chunks\) \{\n\s+const hit/, `${f}: no sequential chunk loop`);
  }
});

test('script: counts only (never names), audited run record, lock, budget + concurrency flags', () => {
  const s = read('scripts/chart-digest-prep.ts');
  assert.match(s, /withJobLock\(JOB_LOCK_KEYS\.chartDigestPrep/);
  assert.match(s, /action: 'chart_digest_prep_run'/);
  assert.match(s, /runPrep\(\{/);
  assert.match(s, /maxCostUsd: args\.maxCostUsd/);
  assert.doesNotMatch(s, /\bname: true\b|clientName|legalFirstName/, 'never selects names');
  assert.doesNotMatch(s, /console\.log\([^)]*clientId/, 'never prints client ids');
  assert.match(read('src/lib/jobs/advisoryLock.ts'), /chartDigestPrep: 'job:chart-digest-prep'/);
});

test('crontab: the nightly prep line is present but COMMENTED OUT pending owner approval', () => {
  const cron = read('deploy/crontab.staging');
  const lines = cron.split('\n').filter((l) => l.includes('chart-digest-prep.ts'));
  assert.ok(lines.length >= 1);
  for (const l of lines) assert.match(l, /^#/, `must be commented: ${l}`);
  assert.match(cron, /install only after owner approval: 'install the nightly digest job'/);
  assert.match(cron, /# 0 1 \* \* \* altrixs cd \$APP && npx tsx .*scripts\/chart-digest-prep\.ts --apply/);
  assert.doesNotMatch(cron, /\r/, 'LF line endings');
});
