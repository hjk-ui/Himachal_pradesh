import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  POPULATION_PATH,
  buildPopulationReport,
  paginate,
  parsePopulationFilters,
  populationClientWhere,
  riskTierOf,
  toRow,
  type PopulationClientFacts,
} from '../src/lib/reports/populationHealth';
import type { ReportScope } from '../src/lib/reports/outcomesReports';
import { canAccessPath } from '../src/lib/auth/roleAccess';

const DAY = 86_400_000;
const NOW = new Date('2026-10-17T16:00:00Z');
const ago = (d: number) => new Date(NOW.getTime() - d * DAY);

const orgScope: ReportScope = {
  organizationId: 'org1', userId: 'admin1', role: 'ADMIN', locationId: null, clinicianId: null, lockedClientIds: [], facilityTerm: null,
};
const options = { locations: [], clinicians: [] };

function fact(id: string, over: Partial<PopulationClientFacts> = {}): PopulationClientFacts {
  return {
    id,
    name: `Client ${id}`,
    mrn: `MRN-${id}`,
    assignedToId: 'u1',
    assignedToName: 'Dr One',
    locationName: 'Bowie',
    riskLevel: 'LOW',
    createdAt: ago(400),
    importedAt: null,
    openAlertSeverities: [],
    latestCssrsFlagged: null,
    hasRiskScreen: true,
    lastVisitAt: ago(10),
    nextAppointmentAt: null,
    therapyOverdue: false,
    medOverdue: false,
    therapyDaysOverdue: 0,
    measured90: false,
    hasSafetyPlan: false,
    severePhq9: null,
    protectedAlias: null,
    isProtected: false,
    ...over,
  };
}

const build = (facts: PopulationClientFacts[], extra: Partial<Parameters<typeof buildPopulationReport>[0]> = {}) =>
  buildPopulationReport({
    facts, now: NOW, scope: orgScope, hiddenSensitiveClients: 0, options, list: null, page: 0, pageSize: 25, cadenceAvailable: true, ...extra,
  });

// ─── Risk tiers ──────────────────────────────────────────────────────────────

test('risk tier follows the chart banner rule; default LOW without any screen is unknown', () => {
  assert.equal(riskTierOf(fact('a', { riskLevel: 'HIGH' })), 'high');
  assert.equal(riskTierOf(fact('a', { openAlertSeverities: ['HIGH'] })), 'high');
  assert.equal(riskTierOf(fact('a', { latestCssrsFlagged: true })), 'high');
  assert.equal(riskTierOf(fact('a', { riskLevel: 'MEDIUM' })), 'moderate');
  assert.equal(riskTierOf(fact('a', { openAlertSeverities: ['MEDIUM'] })), 'moderate');
  assert.equal(riskTierOf(fact('a', { latestCssrsFlagged: false })), 'low');
  assert.equal(riskTierOf(fact('a', { hasRiskScreen: true })), 'low');
  assert.equal(riskTierOf(fact('a', { hasRiskScreen: false })), 'unknown');
  // An explicit Medium needs no screen to be moderate
  assert.equal(riskTierOf(fact('a', { riskLevel: 'MEDIUM', hasRiskScreen: false })), 'moderate');
});

// ─── Aggregation math ────────────────────────────────────────────────────────

test('counts are over every active client fact, with "of N" denominators', () => {
  const facts = [
    fact('h1', { riskLevel: 'HIGH', lastVisitAt: ago(5), measured90: true, therapyOverdue: true, therapyDaysOverdue: 9 }),
    fact('h2', { openAlertSeverities: ['HIGH'], lastVisitAt: ago(45), hasSafetyPlan: true }),
    fact('h3', { latestCssrsFlagged: true, lastVisitAt: null, assignedToId: null, assignedToName: null }),
    fact('m1', { riskLevel: 'MEDIUM', lastVisitAt: ago(75), medOverdue: true, measured90: true }),
    fact('l1', { lastVisitAt: ago(120), createdAt: ago(20) }),
    fact('u1', { hasRiskScreen: false, lastVisitAt: ago(29), importedAt: ago(15), createdAt: ago(15), assignedToId: 'u2', assignedToName: 'Dr Two' }),
  ];
  const r = build(facts);
  assert.equal(r.activeCaseload, 6);
  assert.deepEqual({ h: r.risk.high, m: r.risk.moderate, l: r.risk.low, u: r.risk.unknown }, { h: 3, m: 1, l: 1, u: 1 });
  assert.equal(r.risk.escalatedByAlert, 1);
  assert.equal(r.risk.escalatedByCssrs, 1);
  assert.deepEqual(r.engagement, { seen30: 2, seen60: 3, seen90: 4, notSeen90: 2, neverSeen: 1 });
  assert.deepEqual(r.overdue, { available: true, therapy: 1, medManagement: 1, either: 2 });
  assert.deepEqual(r.mbc.activeMeasured, { numerator: 2, denominator: 6, pct: 33.3 });
  assert.deepEqual(r.mbc.seenMeasured, { numerator: 2, denominator: 4, pct: 50 });
  // Imported records are not new intakes
  assert.deepEqual(r.newIntakes, { d30: 1, d90: 1 });
  assert.deepEqual(r.imported, { d30: 1, d90: 1 });

  // Clinician balance adds up to the caseload; unassigned bucket last
  assert.equal(r.clinicians.reduce((s, c) => s + c.activeClients, 0), 6);
  assert.equal(r.clinicians[r.clinicians.length - 1].name, 'Unassigned');
  const one = r.clinicians.find((c) => c.clinicianId === 'u1')!;
  assert.deepEqual({ a: one.activeClients, h: one.highRisk, o: one.overdue, s: one.seen30, m: one.measured90 }, { a: 4, h: 2, o: 2, s: 1, m: 2 });

  for (const t of ['high', 'moderate', 'low', 'unknown'] as const) assert.equal(r.tiers[t].count, r.risk[t]);
});

test('action items come from recorded signals only', () => {
  const facts = [
    fact('a', { riskLevel: 'HIGH', hasSafetyPlan: false, therapyOverdue: true, therapyDaysOverdue: 3, lastVisitAt: ago(70) }),
    fact('b', { riskLevel: 'HIGH', hasSafetyPlan: true, therapyOverdue: true, therapyDaysOverdue: 12 }),
    fact('c', { severePhq9: { score: 22, at: ago(3) } }),
    fact('d', { lastVisitAt: null }),
    fact('e'),
  ];
  const r = build(facts);
  const by = Object.fromEntries(r.actions.map((a) => [a.kind, a]));
  assert.deepEqual(by.high_no_safety_plan.preview.map((p) => p.clientId), ['a']);
  // Most overdue first
  assert.deepEqual(by.high_overdue.preview.map((p) => p.clientId), ['b', 'a']);
  assert.deepEqual(by.phq9_severe_unacked.preview.map((p) => p.clientId), ['c']);
  // Never seen first, then the longest gap
  assert.deepEqual(by.no_visit_60.preview.map((p) => p.clientId), ['d', 'a']);
  assert.ok(by.no_visit_60.preview.every((p) => p.href.startsWith('/dashboard/clients/')));

  // Without the cadence, the overdue action and counts are withheld, not zero
  const noCad = build(facts.map((f) => ({ ...f, therapyOverdue: null, medOverdue: null })), { cadenceAvailable: false });
  assert.equal(noCad.actions.some((a) => a.kind === 'high_overdue'), false);
  assert.equal(noCad.overdue.either, null);
  assert.equal(noCad.clinicians[0].overdue, null);
});

// ─── Pagination ──────────────────────────────────────────────────────────────

test('tier lists paginate over the whole tier, previews stay small', () => {
  const facts = Array.from({ length: 260 }, (_, i) => fact(String(i).padStart(3, '0'), { riskLevel: 'HIGH' }));
  const r = build(facts, { list: 'tier:high', page: 10, pageSize: 25 });
  assert.equal(r.tiers.high.count, 260);
  assert.equal(r.tiers.high.preview.length, 5);
  assert.ok(r.list);
  assert.equal(r.list!.total, 260);
  assert.equal(r.list!.page, 10);
  assert.equal(r.list!.rows.length, 10);
  assert.equal(r.list!.rows[0].clientId, '250');
  // Past the end clamps to the last page
  const p = paginate([1, 2, 3], 9, 2);
  assert.deepEqual({ page: p.page, items: p.items }, { page: 1, items: [3] });
  assert.equal(paginate([], 3, 25).items.length, 0);
});

test('filters parse and validate', () => {
  const ok = parsePopulationFilters(new URLSearchParams('location=loc_1&clinician=u1&list=tier:unknown&page=2&pageSize=500'));
  assert.ok('filters' in ok);
  if ('filters' in ok) {
    assert.equal(ok.filters.list, 'tier:unknown');
    assert.equal(ok.filters.pageSize, 100);
    assert.equal(ok.filters.page, 2);
  }
  assert.ok('error' in parsePopulationFilters(new URLSearchParams('list=tier:everyone')));
  assert.ok('error' in parsePopulationFilters(new URLSearchParams('location=bad id')));
  assert.ok('error' in parsePopulationFilters(new URLSearchParams('page=-1')));
});

// ─── Scoping and Part 2 ──────────────────────────────────────────────────────

test('caseload roles are scoped to their own assigned active clients; leadership to the org', () => {
  const json = (s: ReportScope) => JSON.stringify(populationClientWhere(s));
  const caseload = json({ ...orgScope, userId: 'ther1', role: 'THERAPIST' });
  assert.match(caseload, /"assignedToId":"ther1"/);
  assert.match(caseload, /"status":"ACTIVE"/);
  const admin = json(orgScope);
  assert.doesNotMatch(admin, /assignedToId/);
  assert.match(admin, /"organizationId":"org1"/);
  const filtered = json({ ...orgScope, locationId: 'loc1', clinicianId: 'u9' });
  assert.match(filtered, /"locationId":"loc1"/);
  assert.match(filtered, /"assignedToId":"u9"/);
  assert.equal(buildPopulationReport({ facts: [], now: NOW, scope: { ...orgScope, role: 'THERAPIST' }, hiddenSensitiveClients: 0, options, list: null, page: 0, pageSize: 25, cadenceAvailable: true }).scope, 'caseload');
});

test('locked Part 2 clients are excluded from the scope and only counted; protected rows show the alias', () => {
  const where = JSON.stringify(populationClientWhere({ ...orgScope, lockedClientIds: ['p1', 'p2'] }));
  assert.match(where, /"notIn":\["p1","p2"\]/);
  const r = build([fact('a'), fact('b')], { hiddenSensitiveClients: 2 });
  assert.equal(r.activeCaseload, 2);
  assert.equal(r.hiddenSensitiveClients, 2);

  const row = toRow(fact('s', { isProtected: true, protectedAlias: 'Client S-7', severePhq9: { score: 25, at: ago(1) } }), 'high', 'PHQ-9 25');
  assert.equal(row.name, 'Client S-7');
  assert.equal(row.mrn, null);
  assert.equal(row.detail, null);
  assert.equal(row.lastVisit, null);
  assert.equal(row.isProtected, true);
  assert.equal(toRow(fact('t', { isProtected: true }), 'low', null).name, 'Protected client');
});

test('route is audited and gated like the page; the page no longer counts the client list', () => {
  const route = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'api', 'reports', 'population', 'route.ts'), 'utf8');
  assert.match(route, /auditPhiAccess/);
  assert.match(route, /canAccessPath\(gate\.role, POPULATION_PATH, gate\.capabilities\)/);
  assert.equal(canAccessPath('ADMIN', POPULATION_PATH), true);
  assert.equal(canAccessPath('THERAPIST', POPULATION_PATH), false); // providers: no practice reports
  assert.equal(canAccessPath('BILLING', POPULATION_PATH), false);
  const page = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'dashboard', 'population', 'page.tsx'), 'utf8');
  assert.doesNotMatch(page, /useClients|POPULATION_HEALTH_SEED|savePayload|method: 'PUT'/);
  assert.match(page, /\/api\/reports\/population/);
});
