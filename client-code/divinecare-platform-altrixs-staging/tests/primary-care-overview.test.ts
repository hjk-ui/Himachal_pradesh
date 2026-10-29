import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Prisma } from '@prisma/client';
import { clientAccessWhere, medicalCareTeamClientWhere, clientOrgFilter } from '../src/lib/clients/orgScope';
import { primaryCarePatientWhere } from '../src/lib/medical/medicalProgram';
import { isCaseloadRole } from '../src/types/roles';
import {
  loadPrimaryCareOverview,
  overviewQueuesForRole,
  overviewScopeForRole,
  primaryCareClinicianWhere,
  todayAppointmentsWhere,
  unsignedVisitsWhere,
  type OverviewSource,
  type OverviewViewer,
  type TodayAppointmentRow,
} from '../src/lib/medical/primaryCareOverview';

const root = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
const ET = 'America/New_York';
// 2026-10-17 01:30 UTC = Oct 16, 9:30 PM ET: the practice day is still Oct 16
const LATE_EVENING_UTC = new Date('2026-10-17T01:30:00Z');
const NOON_UTC = new Date('2026-10-17T16:00:00Z'); // Oct 17, 12:00 PM ET

type Recorded = { appointments?: Prisma.AppointmentWhereInput; clients: Prisma.ClientWhereInput[]; visits?: Prisma.MedicalVisitWhereInput; rx: number };

function fakeSource(rows: TodayAppointmentRow[], opts: { locked?: Map<string, string | null> | null; vitals?: string[] } = {}) {
  const rec: Recorded = { clients: [], rx: 0 };
  const source: OverviewSource = {
    async todayAppointments(where, take) {
      rec.appointments = where;
      return rows.slice(0, take);
    },
    async lockedAliases() {
      return opts.locked === undefined ? new Map() : opts.locked;
    },
    async vitalsRecorded(ids) {
      return new Set((opts.vitals ?? []).filter((id) => ids.includes(id)));
    },
    async countClients(where) {
      rec.clients.push(where);
      return 7;
    },
    async clientsByLocation() {
      return [
        { locationId: 'loc-ss', count: 4 },
        { locationId: null, count: 1 },
        { locationId: 'loc-bw', count: 5 },
      ];
    },
    async locationNames() {
      return new Map([
        ['loc-ss', 'Silver Spring'],
        ['loc-bw', 'Bowie'],
      ]);
    },
    async countVisits(where) {
      rec.visits = where;
      return 2;
    },
    async countProblems() {
      return 3;
    },
    async labsAwaitingReview() {
      return { toReview: 4, critical: 1 };
    },
    async standingOverdue() {
      return 5;
    },
    async rxPending() {
      rec.rx += 1;
      return { refills: 1, rxChanges: 2 };
    },
  };
  return { source, rec };
}

const viewer = (role: string, userId = 'u-doc'): OverviewViewer => ({ organizationId: 'org-a', userId, role, isCaseload: isCaseloadRole(role) });
const access = (v: OverviewViewer) => clientAccessWhere({ organizationId: v.organizationId, actorUserId: v.userId, actorRole: v.role as never });

const appt = (over: Partial<TodayAppointmentRow>): TodayAppointmentRow => ({
  id: 'a1',
  clientId: 'c1',
  clientName: 'Pat One',
  startsAt: new Date('2026-10-17T13:00:00Z'), // 9:00 AM ET
  type: 'Annual physical',
  status: 'SCHEDULED',
  isVirtual: false,
  clinicianName: 'Dr. Provider',
  ...over,
});

test('overview scope: physician / medical NP = own schedule; MA = care team; leadership = organization', () => {
  assert.equal(overviewScopeForRole('PHYSICIAN', true), 'provider');
  assert.equal(overviewScopeForRole('MEDICAL_NP', true), 'provider');
  assert.equal(overviewScopeForRole('MEDICAL_ASSISTANT', true), 'care_team');
  assert.equal(overviewScopeForRole('THERAPIST', true), 'caseload');
  assert.equal(overviewScopeForRole('PRACTICE_DIRECTOR', false), 'organization');
  assert.equal(overviewScopeForRole('ADMIN', false), 'organization');
});

test('overview population: medical roles use the care-team rule; leadership the whole org', async () => {
  const doc = viewer('PHYSICIAN');
  const docAccess = access(doc);
  assert.deepEqual(docAccess, { AND: [clientOrgFilter('org-a'), medicalCareTeamClientWhere('u-doc')] });
  const { source, rec } = fakeSource([]);
  await loadPrimaryCareOverview(source, doc, docAccess, { timeZone: ET, now: NOON_UTC });
  // Every panel count is over (care team AND primary-care patient)
  assert.ok(rec.clients.length >= 3);
  for (const w of rec.clients) {
    const s = JSON.stringify(w);
    assert.ok(s.includes(JSON.stringify(medicalCareTeamClientWhere('u-doc'))), 'care team scope');
    assert.ok(s.includes(JSON.stringify(primaryCarePatientWhere())), 'primary-care rule');
  }
  // Own appointments and own unsigned notes
  assert.ok(JSON.stringify(rec.appointments).includes('"clinicianId":"u-doc"'));
  assert.ok(JSON.stringify(rec.visits).includes('"providerId":"u-doc"'));

  const dir = viewer('PRACTICE_DIRECTOR', 'u-dir');
  const dirAccess = access(dir);
  assert.deepEqual(dirAccess, clientOrgFilter('org-a'));
  const lead = fakeSource([]);
  await loadPrimaryCareOverview(lead.source, dir, dirAccess, { timeZone: ET, now: NOON_UTC });
  for (const w of lead.rec.clients) assert.ok(!JSON.stringify(w).includes('treatmentTeamMembers'), 'no care-team filter for leadership');
  const a = JSON.stringify(lead.rec.appointments);
  assert.ok(!a.includes('"clinicianId":"u-dir"'), 'not limited to the director');
  assert.ok(a.includes(JSON.stringify(primaryCareClinicianWhere())), 'only physician / medical NP appointments');
  assert.ok(!JSON.stringify(lead.rec.visits).includes('providerId'), 'all unsigned notes in the org');
  assert.equal(lead.rec.rx, 0, 'refill queue is per prescriber');
});

test('today window: practice-clock day bounds, not UTC', async () => {
  const w = todayAppointmentsWhere({ access: {}, scope: 'organization', userId: 'x', start: new Date(0), end: new Date(1) });
  assert.ok(JSON.stringify(w).includes('"status":{"not":"CANCELLED"}'));

  const { source, rec } = fakeSource([]);
  const r = await loadPrimaryCareOverview(source, viewer('PHYSICIAN'), access(viewer('PHYSICIAN')), { timeZone: ET, now: LATE_EVENING_UTC });
  assert.equal(r.date, '2026-10-16', '9:30 PM ET is still Oct 16 at the practice');
  assert.equal(r.windowStart, '2026-10-16T04:00:00.000Z', 'midnight EDT');
  assert.equal(r.windowEnd, '2026-10-17T04:00:00.000Z');
  const range = JSON.stringify(rec.appointments);
  assert.ok(range.includes('"gte":"2026-10-16T04:00:00.000Z","lt":"2026-10-17T04:00:00.000Z"'));
});

test('today rows: "9:00 AM ET", chart medical tab link with from=medical, vitals missing, protected masked', async () => {
  const rows = [
    appt({ id: 'a1', clientId: 'c1', status: 'CHECKED_IN' }),
    appt({ id: 'a2', clientId: 'c2', status: 'COMPLETED', startsAt: new Date('2026-10-17T14:30:00Z') }),
    appt({ id: 'a3', clientId: 'c3', status: 'SCHEDULED', clientName: 'Hidden Name', type: 'Hidden type' }),
  ];
  const { source } = fakeSource(rows, { vitals: ['c2'], locked: new Map([['c3', 'Client A-3']]) });
  const r = await loadPrimaryCareOverview(source, viewer('PHYSICIAN'), access(viewer('PHYSICIAN')), { timeZone: ET, now: NOON_UTC });
  const [one, two, three] = r.today.rows;
  assert.equal(one.time, '9:00 AM ET');
  assert.equal(one.href, '/dashboard/clients/c1?tab=medical-visits&from=medical');
  assert.equal(one.visitType, 'Annual physical');
  assert.equal(one.statusLabel, 'Checked in');
  assert.equal(one.vitalsMissing, true, 'checked in, no vitals today');
  assert.equal(two.time, '10:30 AM ET');
  assert.equal(two.vitalsMissing, false);
  assert.equal(three.locked, true);
  assert.equal(three.href, null);
  assert.equal(three.patient, 'Client A-3');
  assert.equal(three.visitType, 'Protected appointment');
  assert.ok(!JSON.stringify(r).includes('Hidden Name') && !JSON.stringify(r).includes('Hidden type'));
  assert.equal(r.queues.find((q) => q.key === 'vitals_missing')?.count, 1);
});

test('protected lookup failure masks every row (fail closed)', async () => {
  const { source } = fakeSource([appt({})], { locked: null });
  const r = await loadPrimaryCareOverview(source, viewer('PHYSICIAN'), access(viewer('PHYSICIAN')), { timeZone: ET, now: NOON_UTC });
  assert.equal(r.today.rows[0].locked, true);
  assert.equal(r.today.rows[0].patient, 'Protected Client');
});

test('queues and panel: counts with links; role-gated queues left out', async () => {
  const { source } = fakeSource([]);
  const r = await loadPrimaryCareOverview(source, viewer('PHYSICIAN'), access(viewer('PHYSICIAN')), { timeZone: ET, now: NOON_UTC });
  const byKey = Object.fromEntries(r.queues.map((q) => [q.key, q]));
  assert.equal(byKey.unsigned_visits.count, 2);
  assert.equal(byKey.unsigned_visits.href, '/dashboard/medical/visits');
  assert.equal(byKey.labs_to_review.count, 4);
  assert.equal(byKey.labs_critical.count, 1);
  assert.equal(byKey.standing_overdue.count, 5);
  assert.equal(byKey.problems_needs_coding.href, '/dashboard/medical/problem-list');
  assert.equal(byKey.rx_requests.count, 3);
  assert.deepEqual(r.panel.byLocation.map((l) => l.name), ['Bowie', 'Silver Spring', 'No location on file']);
  assert.equal(r.panel.active, 7);
  assert.deepEqual(r.links, {
    intake: '/dashboard/medical/patients/intake',
    patients: '/dashboard/medical/patients',
    labs: '/dashboard/medical/labs',
    vitals: '/dashboard/medical/vitals',
  });

  const ma = overviewQueuesForRole('MEDICAL_ASSISTANT');
  assert.equal(ma.problems, false, 'no problem list for medical assistants');
  assert.equal(ma.rx, false);
  assert.equal(overviewQueuesForRole('FRONT_DESK').visits, false);
  assert.ok(JSON.stringify(unsignedVisitsWhere({ population: {}, scope: 'provider', userId: 'u' })).includes('"signedAt":null'));
});

test('overview route: same role rule as the page, audited LIST', () => {
  const src = read('src/app/api/medical/overview/route.ts');
  assert.match(src, /canAccessPath\(gate\.role, MEDICAL_OVERVIEW_PATH\)/);
  assert.match(src, /action: 'LIST'/);
  assert.match(src, /outcome: 'DENIED'/);
  assert.match(src, /clientAccessWhere\(/);
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|jsx?)$/.test(f) ? [p] : [];
  });
}

test('no sample data in the primary care pages', () => {
  assert.equal(existsSync(join(root, 'src/features/medical/data.ts')), false, 'sample data module removed');
  const banned = [
    /features\/medical\/data['"]/,
    /getMedicalPatients\b/,
    /getCriticalLabAlerts\b/,
    /getMedicalClaims\b/,
    /INITIAL_[A-Z_]+/,
    /DEFAULT_PAYERS|DEFAULT_RULES|CANONICAL_PAYERS|CANONICAL_RULES/,
    /\bseedIfEmpty\b/,
  ];
  const files = [...walk(join(root, 'src/app/dashboard/medical')), ...walk(join(root, 'src/app/api/medical')), ...walk(join(root, 'src/features/medical'))];
  assert.ok(files.length > 10);
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    for (const re of banned) assert.ok(!re.test(src), `${f.slice(root.length)} matches ${re}`);
  }
  const page = read('src/app/dashboard/medical/page.tsx');
  assert.match(page, /\/api\/medical\/overview|MEDICAL_OVERVIEW_API/);
});
