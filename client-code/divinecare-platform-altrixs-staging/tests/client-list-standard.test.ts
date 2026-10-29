import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  DEFAULT_VIEW_STATE,
  ageFromDob,
  clientFilterWheres,
  clientSearchWhere,
  clientSortName,
  clinicianWhere,
  compareByLastName,
  hasPhiRevealingFilter,
  lastNameInitial,
  listDisplayName,
  matchesLetter,
  needsDemographicsWhere,
  parseClientListQuery,
  parseClientSearch,
  parseDobQuery,
  phoneSearchVariants,
  sortClients,
  viewStateFromParams,
  viewStateToApiParams,
  viewStateToParams,
  type SortableClient,
} from '../src/lib/clients/listQuery';
import {
  buildCaseloadCounts,
  canViewCaseloadCounts,
  caseloadAcuity,
  caseloadClientWhere,
  caseloadHeadcount,
} from '../src/lib/clients/caseloadCounts';
import { scoreMatches } from '../src/features/caseload/algorithms';

const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

// ─── Query params ───────────────────────────────────────────────────────────

test('parseClientListQuery: valid values kept, unknown values ignored', () => {
  const q = parseClientListQuery(
    new URLSearchParams('q=smith&sort=dob&letter=s&status=active&risk=high&program=prp&clinicianId=u1&clinicianRole=team&mine=1&noUpcoming=1&needsDemographics=true&limit=50&skip=100')
  );
  assert.equal(q.search, 'smith');
  assert.equal(q.sort, 'dob');
  assert.equal(q.dir, 'asc', 'DOB defaults to ascending');
  assert.equal(q.letter, 'S');
  assert.equal(q.status, 'ACTIVE');
  assert.equal(q.risk, 'HIGH');
  assert.equal(q.program, 'prp');
  assert.equal(q.clinicianId, 'u1');
  assert.equal(q.clinicianRole, 'team');
  assert.equal(q.mine, true);
  assert.equal(q.noUpcoming, true);
  assert.equal(q.needsDemographics, true);
  assert.equal(q.take, 50);
  assert.equal(q.skip, 100);

  const bad = parseClientListQuery(new URLSearchParams('sort=salary&dir=up&letter=AB&status=WAITLIST&risk=extreme&program=spa&limit=-4'));
  assert.equal(bad.sort, undefined, 'no sort = legacy order for pickers');
  assert.equal(bad.letter, undefined);
  assert.equal(bad.status, undefined);
  assert.equal(bad.risk, undefined);
  assert.equal(bad.program, undefined);
  assert.equal(bad.take, 250);
  assert.equal(parseClientListQuery(new URLSearchParams('limit=9999')).take, 500, 'capped');
  assert.equal(parseClientListQuery(new URLSearchParams('sort=lastSeen')).dir, 'desc', 'last seen starts newest first');
  assert.equal(parseClientListQuery(new URLSearchParams('letter=%23')).letter, '#');
});

// ─── Search ─────────────────────────────────────────────────────────────────

test('search parsing: "Last, First", either word order, DOB, phone', () => {
  assert.deepEqual(parseClientSearch('Smith, Jo').lastFirst, { last: 'Smith', first: 'Jo' });
  assert.deepEqual(parseClientSearch('jo  smith').words, ['jo', 'smith']);
  assert.deepEqual(parseClientSearch('smith').words, []);
  const dob = parseClientSearch('03/07/1990').dob!;
  assert.equal(dob.start.toISOString(), '1990-03-07T00:00:00.000Z');
  assert.equal(dob.end.toISOString(), '1990-03-08T00:00:00.000Z');
  assert.equal(parseDobQuery('3/7/1990')!.start.toISOString(), '1990-03-07T00:00:00.000Z');
  assert.equal(parseDobQuery('1990-03-07')!.start.toISOString(), '1990-03-07T00:00:00.000Z');
  assert.equal(parseDobQuery('02/31/1990'), null, 'impossible date');
  assert.equal(parseDobQuery('13/01/1990'), null);
  assert.equal(parseClientSearch('(301) 555-1234').phoneDigits, '3015551234');
  assert.equal(parseClientSearch('1-301-555-1234').phoneDigits, '3015551234');
  assert.equal(parseClientSearch('1234').phoneDigits, '1234', 'last four');
  assert.equal(parseClientSearch('12').phoneDigits, undefined);
  assert.ok(phoneSearchVariants('3015551234').includes('(301) 555-1234'));
  assert.ok(phoneSearchVariants('3015551234').includes('301-555-1234'));
});

test('search where: name fields, MRN, Valant id; diagnosis code only when allowed; DOB is an exact day', () => {
  const w = clientSearchWhere('Smith, Jo', { diagnosisCode: false }) as { OR: Array<Record<string, unknown>> };
  const json = JSON.stringify(w);
  assert.match(json, /"legalLastName":\{"startsWith":"Smith","mode":"insensitive"\}/);
  assert.match(json, /"preferredName"/);
  assert.match(json, /"mrn"/);
  assert.match(json, /"sourceId":\{"equals":"Smith, Jo"/);
  assert.doesNotMatch(json, /primaryDiagnosisCode/);
  assert.match(JSON.stringify(clientSearchWhere('F33', { diagnosisCode: true })), /primaryDiagnosisCode/);
  assert.doesNotMatch(JSON.stringify(clientSearchWhere('1234', { diagnosisCode: false })), /medicaidId|insuranceMemberId/, 'member ids not searched');
  const dob = clientSearchWhere('03/07/1990', { diagnosisCode: true }) as { dateOfBirth: { gte: Date; lt: Date } };
  assert.equal(dob.dateOfBirth.gte.toISOString(), '1990-03-07T00:00:00.000Z');
  assert.equal(clientSearchWhere('   ', { diagnosisCode: true }), null);
});

// ─── Filters ────────────────────────────────────────────────────────────────

test('filters: real enum values, payer only when insurance is visible, clinician primary / care team', () => {
  const now = new Date('2026-10-24T12:00:00Z');
  const and = clientFilterWheres(
    {
      status: 'ACTIVE',
      locationId: 'loc1',
      clinicianId: 'u1',
      clinicianRole: 'any',
      payer: 'Maryland Medicaid',
      risk: 'HIGH',
      program: 'prp',
      noUpcoming: true,
      needsDemographics: false,
      unassigned: true,
    },
    { insurance: false, now }
  );
  const json = JSON.stringify(and);
  assert.match(json, /"status":"ACTIVE"/);
  assert.match(json, /"locationId":"loc1"/);
  assert.match(json, /"riskLevel":"HIGH"/);
  assert.match(json, /prpEnrollments/);
  assert.match(json, /"appointments":\{"none"/);
  assert.match(json, /"treatmentTeamMembers":\{"none":\{\}\}/);
  assert.doesNotMatch(json, /insurancePayer/, 'payer filter ignored for roles without insurance');
  assert.match(JSON.stringify(clientFilterWheres({ payer: 'Aetna', clinicianRole: 'any', noUpcoming: false, needsDemographics: false, unassigned: false }, { insurance: true })), /"insurancePayer":\{"equals":"Aetna"/);
  assert.deepEqual(clinicianWhere('u1', 'primary'), { assignedToId: 'u1' });
  assert.deepEqual(clinicianWhere('u1', 'team'), {
    AND: [{ treatmentTeamMembers: { some: { providerId: 'u1' } } }, { NOT: { assignedToId: 'u1' } }],
  });
  assert.match(JSON.stringify(needsDemographicsWhere()), /dateOfBirth":null.*needsNameReview|needsNameReview.*dateOfBirth":null/);
  assert.equal(hasPhiRevealingFilter({ risk: 'HIGH' }), true);
  assert.equal(hasPhiRevealingFilter({}), false);
});

// ─── Sort ───────────────────────────────────────────────────────────────────

const rows: SortableClient[] = [
  { id: '1', name: 'Zed Adams', legalFirstName: 'Zed', legalLastName: 'adams', dateOfBirth: new Date('1980-01-01'), mrn: 'A-0003' },
  { id: '2', name: 'amy Baker', legalFirstName: null, legalLastName: null, dateOfBirth: null, mrn: 'A-0001' },
  { id: '3', name: 'Al Adams', legalFirstName: 'Al', legalLastName: 'Adams', dateOfBirth: new Date('1995-06-01'), mrn: 'A-0002' },
  { id: '4', name: "Pat O'Neil", legalFirstName: 'Pat', legalLastName: "O'Neil", lastSeenAt: new Date('2026-10-01') },
  { id: '5', name: 'Mary Jane van Dyke', legalFirstName: '', legalLastName: '', lastSeenAt: new Date('2026-09-01') },
];

test('sort name: legal last + first, display-name fallback, case-insensitive', () => {
  assert.deepEqual(clientSortName(rows[1]), { last: 'baker', first: 'amy' });
  assert.deepEqual(clientSortName(rows[4]), { last: 'jane van dyke', first: 'mary' });
  assert.deepEqual(sortClients(rows, 'last', 'asc').map((r) => r.id), ['3', '1', '2', '5', '4']);
  assert.deepEqual(sortClients(rows, 'last', 'desc').map((r) => r.id), ['4', '5', '2', '3', '1']);
  assert.deepEqual(sortClients(rows, 'first', 'asc').map((r) => r.id), ['3', '2', '5', '4', '1']);
  assert.deepEqual(sortClients(rows, 'mrn', 'asc').map((r) => r.id).slice(0, 3), ['2', '3', '1']);
});

test('sort dates: missing values last in both directions, ties by name', () => {
  assert.deepEqual(sortClients(rows, 'dob', 'asc').map((r) => r.id), ['1', '3', '2', '5', '4']);
  assert.deepEqual(sortClients(rows, 'dob', 'desc').map((r) => r.id), ['3', '1', '2', '5', '4']);
  assert.deepEqual(sortClients(rows, 'lastSeen', 'desc').map((r) => r.id).slice(0, 2), ['4', '5']);
});

test('letter bar: last-name initial, # for anything else', () => {
  assert.equal(lastNameInitial(rows[0]), 'A');
  assert.equal(lastNameInitial(rows[1]), 'B');
  assert.equal(lastNameInitial({ name: 'Prince' }), '#', 'single name has no last name');
  assert.equal(lastNameInitial({ legalLastName: 'Ávila', legalFirstName: 'Ana' }), 'A', 'accents fold');
  assert.equal(lastNameInitial({ legalLastName: '3rd', legalFirstName: 'X' }), '#');
  assert.equal(matchesLetter(rows[3], 'O'), true);
  assert.equal(matchesLetter(rows[3], 'P'), false);
  assert.equal(matchesLetter(rows[3], undefined), true);
});

test('display: "Last, First" with preferred name; age from DOB; picker comparator', () => {
  assert.deepEqual(listDisplayName({ legalLastName: 'Smith', legalFirstName: 'Robert', preferredName: 'Bob', name: 'Robert Smith' }), {
    primary: 'Smith, Robert',
    preferred: 'Bob',
  });
  assert.deepEqual(listDisplayName({ name: 'Amy Baker', preferredName: 'amy' }), { primary: 'Baker, Amy', preferred: null });
  assert.equal(listDisplayName({ name: 'Prince' }).primary, 'Prince');
  assert.equal(ageFromDob('1990-10-25', new Date('2026-10-24T12:00:00Z')), 35);
  assert.equal(ageFromDob('1990-10-24', new Date('2026-10-24T12:00:00Z')), 36);
  assert.equal(ageFromDob(null), null);
  const picker = [{ name: 'Zed Adams' }, { name: 'amy Baker' }, { name: 'Al Adams' }].sort(compareByLastName).map((c) => c.name);
  assert.deepEqual(picker, ['Al Adams', 'Zed Adams', 'amy Baker']);
});

test('view state round-trips through the URL; defaults stay out of the URL; API params are explicit', () => {
  assert.equal(viewStateToParams(DEFAULT_VIEW_STATE).toString(), '');
  const s = { ...DEFAULT_VIEW_STATE, q: 'smith', sort: 'dob' as const, dir: 'desc' as const, letter: 'S', status: 'ALL' as const, risk: 'HIGH' as const, pageSize: 100, page: 2, mine: true };
  const back = viewStateFromParams(viewStateToParams(s));
  assert.deepEqual(back, s);
  const api = viewStateToApiParams(s, { locationId: 'loc1' });
  assert.equal(api.get('sort'), 'dob');
  assert.equal(api.get('skip'), '200');
  assert.equal(api.get('limit'), '100');
  assert.equal(api.get('withTotal'), '1');
  assert.equal(api.get('status'), null, 'ALL sends no status');
  assert.equal(api.get('locationId'), 'loc1');
  assert.equal(viewStateFromParams(new URLSearchParams('pageSize=7&page=0&status=bogus')).pageSize, 50);
});

// ─── Caseload counts ────────────────────────────────────────────────────────

test('caseload counts: primary = assignedToId; care team excludes the primary and de-duplicates', () => {
  const r = buildCaseloadCounts({
    primaryByRisk: [
      { assignedToId: 'u1', riskLevel: 'HIGH', _count: { _all: 2 } },
      { assignedToId: 'u1', riskLevel: 'LOW', _count: { _all: 40 } },
      { assignedToId: 'u2', riskLevel: 'MEDIUM', _count: { _all: 3 } },
      { assignedToId: null, riskLevel: 'LOW', _count: { _all: 9 } },
    ],
    primaryUpcoming: [{ assignedToId: 'u1', _count: { _all: 30 } }],
    teamRows: [
      { providerId: 'u1', clientId: 'c1', client: { assignedToId: 'u1', riskLevel: 'LOW' } }, // primary too: not counted again
      { providerId: 'u2', clientId: 'c1', client: { assignedToId: 'u1', riskLevel: 'LOW' } },
      { providerId: 'u2', clientId: 'c1', client: { assignedToId: 'u1', riskLevel: 'LOW' } }, // second role row, same client
      { providerId: 'u3', clientId: 'c2', client: { assignedToId: null, riskLevel: 'HIGH' } },
      { providerId: null, clientId: 'c3', client: { assignedToId: null, riskLevel: 'LOW' } },
    ],
    unassigned: 5,
    activeTotal: 60,
  });
  assert.equal(r.counts.u1.primary, 42);
  assert.equal(r.counts.u1.highRisk, 2);
  assert.equal(r.counts.u1.lowRisk, 40);
  assert.equal(r.counts.u1.careTeam, 0);
  assert.equal(r.counts.u1.upcomingAppointments, 30);
  assert.equal(r.counts.u2.primary, 3);
  assert.equal(r.counts.u2.careTeam, 1);
  assert.equal(r.counts.u3.careTeam, 1);
  assert.equal(r.counts.u3.careTeamHighRisk, 1);
  assert.equal(r.unassigned, 5);
  assert.equal(caseloadHeadcount(r.counts.u2), 4);
  assert.equal(caseloadHeadcount(undefined), 0);
  assert.equal(caseloadAcuity(r.counts.u1), 42 * 10 + 2 * 15);
  assert.equal(caseloadAcuity(r.counts.u3), 10 + 15);
});

test('caseload counts: active clients in scope at the selected location only; role gate', () => {
  const scope = { organizationId: 'org1' };
  assert.deepEqual(caseloadClientWhere(scope, 'loc1'), { AND: [scope, { status: 'ACTIVE' }, { locationId: 'loc1' }] });
  assert.deepEqual(caseloadClientWhere(scope, null), { AND: [scope, { status: 'ACTIVE' }] });
  assert.equal(canViewCaseloadCounts('PRACTICE_DIRECTOR'), true);
  assert.equal(canViewCaseloadCounts('FRONT_DESK'), true);
  assert.equal(canViewCaseloadCounts('THERAPIST'), false);
  assert.equal(canViewCaseloadCounts('HR'), false);
});

test('warm handoff / intake matching use server counts, not the loaded page', () => {
  const staff = [
    { id: 'u1', name: 'A', role: 'therapist', credential: '', color: '', maxCaseload: 30, specialties: [], languages: [], acceptedPayers: [] },
  ] as any;
  const pageClients = [{ id: 'c1', treatmentTeam: { primaryTherapistId: 'u1' }, risk: 'low' }] as any;
  const counts = buildCaseloadCounts({
    primaryByRisk: [{ assignedToId: 'u1', riskLevel: 'LOW', _count: { _all: 27 } }],
    primaryUpcoming: [],
    teamRows: [],
    unassigned: 0,
    activeTotal: 27,
  }).counts;
  assert.equal(scoreMatches({}, staff, pageClients, 'primaryTherapistId', counts)[0].assignedCount, 27);
  assert.equal(scoreMatches({}, staff, pageClients, 'primaryTherapistId')[0].assignedCount, 1, 'legacy behaviour without counts');
});

// ─── Wiring ─────────────────────────────────────────────────────────────────

test('wiring: scope, audit, page controls, caseload view reads the server', () => {
  const manage = read('src/lib/clients/manage.ts');
  assert.match(manage, /clientAccessWhere\(\{/);
  assert.match(manage, /A pinned page is still re-scoped \(clientAccessWhere\)/);
  assert.match(manage, /maskClientPii\(base, actor\.role\)/);
  assert.match(manage, /resolveSensitiveAccessMap/);
  const route = read('src/app/api/clients/route.ts');
  assert.match(route, /auditPhiAccess\(\{[\s\S]*action: 'LIST'/);
  assert.match(route, /parseClientListQuery\(url\.searchParams\)/);
  const counts = read('src/app/api/clients/caseload-counts/route.ts');
  assert.match(counts, /auditPhiAccess/);
  assert.match(counts, /clientAccessWhere\(/);
  assert.match(counts, /groupBy/);
  const page = read('src/app/dashboard/clients/page.tsx');
  assert.match(page, /aria-sort=/);
  assert.match(page, /Filter by last name initial/);
  assert.match(page, /viewStateToParams/);
  assert.match(page, /localStorage/);
  assert.match(page, /groupProviders\(/);
  assert.doesNotMatch(page, /getVisibleClientsForUser/, 'the server scopes the list; no client-side narrowing of a page');
  const view = read('src/features/caseload/components/CaseloadAnalyticsView.tsx');
  assert.match(view, /useCaseloadCounts\(/);
  assert.doesNotMatch(view, /calculateStaffCaseload/);
  assert.match(view, /Primary caseload/);
  assert.match(view, /Also on care team/);
  assert.match(read('src/features/caseload/components/WarmHandoffModal.tsx'), /useCaseloadCounts\(/);
  assert.match(read('src/app/dashboard/clients/intake/page.tsx'), /useCaseloadCounts\(/);
  assert.match(read('src/features/appointments/ClientSearchField.tsx'), /sort: 'last'/);
});
