import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Prisma } from '@prisma/client';
import { clientAccessWhere } from '../src/lib/clients/orgScope';
import { primaryCarePatientWhere } from '../src/lib/medical/medicalProgram';
import {
  loadPrimaryCareRoster,
  parseDobQuery,
  parseRosterQuery,
  pickPrimaryCareProvider,
  primaryCareChartHref,
  primaryCareRosterWhere,
  problemCounts,
  rosterColumnsForRole,
  rosterSearchWhere,
  type RosterClientRow,
  type RosterSource,
} from '../src/lib/medical/primaryCareRoster';

const root = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
const NOW = new Date('2026-10-17T12:00:00Z');

test('roster query: defaults, page size cap, status, id params', () => {
  const d = parseRosterQuery(new URLSearchParams());
  assert.deepEqual(d, { page: 1, pageSize: 25, q: '', locationId: null, providerId: null, status: 'ACTIVE', pcp: null, pcpReview: false, sort: 'name' });
  const p = parseRosterQuery(new URLSearchParams('pcp=none&pcpReview=1&sort=pcp'));
  assert.deepEqual([p.pcp, p.pcpReview, p.sort], ['none', true, 'pcp']);
  assert.equal(parseRosterQuery(new URLSearchParams('pcp=doc_1&sort=bogus')).sort, 'name');
  assert.equal(parseRosterQuery(new URLSearchParams('pcp=doc_1')).pcp, 'doc_1');
  const q = parseRosterQuery(new URLSearchParams('page=3&pageSize=500&status=all&locationId=loc_1&providerId=all&q=%20Ann%20'));
  assert.equal(q.page, 3);
  assert.equal(q.pageSize, 100, 'capped');
  assert.equal(q.status, 'all');
  assert.equal(q.locationId, 'loc_1');
  assert.equal(q.providerId, null, '"all" = no filter');
  assert.equal(q.q, 'Ann');
  assert.equal(parseRosterQuery(new URLSearchParams('status=discharged&page=-2&locationId=x%22y')).status, 'DISCHARGED');
  assert.equal(parseRosterQuery(new URLSearchParams('page=-2')).page, 1);
  assert.equal(parseRosterQuery(new URLSearchParams('locationId=x%22y')).locationId, null, 'odd ids dropped');
  assert.equal(parseRosterQuery(new URLSearchParams('status=bogus')).status, 'ACTIVE');
});

test('roster search: name / MRN contains, or an exact DOB', () => {
  assert.equal(rosterSearchWhere('  '), null);
  const byName = JSON.stringify(rosterSearchWhere('smith'));
  assert.ok(byName.includes('"name":{"contains":"smith","mode":"insensitive"}'));
  assert.ok(byName.includes('"mrn":{"contains":"smith","mode":"insensitive"}'));
  const dob = parseDobQuery('03/07/1980');
  assert.ok(dob);
  assert.equal(dob.gte.toISOString(), '1980-03-07T00:00:00.000Z');
  assert.equal(dob.lt.toISOString(), '1980-03-08T00:00:00.000Z');
  assert.equal(parseDobQuery('1980-03-07')?.gte.toISOString(), '1980-03-07T00:00:00.000Z');
  assert.equal(parseDobQuery('02/30/1980'), null, 'not a real date');
  assert.deepEqual(rosterSearchWhere('1980-03-07'), { dateOfBirth: parseDobQuery('1980-03-07') });
});

test('roster where: viewer access AND the primary-care rule (never location alone) AND filters', () => {
  const access = clientAccessWhere({ organizationId: 'org-a', actorUserId: 'u1', actorRole: 'PHYSICIAN' });
  const base = primaryCareRosterWhere({ access, query: parseRosterQuery(new URLSearchParams('status=all')) }) as { AND: Prisma.ClientWhereInput[] };
  assert.equal(base.AND.length, 2);
  assert.deepEqual(base.AND[0], access, 'org + care team scope first');
  assert.deepEqual(base.AND[1], primaryCarePatientWhere());
  const rule = JSON.stringify(base.AND[1]);
  for (const k of ['"primaryCare":true', '"medicalVisits":{"some":{}}', '"medicalVitals":{"some":{}}', '"medicalCharges":{"some":{}}', '"facility":{"equals":"Family Practice"']) assert.ok(rule.includes(k), k);
  assert.ok(!rule.includes('location') && !rule.includes('medicalProblems'), 'location / DrFirst problems never qualify a client');
  // Medical roles: the care team rule (assigned, treatment team, medical visit, appointment)
  const scope = JSON.stringify(access);
  for (const k of ['"assignedToId":"u1"', '"treatmentTeamMembers":{"some":{"providerId":"u1"}}', '"medicalVisits":{"some":{"providerId":"u1"}}', '"appointments":{"some":{"clinicianId":"u1"}}']) assert.ok(scope.includes(k), k);
  // Caseload roles: own caseload only
  assert.ok(JSON.stringify(clientAccessWhere({ organizationId: 'org-a', actorUserId: 'u9', actorRole: 'PSYCHIATRIST' })).includes('"assignedToId":"u9"'));

  const filtered = primaryCareRosterWhere({
    access,
    query: parseRosterQuery(new URLSearchParams('locationId=loc_ss&providerId=doc1&q=ann')),
  }) as { AND: Prisma.ClientWhereInput[] };
  const s = JSON.stringify(filtered);
  assert.ok(s.includes('"status":"ACTIVE"'));
  assert.ok(s.includes('"locationId":"loc_ss"'));
  assert.ok(s.includes('"treatmentTeamMembers":{"some":{"providerId":"doc1"}}') && s.includes('"medicalVisits":{"some":{"providerId":"doc1"}}'));
  assert.ok(s.includes('"contains":"ann"'));
});

test('primary care provider: the "Primary Care Provider" care team member, else intake text; never inferred from visits', () => {
  const team = [
    { providerId: 't1', name: 'Pat Therapist', credentials: 'LCSW', isPrimary: true, role: 'Therapist' },
    { providerId: 'd2', name: 'Dee Intake', credentials: 'MD', isPrimary: false, role: 'Primary Care Physician' },
    { providerId: 'd1', name: 'Dana Doc', credentials: 'MD', isPrimary: false, role: 'Primary Care Provider' },
  ];
  assert.deepEqual(pickPrimaryCareProvider(team, 'Someone Else'), { id: 'd1', name: 'Dana Doc, MD', source: 'care_team' });
  // A physician on the care team (e.g. who did intake) is not the PCP by itself
  assert.deepEqual(pickPrimaryCareProvider(team.slice(0, 2), 'Nia NP'), { id: null, name: 'Nia NP', source: 'assigned_pcp_text' });
  assert.equal(pickPrimaryCareProvider(team.slice(0, 2), null), null);
  assert.equal(pickPrimaryCareProvider(team.slice(0, 2), '  '), null);
  assert.deepEqual(problemCounts([
    { icd10Code: 'I10', status: 'Active' },
    { icd10Code: null, status: 'Chronic' },
    { icd10Code: '', status: 'Resolved' },
  ]), { active: 2, needsCoding: 1 });
});

test('columns follow the primary care page rules', () => {
  assert.deepEqual(rosterColumnsForRole('PHYSICIAN'), { problems: true, visits: true, vitals: true, labs: true });
  const fd = rosterColumnsForRole('FRONT_DESK');
  assert.equal(fd.problems || fd.visits || fd.vitals, false, 'front desk: demographics + scheduling only');
  assert.equal(rosterColumnsForRole('MEDICAL_ASSISTANT').vitals, true);
});

function row(i: number, over: Partial<RosterClientRow> = {}): RosterClientRow {
  return {
    id: `c${i}`,
    name: `Patient ${i}`,
    mrn: `MRN${i}`,
    dateOfBirth: new Date('1980-10-18T00:00:00Z'),
    gender: 'female',
    status: 'ACTIVE',
    locationName: 'Bowie',
    team: [{ providerId: 'd1', name: 'Dana Doc', credentials: null, isPrimary: true, role: 'Primary Care Provider' }],
    lastVisit: { visitDate: new Date('2026-10-01T15:00:00Z'), visitType: 'Follow-up', providerId: 'd1', providerName: null, providerUserName: 'Dana Doc' },
    lastVitalsAt: new Date('2026-10-01T15:10:00Z'),
    problems: [{ icd10Code: null, status: 'Active' }],
    nextAppointment: { startsAt: new Date('2026-10-20T14:00:00Z'), type: 'Primary care follow-up', clinicianName: 'Dana Doc' },
    ...over,
  };
}

function fakeSource(total: number, opts: { locked?: Map<string, string | null> | null } = {}) {
  const calls: { count: Prisma.ClientWhereInput[]; page: [Prisma.ClientWhereInput, number, number][]; labs: string[][] } = { count: [], page: [], labs: [] };
  const source: RosterSource = {
    primaryCareLocations: async (org) => (org === 'org-a' ? [{ id: 'loc_ss', name: 'Silver Spring' }, { id: 'loc_bw', name: 'Bowie' }] : []),
    providers: async () => [{ id: 'd1', name: 'Dana Doc' }],
    count: async (where) => {
      calls.count.push(where);
      return total;
    },
    page: async (where, skip, take) => {
      calls.page.push([where, skip, take]);
      return Array.from({ length: Math.max(0, Math.min(take, total - skip)) }, (_, k) => row(skip + k + 1));
    },
    userRoles: async () => new Map([['d1', 'PHYSICIAN']]),
    lockedAliases: async () => (opts.locked === undefined ? new Map() : opts.locked),
    labSignals: async (_org, ids) => {
      calls.labs.push(ids);
      return new Map([['c51', { unreviewed: 2, critical: 1, standingDue: 0, standingOverdue: 1 }]]);
    },
  };
  return { source, calls };
}

const physician = { organizationId: 'org-a', userId: 'd1', role: 'PHYSICIAN' };
const access = clientAccessWhere({ organizationId: 'org-a', actorUserId: 'd1', actorRole: 'PHYSICIAN' });

test('roster paging: server-side skip/take with total; past-the-end pages clamp', async () => {
  const { source, calls } = fakeSource(60);
  const r = await loadPrimaryCareRoster(source, physician, access, parseRosterQuery(new URLSearchParams('page=3')), NOW);
  assert.equal(r.total, 60);
  assert.equal(r.pageCount, 3);
  assert.equal(r.page, 3);
  assert.deepEqual(calls.page[0].slice(1), [50, 25]);
  assert.equal(r.rows.length, 10);
  assert.deepEqual(calls.count[0], calls.page[0][0], 'count and page use the same where');
  assert.deepEqual((calls.count[0] as { AND: unknown[] }).AND[0], access, 'scoped to the viewer');

  const late = fakeSource(60);
  const r2 = await loadPrimaryCareRoster(late.source, physician, access, parseRosterQuery(new URLSearchParams('page=9')), NOW);
  assert.equal(r2.page, 3);
  assert.deepEqual(late.calls.page[0].slice(1), [50, 25]);

  const empty = fakeSource(0);
  const r3 = await loadPrimaryCareRoster(empty.source, physician, access, parseRosterQuery(new URLSearchParams()), NOW);
  assert.deepEqual([r3.total, r3.rows.length, r3.pageCount, empty.calls.page.length], [0, 0, 1, 0], 'no page query when empty');
});

test('roster rows: chart link with back param, real data only, labs for lab viewers', async () => {
  const { source, calls } = fakeSource(60);
  const r = await loadPrimaryCareRoster(source, physician, access, parseRosterQuery(new URLSearchParams('page=3')), NOW);
  const first = r.rows[0];
  assert.equal(first.clientId, 'c51');
  assert.equal(first.href, '/dashboard/clients/c51?tab=medical-visits&from=medical');
  assert.equal(first.href, primaryCareChartHref('c51'));
  assert.equal(first.age, 45);
  assert.equal(first.sex, 'F');
  assert.deepEqual(first.pcp, { id: 'd1', name: 'Dana Doc', source: 'care_team' });
  assert.deepEqual(first.problems, { active: 1, needsCoding: 1 });
  assert.deepEqual(first.labs, { unreviewed: 2, critical: 1, standingDue: 0, standingOverdue: 1 });
  assert.equal(r.rows[1].labs?.unreviewed, 0);
  assert.equal(calls.labs[0].length, 10);
  assert.ok(!('preventiveCare' in first), 'preventive care is not stored, so not shown');

  // Front desk: no clinical columns (data left out server-side), no lab lookup
  const fd = fakeSource(3);
  const fdRows = await loadPrimaryCareRoster(fd.source, { ...physician, role: 'FRONT_DESK' }, access, parseRosterQuery(new URLSearchParams()), NOW);
  assert.equal(fdRows.rows[0].problems, null);
  assert.equal(fdRows.rows[0].lastVisit, null);
  assert.equal(fdRows.rows[0].lastVitalsAt, null);
  assert.ok(fdRows.rows[0].nextAppointment, 'scheduling info stays');
});

test('roster: location filter limited to this org primary-care locations', async () => {
  const ok = fakeSource(1);
  const r = await loadPrimaryCareRoster(ok.source, physician, access, parseRosterQuery(new URLSearchParams('locationId=loc_ss')), NOW);
  assert.equal(r.query.locationId, 'loc_ss');
  assert.ok(JSON.stringify(ok.calls.count[0]).includes('"locationId":"loc_ss"'));
  const other = fakeSource(1);
  const r2 = await loadPrimaryCareRoster(other.source, physician, access, parseRosterQuery(new URLSearchParams('locationId=loc_baltimore')), NOW);
  assert.equal(r2.query.locationId, null, 'unknown / other-org location id ignored');
  assert.ok(!JSON.stringify(other.calls.count[0]).includes('loc_baltimore'));
  assert.deepEqual(r.filters.locations.map((l) => l.name), ['Silver Spring', 'Bowie']);
});

test('roster: Part 2 / protected clients are masked; lookup failure masks every row', async () => {
  const { source } = fakeSource(2, { locked: new Map([['c1', 'Client A']]) });
  const r = await loadPrimaryCareRoster(source, physician, access, parseRosterQuery(new URLSearchParams()), NOW);
  const masked = r.rows.find((x) => x.clientId === 'c1')!;
  assert.equal(masked.locked, true);
  assert.equal(masked.name, 'Client A');
  assert.deepEqual([masked.mrn, masked.dob, masked.pcp, masked.problems, masked.labs, masked.nextAppointment], [null, null, null, null, null, null]);
  assert.equal(r.rows.find((x) => x.clientId === 'c2')!.locked, false);
  assert.equal(r.maskedCount, 1);

  const failed = fakeSource(2, { locked: null });
  const r2 = await loadPrimaryCareRoster(failed.source, physician, access, parseRosterQuery(new URLSearchParams()), NOW);
  assert.ok(r2.rows.every((x) => x.locked && x.name === 'Protected Client'), 'fail closed');
});

test('roster route: same page gate, roster role rule, viewer scope, audited; chart back link', () => {
  const route = read('src/app/api/medical/patients/route.ts');
  assert.match(route, /searchParams\.get\('view'\) === 'roster'\) return rosterGet/);
  const roster = route.slice(route.indexOf('async function rosterGet'));
  assert.match(roster, /canAccessClientRoster\(gate\.role\)/);
  assert.match(roster, /outcome: 'DENIED'/);
  assert.match(roster, /clientAccessWhere\(\{ organizationId: gate\.organizationId, actorUserId: gate\.userId, actorRole: gate\.role \}\)/);
  assert.match(roster, /auditPhiAccess\(\{[\s\S]*view: 'roster'[\s\S]*total: result\.total/);
  // deniedRole (canAccessPath '/dashboard/medical/patients') runs before the roster branch
  assert.ok(route.indexOf("deniedRole(gate, req, 'LIST')") < route.indexOf("get('view') === 'roster'"));

  assert.match(read('src/app/dashboard/clients/[id]/page.tsx'), /searchParams\?\.get\('from'\) === 'medical'[\s\S]{0,200}Back to Primary care patients/);
  assert.match(read('src/features/medical/components/MedicalNavHeader.tsx'), /href: '\/dashboard\/medical\/patients', label: 'Patients'/);
  // Nothing in the primary care area links to the client list filter
  for (const rel of [
    'src/features/medical/components/MedicalNavHeader.tsx',
    'src/app/dashboard/medical/patients/page.tsx',
    'src/app/dashboard/medical/patients/intake/page.tsx',
    'src/app/dashboard/medical/page.tsx',
  ]) {
    assert.ok(!/\/dashboard\/clients\?program=medical|MEDICAL_CLIENTS_HREF/.test(read(rel)), rel);
  }
});
