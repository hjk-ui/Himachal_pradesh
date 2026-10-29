import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { scopedKey, serverTiming, TimeoutError, TtlCache, withTimeout } from '../src/lib/perf/cache';
import { loadAllSections, loadSection, SECTION_TIMEOUT_ERROR, type InboxActor, type InboxDeps } from '../src/lib/inbox/core';
import { inboxSectionCache, invalidateInboxForOrg } from '../src/lib/inbox/cacheStore';
import { INBOX_SECTIONS, sectionsForRole } from '../src/lib/inbox/sections';
import type { InboxDraft, InboxSectionKey, InboxSectionResult } from '../src/lib/inbox/types';

// Synthetic ids and names only; no real patient data.

const NOW = new Date('2026-10-18T16:00:00Z');
const ROOT = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function draft(over: Partial<InboxDraft> = {}): InboxDraft {
  return {
    entityKey: 'x:1',
    title: 'Item',
    detail: 'detail',
    clientId: 'client-a',
    clientName: 'Test Client A',
    priority: 'normal',
    since: NOW.toISOString(),
    href: '/dashboard/alerts',
    hrefLabel: 'Open',
    action: null,
    ...over,
  };
}

/** Loaders return rows tagged with the viewer, and count their calls */
function viewerDeps(cache: TtlCache<InboxSectionResult>, calls: Record<string, number>, slow: Partial<Record<InboxSectionKey, number>> = {}): InboxDeps {
  const loaders = Object.fromEntries(
    INBOX_SECTIONS.map((s) => [
      s.key,
      async (actor: InboxActor) => {
        calls[`${actor.userId}:${s.key}`] = (calls[`${actor.userId}:${s.key}`] ?? 0) + 1;
        if (slow[s.key]) await sleep(slow[s.key] as number);
        return { drafts: [draft({ entityKey: `${s.key}:${actor.userId}`, clientName: `Client of ${actor.userId}` })] };
      },
    ])
  ) as unknown as InboxDeps['loaders'];
  return { loaders, lockedClientIds: async () => new Set<string>(), cache };
}

// ─── Keys ──────────────────────────────────────────────────────────────────────

test('cache keys are scoped by organization, user and role', () => {
  const base = { organizationId: 'org-1', userId: 'user-1', role: 'THERAPIST' };
  const k = scopedKey(base, 'inbox', 'alerts');
  assert.notEqual(k, scopedKey({ ...base, organizationId: 'org-2' }, 'inbox', 'alerts'));
  assert.notEqual(k, scopedKey({ ...base, userId: 'user-2' }, 'inbox', 'alerts'));
  assert.notEqual(k, scopedKey({ ...base, role: 'ADMIN' }, 'inbox', 'alerts'), 'role preview gets its own entry');
  assert.notEqual(k, scopedKey(base, 'inbox', 'tasks'));
  assert.equal(k, scopedKey({ ...base, role: 'therapist' }, 'inbox', 'alerts'), 'role case does not matter');
  // A separator inside an id cannot forge another viewer's key
  assert.notEqual(scopedKey({ organizationId: 'a|b', userId: 'c', role: 'R' }), scopedKey({ organizationId: 'a', userId: 'b|c', role: 'R' }));
  assert.throws(() => scopedKey({ organizationId: '', userId: 'u', role: 'R' }));
  assert.throws(() => scopedKey({ organizationId: 'o', userId: '', role: 'R' }));
  assert.throws(() => scopedKey({ organizationId: 'o', userId: 'u', role: '' }));
});

// ─── TtlCache ────────────────────────────────────────────────────────────────

test('TtlCache: expiry, shared in-flight computation, failures and opted-out values not cached', async () => {
  let now = 1_000;
  const cache = new TtlCache<number>(100, 10, () => now);
  let runs = 0;
  const compute = async () => {
    runs += 1;
    await sleep(5);
    return runs;
  };
  const [a, b] = await Promise.all([cache.getOrCompute('k', compute), cache.getOrCompute('k', compute)]);
  assert.equal(runs, 1, 'concurrent callers share one computation');
  assert.equal(a, 1);
  assert.equal(b, 1);
  assert.equal(await cache.getOrCompute('k', compute), 1, 'cached');
  now += 101;
  assert.equal(await cache.getOrCompute('k', compute), 2, 'recomputed after the TTL');
  assert.equal(await cache.getOrCompute('k', compute, { fresh: true }), 3, 'fresh bypasses the cache');

  await assert.rejects(cache.getOrCompute('bad', async () => { throw new Error('boom'); }));
  assert.equal(cache.get('bad'), undefined, 'a failure is not cached');
  await cache.getOrCompute('skip', async () => 7, { shouldCache: () => false });
  assert.equal(cache.get('skip'), undefined);

  cache.set('org-1|u|R|x', 1);
  cache.set('org-10|u|R|x', 1);
  cache.deletePrefix('org-1|');
  assert.equal(cache.get('org-1|u|R|x'), undefined);
  assert.equal(cache.get('org-10|u|R|x'), 1, 'prefix delete does not touch a similar org id');
});

test('withTimeout rejects with TimeoutError; Server-Timing header carries names and durations only', async () => {
  await assert.rejects(withTimeout(sleep(50).then(() => 1), 5, 'slow'), (e: unknown) => e instanceof TimeoutError);
  assert.equal(await withTimeout(Promise.resolve(2), 50), 2);
  const t = serverTiming();
  await t.time('db', async () => sleep(1));
  t.record('inbox alerts', 12.34, 'hit');
  const h = t.header();
  assert.match(h, /^db;dur=\d+(\.\d)?, inbox_alerts;dur=12\.3;desc="hit", total;dur=/);
});

// ─── Inbox: shared cache, no cross-user leakage ─────────────────────────────────

test('inbox cache: summary and items share one computation; another user never gets the first user\'s rows', async () => {
  const cache = new TtlCache<InboxSectionResult>(60_000);
  const calls: Record<string, number> = {};
  const deps = viewerDeps(cache, calls);
  const alice: InboxActor = { organizationId: 'org-1', userId: 'alice', role: 'THERAPIST' };
  const bob: InboxActor = { organizationId: 'org-1', userId: 'bob', role: 'THERAPIST' };

  // Summary and items on the same page load, concurrently
  await Promise.all([loadAllSections(alice, deps, NOW), loadAllSections(alice, deps, NOW)]);
  for (const s of sectionsForRole('THERAPIST')) assert.equal(calls[`alice:${s.key}`], 1, s.key);

  const again = await loadSection(alice, 'tasks', deps, NOW);
  assert.equal(calls['alice:tasks'], 1, 'served from cache');
  assert.equal(again.items[0].clientDisplay, 'Client of alice');

  const forBob = await loadSection(bob, 'tasks', deps, NOW);
  assert.equal(calls['bob:tasks'], 1, 'bob computes his own section');
  assert.equal(forBob.items[0].clientDisplay, 'Client of bob');
  assert.ok(!JSON.stringify(forBob).includes('alice'), 'no rows from another viewer');

  // Same user, other role (role preview) and other org are separate entries
  await loadSection({ ...alice, role: 'ADMIN' }, 'tasks', deps, NOW);
  await loadSection({ ...alice, organizationId: 'org-2' }, 'tasks', deps, NOW);
  assert.equal(calls['alice:tasks'], 3);
});

test('inbox cache: fail-closed Part 2 results and loader failures are not cached', async () => {
  const cache = new TtlCache<InboxSectionResult>(60_000);
  const calls: Record<string, number> = {};
  const deps = viewerDeps(cache, calls);
  const actor: InboxActor = { organizationId: 'org-1', userId: 'carol', role: 'THERAPIST' };
  deps.lockedClientIds = async () => {
    throw new Error('lookup down');
  };
  const locked = await loadSection(actor, 'tasks', deps, NOW);
  assert.equal(locked.items[0].protected, true, 'fail closed');
  deps.lockedClientIds = async () => new Set<string>();
  const open = await loadSection(actor, 'tasks', deps, NOW);
  assert.equal(calls['carol:tasks'], 2, 'the fail-closed result was not cached');
  assert.equal(open.items[0].protected, false);

  deps.loaders.messages = async () => {
    throw new Error('db');
  };
  const failed = await loadSection(actor, 'messages', deps, NOW);
  assert.ok(failed.error);
  assert.equal(cache.get(`org-1|carol|THERAPIST|inbox|messages`), undefined);
});

test('inbox: a slow section times out to a partial result, the others load, and it fills the cache when done', async () => {
  const cache = new TtlCache<InboxSectionResult>(60_000);
  const calls: Record<string, number> = {};
  const deps = { ...viewerDeps(cache, calls, { session_frequency: 80 }), timeoutMs: 20 };
  const actor: InboxActor = { organizationId: 'org-1', userId: 'dana', role: 'THERAPIST' };
  const outcomes: Record<string, string> = {};
  deps.onTiming = (key, _ms, outcome) => {
    outcomes[key] = outcome;
  };
  const started = Date.now();
  const results = await loadAllSections(actor, deps, NOW);
  assert.ok(Date.now() - started < 70, 'the slow section does not hold the inbox');
  const slow = results.find((r) => r.key === 'session_frequency')!;
  assert.equal(slow.error, SECTION_TIMEOUT_ERROR);
  assert.equal(slow.items.length, 0);
  assert.equal(outcomes.session_frequency, 'timeout');
  for (const r of results.filter((x) => x.key !== 'session_frequency')) assert.equal(r.error, null, r.key);

  await sleep(100);
  const later = await loadSection(actor, 'session_frequency', deps, NOW);
  assert.equal(later.error, null);
  assert.equal(later.items.length, 1);
  assert.equal(calls['dana:session_frequency'], 1, 'the timed-out run completed and was reused');
  assert.equal(outcomes.session_frequency, 'hit');
});

test('invalidateInboxForOrg drops only that organization\'s inbox entries', () => {
  inboxSectionCache.clear();
  const r: InboxSectionResult = { key: 'alerts', items: [], notice: null, error: null };
  inboxSectionCache.set(scopedKey({ organizationId: 'org-1', userId: 'u1', role: 'ADMIN' }, 'inbox', 'alerts'), r);
  inboxSectionCache.set(scopedKey({ organizationId: 'org-1', userId: 'u2', role: 'THERAPIST' }, 'inbox', 'alerts'), r);
  inboxSectionCache.set(scopedKey({ organizationId: 'org-10', userId: 'u3', role: 'ADMIN' }, 'inbox', 'alerts'), r);
  invalidateInboxForOrg('org-1');
  assert.equal(inboxSectionCache.size, 1);
  inboxSectionCache.clear();
});

// ─── Wiring (source checks) ───────────────────────────────────────────────────

test('wiring: DrFirst badge never blocks on Rcopia; heavy endpoints send Server-Timing; writes invalidate the inbox', () => {
  const badge = read('src/app/api/drfirst/notifications/route.ts');
  assert.match(badge, /withTimeout\(live, LIVE_TIMEOUT_MS/);
  assert.match(badge, /syncedCounts\(c\)/);
  assert.match(badge, /scopedKey\(\{ organizationId: c\.organizationId, userId: c\.userId, role: c\.role \}/);
  for (const f of [
    'src/app/api/drfirst/notifications/route.ts',
    'src/app/api/inbox/summary/route.ts',
    'src/app/api/inbox/items/route.ts',
    'src/app/api/dashboard/home/route.ts',
    'src/app/api/ehr/scanner/service-eligibility/route.ts',
    'src/app/api/ehr/scanner/sud-radar/route.ts',
  ]) {
    assert.match(read(f), /'Server-Timing': timing\.header\(\)/, f);
  }
  assert.match(read('src/app/api/risk-alerts/[id]/review/route.ts'), /invalidateInboxForOrg\(gate\.organizationId\)/);
  assert.match(read('src/app/api/clinical/mbc/alerts/route.ts'), /invalidateInboxForOrg\(gate\.organizationId\)/);
  // MBC alerts read only flagged / over-threshold rows
  assert.match(read('src/lib/clinical/mbcAlerts.ts'), /mbcAlertWhere\(\)/);
  const sql = read('prisma/migrations/20261018_perf_indexes.sql');
  assert.ok(!/DROP|DELETE|UPDATE /.test(sql.replace(/--.*$/gm, '')), 'indexes only');
  assert.equal((sql.match(/CREATE INDEX IF NOT EXISTS/g) || []).length, 9);
});
