import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import type { Role } from '@prisma/client';
import { peerClientWhere, PEER_CLIENT_SELECT } from '../src/lib/peerSupport/scope';
import {
  followUpState,
  isLegacySampleId,
  normalizeTopics,
  parseLegacyList,
  parseProgressNotes,
  summarize,
} from '../src/lib/peerSupport/workflow';
import { canUseClinicModule } from '../src/lib/modules/access';
import { canAccessPath } from '../src/lib/auth/roleAccess';

const ROOT = path.join(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// ─── Scoping: evaluate the Prisma where against in-memory clients ───────────

type FakeClient = {
  id: string;
  organizationId: string | null;
  locationId: string | null;
  location: { organizationId: string } | null;
  assignedToId: string | null;
  assignedTo: { organizationId: string } | null;
  treatmentTeamMembers: { providerId: string | null }[];
};

/** Minimal matcher for the where shapes used by clientOrgFilter / clientAccessWhere / peerClientWhere. */
function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'AND') return (cond as Record<string, unknown>[]).every((w) => matches(row, w));
    if (key === 'OR') return (cond as Record<string, unknown>[]).some((w) => matches(row, w));
    const value = row[key];
    if (cond === null) return value === null;
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      const c = cond as Record<string, unknown>;
      if ('some' in c) return Array.isArray(value) && value.some((v) => matches(v as Record<string, unknown>, c.some as Record<string, unknown>));
      if ('in' in c) return (c.in as unknown[]).includes(value);
      if (value === null || value === undefined) return false;
      return matches(value as Record<string, unknown>, c);
    }
    return value === cond;
  });
}

const ORG_A = 'org-a';
const ORG_B = 'org-b';
const PEER = 'u-peer';
const OTHER_PEER = 'u-peer-2';
const CM = 'u-cm';

function client(id: string, over: Partial<FakeClient> = {}): FakeClient {
  return {
    id,
    organizationId: ORG_A,
    locationId: null,
    location: null,
    assignedToId: null,
    assignedTo: null,
    treatmentTeamMembers: [],
    ...over,
  };
}

const CLIENTS: FakeClient[] = [
  client('c-team', { treatmentTeamMembers: [{ providerId: PEER }] }),
  client('c-assigned', { assignedToId: PEER }),
  client('c-other-peer', { treatmentTeamMembers: [{ providerId: OTHER_PEER }] }),
  client('c-cm', { assignedToId: CM }),
  client('c-nobody'),
  // Same peer id on a team in another clinic: must never leak across orgs
  client('c-org-b-team', { organizationId: ORG_B, treatmentTeamMembers: [{ providerId: PEER }] }),
];

function visible(actorUserId: string, actorRole: Role, organizationId = ORG_A) {
  const where = peerClientWhere({ organizationId, actorUserId, actorRole }) as Record<string, unknown>;
  return CLIENTS.filter((c) => matches(c as unknown as Record<string, unknown>, where)).map((c) => c.id).sort();
}

test('peer support sees only clients they are assigned to or on the care team of, in their org', () => {
  assert.deepEqual(visible(PEER, 'PEER_SUPPORT'), ['c-assigned', 'c-team']);
  assert.deepEqual(visible(OTHER_PEER, 'PEER_SUPPORT'), ['c-other-peer']);
  assert.deepEqual(visible('u-new-peer', 'PEER_SUPPORT'), []);
  assert.deepEqual(visible(PEER, 'PEER_SUPPORT', ORG_B), ['c-org-b-team']);
});

test('case managers keep the assigned-only rule; leadership sees the org', () => {
  assert.deepEqual(visible(CM, 'CASE_MANAGER'), ['c-cm']);
  assert.deepEqual(visible(CM, 'PRP_SPECIALIST'), ['c-cm']);
  assert.deepEqual(visible('u-admin', 'PRACTICE_DIRECTOR'), ['c-assigned', 'c-cm', 'c-nobody', 'c-other-peer', 'c-team']);
});

test('page roles: peer support page open to peers, case managers, PRP and leadership only', () => {
  for (const r of ['PEER_SUPPORT', 'CASE_MANAGER', 'PRP_SPECIALIST', 'ADMIN', 'PRACTICE_DIRECTOR']) assert.ok(canAccessPath(r, '/dashboard/peer-support'), r);
  for (const r of ['BILLING', 'FRONT_DESK', 'HR', 'THERAPIST']) assert.equal(canAccessPath(r, '/dashboard/peer-support'), false, r);
});

// ─── Minimum necessary ──────────────────────────────────────────────────────

test('peer APIs select client name/status only and touch no clinical, billing or psychotherapy data', () => {
  assert.deepEqual(Object.keys(PEER_CLIENT_SELECT).sort(), ['assignedToId', 'id', 'name', 'status']);
  const files = [
    'src/lib/peerSupport/manage.ts',
    'src/lib/peerSupport/scope.ts',
    ...fs
      .readdirSync(path.join(ROOT, 'src/app/api/peer-support'), { recursive: true })
      .map(String)
      .filter((f) => f.endsWith('route.ts'))
      .map((f) => `src/app/api/peer-support/${f.split(path.sep).join('/')}`),
  ];
  const ALLOWED_MODELS = new Set([
    'client',
    'user',
    'peerContact',
    'peerGoal',
    'peerPlacement',
    'clientTreatmentTeamMember',
    'sdohResource',
    'clinicModuleState',
    '$transaction',
  ]);
  for (const f of files) {
    const src = read(f);
    for (const m of src.matchAll(/\b(?:prisma|tx)\.(\$?\w+)/g)) assert.ok(ALLOWED_MODELS.has(m[1]), `${f} uses prisma.${m[1]}`);
    assert.ok(!/psychotherapy|diagnos|medication|insurance|claim|ledger|transcript|soapNote|sessionNote/i.test(src.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '')), `${f} references clinical/billing data`);
  }
  // Client rows are only ever read with the minimal select
  const manage = read('src/lib/peerSupport/manage.ts');
  for (const m of manage.matchAll(/prisma\.client\.find\w+\(\{[\s\S]*?select: (PEER_CLIENT_SELECT|\{[^}]*\})/g)) {
    assert.ok(/PEER_CLIENT_SELECT|\{ id: true(, name: true)? \}/.test(m[1]), `client select: ${m[1]}`);
  }
});

test('records are scoped, protected-record checked, and the old org-wide lists are not client-readable', () => {
  const manage = read('src/lib/peerSupport/manage.ts');
  assert.match(manage, /peerClientWhere\(actor\)/);
  assert.match(manage, /assertClientPhiAccess\(/);
  assert.match(manage, /lockedSensitiveClientIds\(/);
  // Every record lookup by id goes through requireClient for the row's client
  for (const fn of ['requireContact', 'updateGoal', 'updatePlacement']) {
    const body = manage.slice(manage.indexOf(`function ${fn}`));
    assert.match(body.slice(0, 600), /requireClient\(actor, row\.clientId\)/, fn);
  }
  for (const mod of ['peer-contacts', 'peer-goals', 'peer-placements', 'peer-meta']) {
    for (const role of ['PEER_SUPPORT', 'CASE_MANAGER', 'ADMIN'] as const) assert.equal(canUseClinicModule(role, mod), false, `${role} ${mod}`);
  }
  const page = read('src/app/dashboard/peer-support/page.tsx');
  assert.ok(!page.includes('useModuleList'), 'page must not read module lists');
  assert.ok(!/SEED/.test(page));
});

// ─── Audit ──────────────────────────────────────────────────────────────────

test('every peer support route handler writes an audit entry, including denials', () => {
  const routes: Record<string, string[]> = {
    'caseload': ['GET'],
    'clients': ['GET'],
    'contacts': ['GET', 'POST'],
    'contacts/[id]': ['PATCH', 'DELETE'],
    'goals': ['GET', 'POST'],
    'goals/[id]': ['PATCH'],
    'placements': ['GET', 'POST'],
    'placements/[id]': ['PATCH'],
    'legacy': ['GET', 'POST'],
  };
  for (const [rel, methods] of Object.entries(routes)) {
    const src = read(`src/app/api/peer-support/${rel}/route.ts`);
    for (const method of methods) {
      const start = src.indexOf(`export async function ${method}(`);
      assert.ok(start >= 0, `${rel} ${method}`);
      const next = src.indexOf('export async function', start + 10);
      const body = src.slice(start, next < 0 ? undefined : next);
      assert.match(body, /peerGate\(/, `${rel} ${method} gate`);
      assert.match(body, /auditPhiAccess\(/, `${rel} ${method} audit`);
      assert.match(body, /errorResponse\(/, `${rel} ${method} error audit`);
    }
  }
  const http = read('src/lib/peerSupport/http.ts');
  assert.match(http, /outcome: 'DENIED', metadata: \{ reason: 'role_not_permitted' \}/);
  assert.match(http, /not_in_scope/);
});

test('contacts are voided, never hard-deleted; legacy import is leadership-only and user-linked', () => {
  const manage = read('src/lib/peerSupport/manage.ts');
  assert.ok(!/peerContact\.delete/.test(manage));
  assert.ok(!/peerGoal\.delete|peerPlacement\.delete/.test(manage));
  assert.match(manage, /voidedAt: new Date\(\)/);
  const imp = manage.slice(manage.indexOf('export async function importLegacyEntry'));
  assert.match(imp.slice(0, 300), /isPeerLeadership\(actor\.actorRole\)/);
  assert.match(imp, /requireClient\(actor, input\.clientId\)/);
  assert.match(imp, /source: 'legacy'/);
});

// ─── Legacy parsing ─────────────────────────────────────────────────────────

test('legacy lists: sample rows skipped, group rows flagged, names never turned into client ids', () => {
  assert.ok(isLegacySampleId('pc-01'));
  assert.ok(isLegacySampleId('pg-14'));
  assert.ok(!isLegacySampleId('pc-1729123456789'));
  const contacts = parseLegacyList('contact', [
    { id: 'pc-01', client: 'Sample P.', contactType: 'Individual phone call', date: '2026-01-01' },
    { id: 'pc-1729123456789', client: 'Jordan R.', contactType: 'Individual phone call', date: '2026-09-30', duration: 20, topics: ['Housing'], goalsAddressed: ['Lease'], response: 'Talked through the lease', specialist: 'A. Peer' },
    { id: 'pc-1729123456790', client: 'Group (6 members)', contactType: 'Group session', date: '2026-09-30' },
    { client: 'No id' },
    'junk',
  ]);
  assert.equal(contacts.sampleRows, 1);
  assert.equal(contacts.unreadable, 1);
  assert.equal(contacts.entries.length, 2);
  const [jr, group] = contacts.entries;
  assert.equal(jr.clientLabel, 'Jordan R.');
  assert.equal(jr.author, 'A. Peer');
  assert.equal(jr.suggested.mode, 'phone');
  assert.deepEqual(jr.suggested.topics, ['Housing', 'Individual phone call']);
  assert.match(String(jr.suggested.notes), /Goals addressed: Lease/);
  assert.ok(!('clientId' in jr) && !('clientId' in jr.suggested), 'no automatic client match');
  assert.equal(group.group, true);

  const goals = parseLegacyList('goal', [{ id: 'pg-1729', client: 'Jordan R.', title: '90 days sober', status: 'Completed', notes: 'Met' }]);
  assert.equal(goals.entries[0].suggested.status, 'achieved');
  const placements = parseLegacyList('placement', [{ id: 'pp-1729', client: 'Jordan R.', activityType: 'Competitive Employment', organization: 'Grocer', status: 'Active', hoursPerWeek: 20 }]);
  assert.equal(placements.entries[0].suggested.placementType, 'competitive_employment');
  assert.equal(parseLegacyList('goal', null).entries.length, 0);
});

test('migration has no INSERT: nothing is copied or seeded automatically', () => {
  const sql = read('prisma/migrations/20261018_peer_support.sql');
  assert.ok(!/\bINSERT\b/i.test(sql));
  assert.ok(!/\bDROP\b/i.test(sql));
  assert.ok(!/CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/.test(sql));
  assert.ok(!read('scripts/seed-ehr-modules.ts').includes('PEER_CONTACTS_SEED'));
  assert.ok(!read('scripts/seed-peer-support.ts').includes('clinicModuleState'));
});

// ─── Rules ──────────────────────────────────────────────────────────────────

test('summary counts real rows only and ignores voided contacts', () => {
  const now = new Date(2026, 9, 17, 12);
  const d = (m: number, day: number) => new Date(2026, m, day, 10);
  const s = summarize({
    now,
    caseloadSize: 4,
    contacts: [
      { clientId: 'a', contactAt: d(9, 2), voidedAt: null, followUpAt: d(9, 10), followUpDoneAt: null },
      { clientId: 'a', contactAt: d(9, 15), voidedAt: null, followUpAt: d(9, 17), followUpDoneAt: null },
      { clientId: 'b', contactAt: d(8, 25), voidedAt: null, followUpAt: d(9, 20), followUpDoneAt: null },
      { clientId: 'c', contactAt: d(9, 5), voidedAt: d(9, 6), followUpAt: d(9, 1), followUpDoneAt: null },
      { clientId: 'd', contactAt: d(7, 1), voidedAt: null, followUpAt: d(8, 1), followUpDoneAt: d(8, 1) },
    ],
    goals: [{ status: 'active' }, { status: 'in_progress' }, { status: 'on_hold' }, { status: 'achieved' }, { status: 'discontinued' }],
  });
  assert.equal(s.contactsThisMonth, 2);
  assert.equal(s.clientsEngaged30d, 2);
  assert.equal(s.openGoals, 3);
  assert.equal(s.followUpsOverdue, 1);
  assert.equal(s.followUpsDueToday, 1);
});

test('follow-up state by calendar day; topics normalized; progress notes parsed defensively', () => {
  const now = new Date(2026, 9, 17, 9);
  assert.equal(followUpState(new Date(2026, 9, 16, 23), now), 'overdue');
  assert.equal(followUpState(new Date(2026, 9, 17, 22), now), 'due_today');
  assert.equal(followUpState(new Date(2026, 9, 18, 1), now), 'upcoming');
  assert.deepEqual(normalizeTopics([' Housing ', 'housing', '', 'Work  search']), ['Housing', 'Work search']);
  assert.equal(normalizeTopics(Array.from({ length: 30 }, (_, i) => `t${i}`)).length, 12);
  assert.deepEqual(parseProgressNotes([{ at: '2026-10-01', byId: 'u', text: 'ok' }, { text: '' }, 'x', null]), [
    { at: '2026-10-01', byId: 'u', byName: null, text: 'ok' },
  ]);
});

// ─── Migration matches schema ───────────────────────────────────────────────

function modelColumns(schema: string, model: string) {
  const m = schema.match(new RegExp(`model ${model} \\{([\\s\\S]*?)\\n\\}`));
  assert.ok(m, `model ${model}`);
  const table = m[1].match(/@@map\("([^"]+)"\)/)?.[1];
  const cols = m[1]
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('//') && !l.startsWith('@@'))
    .map((l) => l.split(/\s+/)[0]);
  return { table, cols };
}

test('20261018_peer_support.sql creates exactly the schema columns, idempotently', () => {
  const schema = read('prisma/schema.prisma');
  const sql = read('prisma/migrations/20261018_peer_support.sql');
  for (const model of ['PeerContact', 'PeerGoal', 'PeerPlacement']) {
    const { table, cols } = modelColumns(schema, model);
    assert.ok(table, `${model} @@map`);
    const create = sql.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\);`));
    assert.ok(create, `CREATE TABLE IF NOT EXISTS ${table}`);
    const sqlCols = [...create[1].matchAll(/^\s*"(\w+)"/gm)].map((x) => x[1]);
    assert.deepEqual([...sqlCols].sort(), [...cols].sort(), table);
    assert.match(sql, new RegExp(`${table}_organizationId_source_legacyId_key`));
  }
});
