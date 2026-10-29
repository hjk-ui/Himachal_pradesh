import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import {
  RULES,
  afterHoursFlags,
  highVolumeFlags,
  isAfterHours,
  localDay,
  startOfLocalDayUtc,
} from '../src/lib/audit/unusualAccessRules';
import { csvCell } from '../src/lib/audit/csv';
import { auditWhere, parseAuditFilters } from '../src/lib/audit/auditFilters';
import { actionLabel, describeResource } from '../src/lib/audit/auditLabels';
import { canAccessPath } from '../src/lib/auth/roleAccess';

type Route = Record<string, (req: Request, ctx?: unknown) => Promise<Response>>;
type Row = Record<string, unknown>;

// ─── Pure rules ──────────────────────────────────────────────────────────────

test('high PHI read volume: >= min today and >= 3x the average on working days', () => {
  const today = '2026-10-17';
  const daily = [
    // u1: avg 20 on 3 working days, 80 today -> 4x -> flagged
    { userId: 'u1', day: '2026-10-10', count: 20 },
    { userId: 'u1', day: '2026-10-13', count: 20 },
    { userId: 'u1', day: '2026-10-14', count: 20 },
    { userId: 'u1', day: today, count: 80 },
    // u2: 3x but under the minimum -> not flagged
    { userId: 'u2', day: '2026-10-14', count: 10 },
    { userId: 'u2', day: today, count: 40 },
    // u3: busy every day, steady -> not flagged
    { userId: 'u3', day: '2026-10-14', count: 200 },
    { userId: 'u3', day: today, count: 220 },
    // u4: no history, 120 today -> flagged; u5: no history, 60 -> not flagged
    { userId: 'u4', day: today, count: 120 },
    { userId: 'u5', day: today, count: 60 },
  ];
  const flags = highVolumeFlags(daily, today);
  assert.deepEqual(flags.map((f) => f.userId), ['u4', 'u1']);
  const u1 = flags.find((f) => f.userId === 'u1')!;
  assert.equal(u1.averagePerActiveDay, 20);
  assert.equal(u1.ratio, 4);
  assert.match(u1.reason, /80 PHI reads today vs an average of 20 on 3 working days/);
  assert.equal(flags.find((f) => f.userId === 'u4')!.averagePerActiveDay, null);
  assert.ok(RULES.highVolumeMultiplier === 3 && RULES.highVolumeMinToday === 50);
});

test('after-hours rule uses clinic time (Eastern) and weekends', () => {
  // Fri 2026-10-16 14:00 ET = 18:00Z -> in hours
  assert.equal(isAfterHours(new Date('2026-10-16T18:00:00Z')), false);
  // Fri 2026-10-16 21:30 ET = Sat 01:30Z -> after hours
  assert.equal(isAfterHours(new Date('2026-10-17T01:30:00Z')), true);
  // Thu 05:59 ET -> after hours; 06:00 ET -> in hours
  assert.equal(isAfterHours(new Date('2026-10-15T09:59:00Z')), true);
  assert.equal(isAfterHours(new Date('2026-10-15T10:00:00Z')), false);
  // Sunday noon ET -> weekend
  assert.equal(isAfterHours(new Date('2026-10-18T16:00:00Z')), true);
  const rows = afterHoursFlags([
    { userId: 'a', count: 2, lastAt: '2026-10-16T01:00:00Z' },
    { userId: 'b', count: 9, lastAt: '2026-10-16T01:00:00Z' },
    { userId: 'c', count: 3, lastAt: '2026-10-16T01:00:00Z' },
  ]);
  assert.deepEqual(rows.map((r) => r.userId), ['b', 'c']);
});

test('clinic-local day boundaries', () => {
  // 2026-10-17 02:00Z is still Oct 16 in Eastern (EDT, UTC-4)
  assert.equal(localDay(new Date('2026-10-17T02:00:00Z')), '2026-10-16');
  assert.equal(startOfLocalDayUtc(new Date('2026-10-17T15:00:00Z')).toISOString(), '2026-10-17T04:00:00.000Z');
  // EST in January (UTC-5)
  assert.equal(startOfLocalDayUtc(new Date('2026-01-10T15:00:00Z')).toISOString(), '2026-01-10T05:00:00.000Z');
});

test('filters, labels and CSV guard', () => {
  const f = parseAuditFilters(new URLSearchParams('action=read,export&outcome=failure,DENIED,bogus&from=2026-10-01&to=2026-10-02&patientId=c1&resourceType=progressNote'));
  const where = auditWhere('org1', f);
  assert.deepEqual(where, {
    organizationId: 'org1',
    patientId: 'c1',
    action: { in: ['READ', 'EXPORT'] },
    outcome: { in: ['FAILURE', 'DENIED'] },
    resourceType: 'progressNote',
    createdAt: { gte: new Date('2026-10-01'), lte: new Date('2026-10-02T23:59:59.999Z') },
  });
  assert.equal(actionLabel('READ'), 'Viewed');
  assert.equal(actionLabel('DRFIRST_PATIENT_SEARCH'), 'Drfirst patient search');
  assert.equal(describeResource('chart:access-log'), 'Client chart · Access log');
  assert.equal(describeResource('treatmentTeamMember'), 'Treatment team member');
  assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvCell('plain'), '"plain"');
});

test('audit-log page uses the same leadership rule as the API (ADMIN, PRACTICE_DIRECTOR)', () => {
  assert.equal(canAccessPath('ADMIN', '/dashboard/admin/audit-log'), true);
  assert.equal(canAccessPath('PRACTICE_DIRECTOR', '/dashboard/admin/audit-log'), true);
  for (const role of ['DIRECTOR', 'HR', 'BILLING', 'OFFICE_MANAGER', 'THERAPIST', 'FRONT_DESK']) {
    assert.equal(canAccessPath(role, '/dashboard/admin/audit-log'), false, role);
  }
});

test('Part2Disclosure is append-only: no update/delete routes or calls, DB trigger in migration', () => {
  const root = path.join(__dirname, '..');
  const apiDir = path.join(root, 'src', 'app', 'api', 'part2');
  const walk = (d: string): string[] =>
    fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(apiDir).filter((p) => p.endsWith('route.ts'))) {
    const src = fs.readFileSync(f, 'utf8');
    assert.doesNotMatch(src, /export\s+async\s+function\s+(PUT|PATCH|DELETE)\b/, f);
  }
  const all = walk(path.join(root, 'src')).filter((p) => /\.(ts|tsx)$/.test(p));
  for (const f of all) {
    const src = fs.readFileSync(f, 'utf8');
    assert.doesNotMatch(src, /part2Disclosure\.(update|updateMany|upsert|delete|deleteMany)\b/, f);
  }
  const sql = fs.readFileSync(path.join(root, 'prisma', 'migrations', '20261018_part2_disclosures.sql'), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "Part2Disclosure"/);
  assert.match(sql, /BEFORE UPDATE OR DELETE ON "Part2Disclosure"/);
  assert.match(sql, /DROP TRIGGER IF EXISTS part2_disclosure_no_update_delete/);
});

// ─── Routes with a fake database ─────────────────────────────────────────────

test('audit-log routes and Part 2 disclosure routes', async (t) => {
  const gate = { ok: true as const, userId: 'admin1', role: 'ADMIN', organizationId: 'org1', session: { user: { baseRole: 'ADMIN' } } };
  const audits: Row[] = [];
  const disclosures: Row[] = [];
  let auditCount = 4176;
  let logRows: Row[] = [];
  const findManyCalls: Row[] = [];
  const clients = [
    { id: 'c1', name: 'Pat One', mrn: 'MRN1', organizationId: 'org1' },
    { id: 'c2', name: 'Sam Protected', mrn: 'MRN2', organizationId: 'org1' },
    { id: 'cx', name: 'Other Org', mrn: 'MRNX', organizationId: 'org2' },
  ];
  const sensitive = [{ clientId: 'c2', organizationId: 'org1', reason: 'other', alias: 'Client S', accessWhitelist: [] as string[], noteClassification: '42 CFR Part 2' }];

  const db = {
    auditLog: {
      create: async ({ data }: { data: Row }) => {
        audits.push(data);
        return {};
      },
      count: async () => auditCount,
      groupBy: async () => [],
      findMany: async (args: Row) => {
        findManyCalls.push(args);
        const take = args.take as number;
        const cursor = (args.cursor as { id: string } | undefined)?.id;
        const start = cursor ? logRows.findIndex((r) => r.id === cursor) + 1 : 0;
        return logRows.slice(start, start + take);
      },
    },
    user: { findMany: async () => [{ id: 'admin1', name: 'Ada Admin', email: 'a@x' }] },
    client: {
      findFirst: async ({ where }: { where: { id: string; organizationId: string } }) =>
        clients.find((c) => c.id === where.id && c.organizationId === where.organizationId) ?? null,
      findMany: async ({ where }: { where: { id?: { in: string[] }; organizationId: string } }) =>
        clients.filter((c) => c.organizationId === where.organizationId && (!where.id || where.id.in.includes(c.id))),
    },
    sensitiveRecord: {
      findFirst: async ({ where }: { where: { clientId: string; organizationId: string } }) =>
        sensitive.find((s) => s.clientId === where.clientId && s.organizationId === where.organizationId) ?? null,
      findMany: async ({ where }: { where: { organizationId: string; clientId?: { in: string[] } } }) =>
        sensitive.filter((s) => s.organizationId === where.organizationId && (!where.clientId || where.clientId.in.includes(s.clientId))),
    },
    breakTheGlassGrant: { findFirst: async () => null, findMany: async () => [] },
    sensitiveAccessLog: { create: async () => ({}), findMany: async () => [] },
    progressNote: { findMany: async () => [] },
    consentForm: { findFirst: async () => null },
    part2Disclosure: {
      create: async ({ data }: { data: Row }) => {
        const row = { id: `d${disclosures.length + 1}`, createdAt: new Date('2026-10-17T12:00:00Z'), ...data };
        disclosures.push(row);
        return row;
      },
      findMany: async (args: { where: { organizationId: string; clientId?: string } }) => {
        findManyCalls.push(args as unknown as Row);
        return disclosures.filter((d) => d.organizationId === args.where.organizationId && (!args.where.clientId || d.clientId === args.where.clientId));
      },
    },
    $queryRaw: async () => [],
  };

  const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
  const originalLoad = loader._load;
  const fullAdmin = async () =>
    gate.role === 'ADMIN' || gate.role === 'PRACTICE_DIRECTOR'
      ? gate
      : { ok: false as const, status: 403, error: 'Only Admin / Practice Director can invite staff' };
  loader._load = function (id, ...args) {
    if (id === 'server-only') return {};
    if (id === '@/lib/db/prisma') return { prisma: db };
    if (id === '@/lib/auth/tenant') return { requireOrgContext: async () => gate };
    if (id === '@/lib/auth/requireAdmin') return { requireFullAdmin: fullAdmin, requireAdmin: fullAdmin };
    return originalLoad.call(this, id, ...args);
  };
  const require = createRequire(import.meta.url);
  let summary: Route, exportRoute: Route, disclosureRoute: Route, accounting: Route, trail: Route;
  let exportLib: typeof import('../src/lib/audit/auditExport');
  try {
    summary = require('../src/app/api/admin/audit-log/summary/route') as Route;
    exportRoute = require('../src/app/api/admin/audit-log/export/route') as Route;
    disclosureRoute = require('../src/app/api/part2/disclosures/route') as Route;
    accounting = require('../src/app/api/part2/disclosures/accounting/route') as Route;
    trail = require('../src/app/api/part2/audit-trail/route') as Route;
    exportLib = require('../src/lib/audit/auditExport');
  } finally {
    loader._load = originalLoad;
  }
  const req = (url: string, init?: RequestInit) => new Request(`http://localhost:3000${url}`, init);
  const asAdmin = () => Object.assign(gate, { role: 'ADMIN', userId: 'admin1' });

  await t.test('count endpoint returns the org total on page open and is itself audited', async () => {
    asAdmin();
    audits.length = 0;
    const res = await summary.GET(req('/api/admin/audit-log/summary?countOnly=1'));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { success: true, total: 4176 });
    assert.equal(audits.length, 1);
    assert.equal(audits[0].action, 'READ');
    assert.equal(audits[0].resourceType, 'auditLogSummary');
    assert.equal(audits[0].organizationId, 'org1');

    const full = await (await summary.GET(req('/api/admin/audit-log/summary'))).json();
    assert.equal(full.total, 4176);
    assert.ok('last24h' in full && 'phiReadsToday' in full && 'uniqueUsers30d' in full && 'denied30d' in full);

    gate.role = 'DIRECTOR';
    const denied = await summary.GET(req('/api/admin/audit-log/summary?countOnly=1'));
    assert.equal(denied.status, 403);
    asAdmin();
  });

  await t.test('CSV export is audited as EXPORT before streaming and reports the 50k cap', async () => {
    asAdmin();
    audits.length = 0;
    auditCount = 60_000;
    logRows = [
      { id: 'l1', createdAt: new Date('2026-10-17T10:00:00Z'), actorUserId: 'admin1', actorRole: 'ADMIN', action: 'READ', resourceType: 'progressNote', resourceId: 'n1', patientId: 'c1', outcome: 'SUCCESS', ipAddress: '10.0.0.1' },
    ];
    const res = await exportRoute.GET(req('/api/admin/audit-log/export?action=READ&patientId=c1'));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('X-Audit-Truncated'), '1');
    assert.equal(res.headers.get('X-Audit-Rows'), '50000');
    assert.match(res.headers.get('Content-Type') || '', /text\/csv/);
    // audited before the body was read
    assert.equal(audits.length, 1);
    assert.equal(audits[0].action, 'EXPORT');
    assert.equal(audits[0].resourceType, 'auditLogExport');
    assert.equal(audits[0].patientId, 'c1');
    const meta = audits[0].metadata as Row;
    assert.equal(meta.matched, 60_000);
    assert.equal(meta.rows, 50_000);
    assert.equal(meta.truncated, true);
    assert.equal(meta.limit, 50_000);
    const body = await res.text();
    assert.match(body, /Timestamp \(UTC\)/);
    assert.match(body, /"Ada Admin"/);
    assert.match(body, /"Viewed","READ","Progress note"/);
    assert.match(body, /"MRN1"/);
    assert.doesNotMatch(body, /Pat One/, 'export carries patient id / MRN, not names');
    auditCount = 4176;

    gate.role = 'BILLING';
    const blocked = await exportRoute.GET(req('/api/admin/audit-log/export'));
    assert.equal(blocked.status, 403);
    asAdmin();
  });

  await t.test('export stream pages with a cursor and never exceeds its limit', async () => {
    logRows = Array.from({ length: 25 }, (_, i) => ({
      id: `r${i}`, createdAt: new Date(Date.UTC(2026, 9, 17, 0, 0, 25 - i)), actorUserId: null, actorRole: null,
      action: 'LIST', resourceType: null, resourceId: null, patientId: null, outcome: 'SUCCESS', ipAddress: null,
    }));
    findManyCalls.length = 0;
    const stream = exportLib.streamAuditCsv({ organizationId: 'org1', where: { organizationId: 'org1' }, limit: 12, batchSize: 5 });
    const text = await new Response(stream).text();
    const lines = text.trim().split('\r\n');
    assert.equal(lines.length, 13, 'header + 12 rows');
    assert.deepEqual(findManyCalls.map((c) => c.take), [5, 5, 2]);
    assert.equal((findManyCalls[1].cursor as { id: string }).id, 'r4');
    assert.equal(exportLib.AUDIT_EXPORT_MAX_ROWS, 50_000);
  });

  await t.test('record a disclosure: validated, org/protected-record scoped, audited, disclosedBy from session', async () => {
    asAdmin();
    audits.length = 0;
    const post = (body: Row) =>
      disclosureRoute.POST(req('/api/part2/disclosures', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }));
    const base = {
      clientId: 'c1', basis: 'consent', consentReference: 'Paper form 2026-114', disclosedTo: 'County Drug Court',
      purpose: 'Treatment compliance report', informationDisclosed: 'Attendance records', method: 'fax',
      disclosedAt: '2026-10-16T12:00:00Z', disclosedById: 'someone-else',
    };
    const noConsent = await post({ ...base, consentReference: '' });
    assert.equal(noConsent.status, 400);
    const future = await post({ ...base, disclosedAt: '2099-01-01T00:00:00Z' });
    assert.equal(future.status, 400);
    const otherOrg = await post({ ...base, clientId: 'cx' });
    assert.equal(otherOrg.status, 404);

    const ok = await post(base);
    assert.equal(ok.status, 201);
    assert.equal(disclosures.length, 1);
    assert.equal(disclosures[0].disclosedById, 'admin1');
    assert.equal(disclosures[0].organizationId, 'org1');
    const created = audits.find((a) => a.action === 'CREATE');
    assert.equal(created?.resourceType, 'part2Disclosure');
    assert.equal(created?.patientId, 'c1');
    assert.doesNotMatch(JSON.stringify(created?.metadata), /Drug Court|Attendance/, 'no free text in the audit row');

    // A clinician without break-glass cannot record for a protected client; the attempt is audited DENIED
    Object.assign(gate, { role: 'THERAPIST', userId: 'ther1' });
    audits.length = 0;
    const locked = await post({ ...base, clientId: 'c2' });
    assert.equal(locked.status, 403);
    assert.equal(audits.at(-1)?.outcome, 'DENIED');
    // A role without the Part 2 page cannot record at all
    gate.role = 'PEER_SUPPORT';
    assert.equal((await post(base)).status, 403);
    asAdmin();
  });

  await t.test('accounting of disclosures: per client, org-scoped, protected rules, audited (CSV = EXPORT)', async () => {
    asAdmin();
    disclosures.push({
      id: 'dOther', organizationId: 'org2', clientId: 'c1', consentFormId: null, consentReference: 'x', basis: 'consent',
      disclosedTo: 'LEAK', purpose: 'p', informationDisclosed: 'i', method: 'mail', disclosedAt: new Date('2026-10-16T12:00:00Z'),
      disclosedById: 'u9', createdAt: new Date('2026-10-16T12:00:00Z'),
    });
    audits.length = 0;
    findManyCalls.length = 0;
    const json = await (await accounting.GET(req('/api/part2/disclosures/accounting?clientId=c1&from=2026-01-01&to=2026-12-31'))).json();
    assert.equal(json.success, true);
    assert.equal(json.disclosures.length, 1);
    assert.equal(json.disclosures[0].disclosedTo, 'County Drug Court');
    const where = (findManyCalls.at(-1) as { where: Row }).where;
    assert.equal(where.organizationId, 'org1');
    assert.equal(where.clientId, 'c1');
    assert.equal(audits.at(-1)?.action, 'READ');
    assert.equal(audits.at(-1)?.resourceType, 'part2DisclosureAccounting');

    const csv = await accounting.GET(req('/api/part2/disclosures/accounting?clientId=c1&format=csv'));
    assert.equal(csv.status, 200);
    const text = await csv.text();
    assert.match(text, /Accounting of disclosures/);
    assert.match(text, /County Drug Court/);
    assert.doesNotMatch(text, /LEAK/);
    assert.equal(audits.at(-1)?.action, 'EXPORT');

    assert.equal((await accounting.GET(req('/api/part2/disclosures/accounting?clientId=cx'))).status, 404);
    assert.equal((await accounting.GET(req('/api/part2/disclosures/accounting'))).status, 400);
    Object.assign(gate, { role: 'BILLING', userId: 'bill1' });
    audits.length = 0;
    const locked = await accounting.GET(req('/api/part2/disclosures/accounting?clientId=c2'));
    assert.equal(locked.status, 403);
    assert.equal(audits.at(-1)?.outcome, 'DENIED');
    asAdmin();
  });

  await t.test('org-wide disclosure list and Part 2 audit trail are leadership only', async () => {
    gate.role = 'OFFICE_MANAGER';
    assert.equal((await disclosureRoute.GET(req('/api/part2/disclosures'))).status, 403);
    assert.equal((await trail.GET(req('/api/part2/audit-trail'))).status, 403);
    asAdmin();
    const res = await trail.GET(req('/api/part2/audit-trail'));
    assert.equal(res.status, 200);
    const body = await res.json();
    // c2 (classified Part 2) and c1 (has a disclosure) are Part 2 clients; c2 shows its real name to ADMIN
    assert.deepEqual(body.clients.map((c: { id: string }) => c.id).sort(), ['c1', 'c2']);
  });
});
