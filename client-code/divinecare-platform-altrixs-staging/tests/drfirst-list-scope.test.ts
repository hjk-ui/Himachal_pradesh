import assert from 'node:assert/strict';
import { test } from 'node:test';
import Module, { createRequire } from 'node:module';

/**
 * /api/drfirst/review-status and /api/drfirst/pdmp-events without ?patient: every downloaded row is
 * stored (practice-level compliance trail), but the response lists only clients on the caller's
 * caseload (clientAccessWhere) that pass the 42 CFR Part 2 / sensitive lock (lockedSensitiveClientIds).
 * Synthetic ids only; no database or network.
 */
test('DrFirst list mode: caseload + Part 2 scope on review-status and pdmp-events', async (t) => {
  const gate = { ok: true, userId: 'np1', organizationId: 'org1', role: 'NP', status: 401 };
  const caseload = new Set(['a', 'c']); // np1's caseload; 'b' is another clinician's client
  const lockedRecords = new Set(['c']); // Part 2 record, np1 not whitelisted, no grant
  let sensitiveFails = false;
  let cursorSaves = 0;
  const stored: { table: string; clientId: string }[] = [];
  const audits: Array<Record<string, unknown>> = [];

  const db = {
    user: { findUnique: async () => ({ rcopiaUsername: 'doc1', npi: '1234567890', name: 'Synthetic Prescriber' }) },
    client: {
      findMany: async ({ where }: { where: { AND: [{ id: { in: string[] } }, unknown] } }) => {
        const ids = where.AND[0].id.in;
        const caseloadScoped = JSON.stringify(where.AND[1]).includes('assignedToId');
        return ids.filter((id) => !caseloadScoped || caseload.has(id)).map((id) => ({ id }));
      },
      findFirst: async ({ where }: { where: { id: string } }) => (caseload.has(where.id) ? { id: where.id, rcopiaPatientId: null } : null),
    },
    sensitiveRecord: {
      findMany: async ({ where }: { where: { clientId: { in: string[] } } }) => {
        if (sensitiveFails) throw new Error('db down');
        return where.clientId.in.filter((id) => lockedRecords.has(id)).map((clientId) => ({ clientId, reason: 'PART_2', alias: null, accessWhitelist: [] }));
      },
      findFirst: async ({ where }: { where: { clientId: string } }) => (lockedRecords.has(where.clientId) ? { id: 's1', accessWhitelist: [] } : null),
    },
    breakTheGlassGrant: { findMany: async () => [], findFirst: async () => null },
    sensitiveAccessLog: { create: async () => ({}) },
    rcopiaMedRecAttestation: {
      findFirst: async () => null,
      create: async ({ data }: { data: { clientId: string } }) => { stored.push({ table: 'medrec', clientId: data.clientId }); },
    },
    marylandPdmpAudit: {
      findFirst: async () => null,
      create: async ({ data }: { data: { clientId: string } }) => { stored.push({ table: 'pdmp', clientId: data.clientId }); },
    },
  };

  const review = (id: string) => ({
    patientExternalId: id,
    medication: { complete: true, reviews: [{ reviewerUsername: 'doc1', reviewDate: '2026-10-01T10:00:00Z', reviewerNpi: '1234567890' }] },
    allergy: { reviews: [] },
    problem: { reviews: [] },
  });
  const pdmp = (id: string) => ({ patientExternalId: id, reviewerUsername: 'doc1', reviewDate: '2026-10-01T10:00:00Z', reviewerNpi: '1234567890' });
  const commands = {
    getReviewStatus: async () => ({ ok: true, statuses: ['a', 'b', 'c'].map(review), nextCursor: 'next' }),
    getPdmpEvents: async () => ({ ok: true, events: ['a', 'b', 'c'].map(pdmp), nextCursor: 'next' }),
  };
  const sync = {
    buildClientResolver: async () => (ref: { patientExternalId?: string }) => ref.patientExternalId ?? null,
    downloadWindow: async () => ({ throttled: false, retryAfterSeconds: 0, cursor: 'c0', save: async () => { cursorSaves += 1; return true; } }),
    loadOrgPrescribers: async () => new Map(),
    parseRcopiaDate: (s: string) => (s ? new Date(s) : null),
  };

  const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
  const originalLoad = loader._load;
  loader._load = function (id, ...args) {
    if (id === 'server-only') return {};
    if (id === '@/lib/db/prisma') return { prisma: db };
    if (id === '@/lib/auth/tenant') return { requireOrgContext: async () => gate };
    if (id === '@/lib/services/drfirstCommands') return commands;
    if (id === '@/lib/services/drfirstRcopiaService') return { DEMO_MODE: false };
    if (id === '@/lib/audit/writeAuditLog') return { writeAuditLog: async (e: Record<string, unknown>) => { audits.push(e); } };
    if (id === '../_lib/sync') return sync;
    return originalLoad.call(this, id, ...args);
  };
  t.after(() => { loader._load = originalLoad; });
  const require = createRequire(import.meta.url);
  const { NextRequest } = require('next/server') as typeof import('next/server');
  type Route = { GET: (req: InstanceType<typeof NextRequest>) => Promise<Response> };
  const reviewRoute = require('../src/app/api/drfirst/review-status/route') as Route;
  const pdmpRoute = require('../src/app/api/drfirst/pdmp-events/route') as Route;
  const { drFirstCaseloadClientIds } = require('../src/app/api/drfirst/_lib/access') as typeof import('../src/app/api/drfirst/_lib/access');
  const call = (r: Route, path: string) => r.GET(new NextRequest(`http://localhost${path}`));

  t.beforeEach(() => {
    gate.role = 'NP'; gate.userId = 'np1'; sensitiveFails = false; cursorSaves = 0; stored.length = 0; audits.length = 0;
  });

  await t.test('helper: caseload then Part 2 lock; empty input does no lookup', async () => {
    assert.deepEqual([...await drFirstCaseloadClientIds({ organizationId: 'org1', userId: 'np1', role: 'NP' }, ['a', 'b', 'c', null, 'a'])], ['a']);
    assert.deepEqual([...await drFirstCaseloadClientIds({ organizationId: 'org1', userId: 'np1', role: 'NP' }, [])], []);
    // ADMIN: org-wide (clientAccessWhere) and Part 2 privileged bypass
    assert.deepEqual([...await drFirstCaseloadClientIds({ organizationId: 'org1', userId: 'adm', role: 'ADMIN' }, ['a', 'b', 'c'])].sort(), ['a', 'b', 'c']);
    sensitiveFails = true;
    await assert.rejects(drFirstCaseloadClientIds({ organizationId: 'org1', userId: 'np1', role: 'NP' }, ['a']), 'throws so callers fail closed');
  });

  await t.test('review-status list: prescriber sees only caseload, unlocked clients; all rows stored', async () => {
    const res = await call(reviewRoute, '/api/drfirst/review-status');
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.deepEqual(json.statuses.map((s: { clientId: string }) => s.clientId), ['a']);
    assert.equal(json.notListed, 2);
    assert.equal(json.stored, 3);
    assert.deepEqual(stored.map((s) => s.clientId), ['a', 'b', 'c']);
    assert.equal(cursorSaves, 1);
    assert.doesNotMatch(JSON.stringify(json), /"clientId":"(b|c)"/);
  });

  await t.test('review-status list: ADMIN keeps org-wide view', async () => {
    gate.role = 'ADMIN'; gate.userId = 'adm';
    const json = await (await call(reviewRoute, '/api/drfirst/review-status')).json();
    assert.deepEqual(json.statuses.map((s: { clientId: string }) => s.clientId), ['a', 'b', 'c']);
    assert.equal(json.notListed, 0);
  });

  await t.test('review-status list: sensitive lookup failure fails closed (503, nothing stored, cursor kept)', async () => {
    sensitiveFails = true;
    const res = await call(reviewRoute, '/api/drfirst/review-status');
    assert.equal(res.status, 503);
    assert.equal((await res.json()).code, 'SCOPE_UNAVAILABLE');
    assert.equal(stored.length, 0);
    assert.equal(cursorSaves, 0);
    assert.equal(audits.at(-1)!.outcome, 'FAILURE');
  });

  await t.test('review-status ?patient keeps the single-client path (findDrFirstClient)', async () => {
    let res = await call(reviewRoute, '/api/drfirst/review-status?patient=a');
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.deepEqual(json.statuses.map((s: { clientId: string }) => s.clientId), ['a']);
    assert.equal(json.notListed, 0);
    res = await call(reviewRoute, '/api/drfirst/review-status?patient=b');
    assert.equal(res.status, 404, 'off caseload');
    res = await call(reviewRoute, '/api/drfirst/review-status?patient=c');
    assert.equal(res.status, 403, 'Part 2 lock');
  });

  await t.test('pdmp-events list: stored list scoped, totals still reported', async () => {
    const res = await call(pdmpRoute, '/api/drfirst/pdmp-events');
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.deepEqual(json.stored.map((s: { clientId: string }) => s.clientId), ['a']);
    assert.equal(json.storedTotal, 3);
    assert.equal(json.notListed, 2);
    assert.deepEqual(stored.map((s) => s.clientId), ['a', 'b', 'c']);
  });

  await t.test('pdmp-events list: ADMIN org-wide; failure fails closed', async () => {
    gate.role = 'ADMIN'; gate.userId = 'adm';
    const json = await (await call(pdmpRoute, '/api/drfirst/pdmp-events')).json();
    assert.deepEqual(json.stored.map((s: { clientId: string }) => s.clientId), ['a', 'b', 'c']);
    stored.length = 0; cursorSaves = 0;
    gate.role = 'NP'; gate.userId = 'np1';
    sensitiveFails = true;
    const res = await call(pdmpRoute, '/api/drfirst/pdmp-events');
    assert.equal(res.status, 503);
    assert.equal(stored.length, 0);
    assert.equal(cursorSaves, 0);
  });

  await t.test('non-prescriber is refused before any DrFirst call', async () => {
    gate.role = 'OFFICE_MANAGER';
    assert.equal((await call(reviewRoute, '/api/drfirst/review-status')).status, 403);
    assert.equal((await call(pdmpRoute, '/api/drfirst/pdmp-events')).status, 403);
  });
});
