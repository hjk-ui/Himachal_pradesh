import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildPracticeCensus,
  censusCsv,
  censusService,
  isWalkIn,
  practiceYmd,
  statusCounts,
  storedDayYmd,
  trendDates,
  type CensusAppointment,
  type CensusInput,
} from '../src/lib/locations/census';
import { practiceDayBounds } from '../src/lib/dashboard/practiceDay';
import { buildPracticeOverview, lastMonths, monthKey } from '../src/lib/locations/overview';
import { canAccessPath } from '../src/lib/auth/roleAccess';
import {
  capacityEntrySchema,
  occupancyByLevel,
  openRoomLabels,
  summarizeCapacity,
  totalOccupancy,
  occupancyLabel,
} from '../src/lib/residential/capacity';

const TZ = 'America/New_York';
const ROOT = path.join(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const LOCS = [
  { id: 'bow', name: 'Bowie', active: true },
  { id: 'ss', name: 'Silver Spring', active: true },
];

function appt(p: Partial<CensusAppointment> & { clientId: string; startsAt: Date }): CensusAppointment {
  return {
    clinicianId: 'u1', clinicianName: 'Dr. One', clinicianRole: 'THERAPIST', type: 'Individual Therapy', notes: null, isVirtual: false,
    status: 'SCHEDULED', appointmentLocation: null, clientLocationId: 'bow', protected: false, ...p,
  };
}

function input(p: Partial<CensusInput> & { date: string }): CensusInput {
  const window = practiceDayBounds(p.date, TZ);
  return {
    now: new Date(window.start.getTime() + 15 * 3_600_000),
    timeZone: TZ,
    window,
    locations: LOCS,
    locationId: null,
    appointments: [],
    prpAttendance: [],
    tmsSessions: [],
    spravatoSessions: [],
    residents: [],
    unlinkedResidents: 0,
    capacity: [],
    crisisEpisodes: [],
    caseload: { activeClients: [], prpActive: [], primaryCareActive: [], tmsActive: [], spravatoActive: [] },
    appointmentLocationColumn: true,
    ...p,
  };
}

// ─── status buckets ──────────────────────────────────────────────────────────

test('status buckets: booked excludes cancelled, remaining = not arrived + checked in', () => {
  const c = statusCounts(['SCHEDULED', 'SCHEDULED', 'CHECKED_IN', 'IN_SESSION', 'COMPLETED', 'NO_SHOW', 'LATE_CANCEL', 'CANCELLED', 'CANCELLED']);
  assert.deepEqual(c, { booked: 7, notArrived: 2, checkedIn: 1, inSession: 1, completed: 1, noShow: 1, lateCancel: 1, cancelled: 2, remaining: 3 });
  assert.deepEqual(statusCounts([]).booked, 0);
});

test('service classification: medical clinician / primary-care type, Valant code, type text', () => {
  assert.equal(censusService({ clinicianRole: 'PHYSICIAN', type: 'Follow up', notes: null }), 'primary_care');
  assert.equal(censusService({ clinicianRole: 'THERAPIST', type: 'Family Practice visit', notes: null }), 'primary_care');
  assert.equal(censusService({ clinicianRole: 'PSYCHIATRIST', type: 'Appointment', notes: 'Valant code: 99214' }), 'med_management');
  assert.equal(censusService({ clinicianRole: 'THERAPIST', type: 'Individual Therapy', notes: null }), 'therapy');
  assert.equal(censusService({ clinicianRole: null, type: 'Telehealth', notes: null }), 'unknown');
  assert.equal(censusService({ clinicianRole: null, type: 'Group', notes: null }), 'other');
  assert.equal(isWalkIn({ type: 'Walk-in intake' }), true);
  assert.equal(isWalkIn({ type: 'Intake' }), false);
});

// ─── practice day / DST ──────────────────────────────────────────────────────

test('practice-day window: fall-back day is 25 h, spring-forward 23 h, instants bucket by practice clock', () => {
  const fall = practiceDayBounds('2026-11-01', TZ);
  assert.equal(fall.end.getTime() - fall.start.getTime(), 25 * 3_600_000);
  const spring = practiceDayBounds('2026-03-08', TZ);
  assert.equal(spring.end.getTime() - spring.start.getTime(), 23 * 3_600_000);
  assert.equal(practiceYmd(new Date('2026-11-02T04:30:00Z'), TZ), '2026-11-01'); // 11:30 PM EST
  assert.equal(practiceYmd(new Date('2026-11-01T03:59:00Z'), TZ), '2026-10-31'); // 11:59 PM EDT
  assert.equal(practiceYmd(new Date('2026-11-02T05:00:00Z'), TZ), '2026-11-02');
  // date-only columns (00:00 UTC) keep their calendar date; other instants use the practice clock
  assert.equal(storedDayYmd(new Date('2026-10-18T00:00:00.000Z'), TZ), '2026-10-18');
  assert.equal(storedDayYmd(new Date('2026-10-19T02:00:00.000Z'), TZ), '2026-10-18');
  assert.deepEqual(trendDates('2026-11-03').slice(-3), ['2026-11-01', '2026-11-02', '2026-11-03']);
  assert.equal(trendDates('2026-11-03').length, 14);
});

test('census on the DST fall-back day counts the 25th hour and excludes the evening before', () => {
  const c = buildPracticeCensus(
    input({
      date: '2026-11-01',
      appointments: [
        appt({ clientId: 'a', startsAt: new Date('2026-11-01T04:30:00Z'), status: 'COMPLETED' }), // 00:30 EDT Nov 1
        appt({ clientId: 'b', startsAt: new Date('2026-11-02T04:30:00Z'), status: 'COMPLETED' }), // 23:30 EST Nov 1
        appt({ clientId: 'c', startsAt: new Date('2026-11-01T03:30:00Z'), status: 'COMPLETED' }), // 23:30 EDT Oct 31
      ],
    })
  );
  assert.equal(c.totals.appointments.counts.completed, 2);
  assert.equal(c.trend.find((d) => d.date === '2026-10-31')?.completed, 1);
});

// ─── census math ─────────────────────────────────────────────────────────────

const D = '2026-10-18';
const at = (hhmm: string) => new Date(`${D}T${hhmm}:00-04:00`);

function sampleInput(extra: Partial<CensusInput> = {}) {
  return input({
    date: D,
    appointments: [
      appt({ clientId: 'a', startsAt: at('09:00'), status: 'COMPLETED' }),
      appt({ clientId: 'a', startsAt: at('14:00'), status: 'CHECKED_IN', clinicianId: 'u2', clinicianName: 'NP Two', clinicianRole: 'NP', type: 'Medication Management' }),
      appt({ clientId: 'b', startsAt: at('10:00'), status: 'NO_SHOW', isVirtual: true }),
      appt({ clientId: 'c', startsAt: at('11:00'), status: 'SCHEDULED', appointmentLocation: 'ss', clientLocationId: 'bow' }),
      appt({ clientId: 'd', startsAt: at('12:00'), status: 'CANCELLED', clientLocationId: 'ss' }),
      appt({ clientId: 'e', startsAt: at('13:00'), status: 'IN_SESSION', clientLocationId: null, clinicianId: null, clinicianName: null, protected: true }),
      appt({ clientId: 'f', startsAt: at('15:00'), status: 'COMPLETED', type: 'Walk-in', clientLocationId: 'ss', clinicianRole: 'PHYSICIAN' }),
      // yesterday: trend only
      appt({ clientId: 'a', startsAt: new Date('2026-10-17T15:00:00Z'), status: 'COMPLETED' }),
    ],
    prpAttendance: [
      { clientId: 'a', clientLocationId: 'bow', date: new Date(`${D}T00:00:00.000Z`) },
      { clientId: 'g', clientLocationId: 'ss', date: new Date(`${D}T00:00:00.000Z`) },
      { clientId: 'g', clientLocationId: 'ss', date: new Date('2026-10-17T00:00:00.000Z') },
    ],
    tmsSessions: [{ clientId: 'h', clientLocationId: 'bow', date: new Date(`${D}T00:00:00.000Z`) }],
    spravatoSessions: [{ clientId: 'a', clientLocationId: 'bow', date: new Date(`${D}T14:00:00.000Z`) }],
    crisisEpisodes: [
      { clientLocationId: 'bow', startedAt: at('08:00'), priority: 1 },
      { clientLocationId: null, startedAt: new Date('2026-10-18T03:00:00Z'), priority: 2 }, // Oct 17 11 PM EDT
    ],
    caseload: {
      activeClients: [{ locationId: 'bow', count: 40 }, { locationId: 'ss', count: 10 }, { locationId: null, count: 3 }],
      prpActive: [{ locationId: 'ss', count: 5 }],
      primaryCareActive: [{ locationId: 'ss', count: 7 }],
      tmsActive: [{ locationId: 'bow', count: 1 }],
      spravatoActive: [],
    },
    ...extra,
  });
}

test('census: buckets, unique clients seen across appointments + programs, clinicians, walk-ins, Part 2 counts', () => {
  const c = buildPracticeCensus(sampleInput());
  const t = c.totals.appointments.counts;
  assert.deepEqual([t.booked, t.completed, t.checkedIn, t.inSession, t.noShow, t.cancelled, t.notArrived, t.remaining], [6, 2, 1, 1, 1, 1, 1, 2]);
  // seen: a (appts, PRP, Spravato), e, f, g (PRP), h (TMS) — b no-show and c not arrived do not count
  assert.equal(c.totals.uniqueClientsSeen, 5);
  assert.equal(c.totals.appointments.clientsSeen, 3);
  assert.equal(c.totals.appointments.telehealth, 1);
  assert.equal(c.totals.appointments.inPerson, 5);
  assert.deepEqual(c.totals.prp, { encounters: 2, clients: 2 });
  assert.deepEqual(c.totals.tms, { encounters: 1, clients: 1 });
  assert.deepEqual(c.totals.spravato, { encounters: 1, clients: 1 });
  assert.equal(c.totals.walkIns, 1);
  assert.equal(c.totals.protectedAppointments, 1);
  assert.equal(c.crisis.opened, 1);
  assert.deepEqual(c.crisis.byPriority, { '1': 1 });

  const bow = c.locations.find((l) => l.locationId === 'bow')!;
  const ss = c.locations.find((l) => l.locationId === 'ss')!;
  const none = c.locations.find((l) => l.locationId === null)!;
  assert.equal(bow.appointments.counts.booked, 3); // a x2, b
  assert.equal(ss.appointments.counts.booked, 2); // c (appointment location), f; d cancelled
  assert.equal(ss.appointments.counts.cancelled, 1);
  assert.equal(none.appointments.counts.booked, 1);
  assert.equal(c.locations[c.locations.length - 1].locationId, null, 'No location row last');
  assert.equal(ss.byService.find((g) => g.key === 'primary_care')?.counts.completed, 1);
  assert.equal(bow.byService.find((g) => g.key === 'med_management')?.counts.checkedIn, 1);
  assert.equal(bow.uniqueClientsSeen, 2); // a, h
  assert.equal(ss.uniqueClientsSeen, 2); // f, g

  const u1 = c.clinicians.find((g) => g.key === 'u1')!;
  assert.equal(u1.counts.booked, 4);
  assert.equal(c.clinicians[c.clinicians.length - 1].label, 'No clinician assigned');

  const yesterday = c.trend.find((d) => d.date === '2026-10-17')!;
  assert.deepEqual([yesterday.completed, yesterday.clientsSeen], [1, 2]); // a appt + g PRP
  const today = c.trend[c.trend.length - 1];
  assert.equal(today.date, D);
  assert.equal(today.clientsSeen, c.totals.uniqueClientsSeen);

  assert.equal(c.caseload.totals.activeClients, 53);
  assert.equal(c.caseload.rows.find((r) => r.locationId === null)?.activeClients, 3);
  assert.equal(c.when, 'today');
});

test('census: location filter scopes appointments (effective location), programs, crisis and caseload', () => {
  const c = buildPracticeCensus(sampleInput({ locationId: 'ss' }));
  assert.equal(c.location?.name, 'Silver Spring');
  assert.deepEqual(c.locations.map((l) => l.locationId), ['ss']);
  assert.equal(c.totals.appointments.counts.booked, 2);
  assert.equal(c.totals.uniqueClientsSeen, 2);
  assert.deepEqual(c.totals.prp, { encounters: 1, clients: 1 });
  assert.equal(c.totals.tms.encounters, 0);
  assert.equal(c.crisis.opened, 0);
  assert.equal(c.caseload.totals.activeClients, 10);
  assert.equal(c.caseload.totals.prpActive, 5);
  assert.equal(c.trend.find((d) => d.date === '2026-10-17')?.clientsSeen, 1);
  // unknown location id is ignored by the pure builder (the server rejects it with 400)
  assert.equal(buildPracticeCensus(sampleInput({ locationId: 'elsewhere' })).location, null);
});

test('census CSV: counts only, no client ids, formula-safe', () => {
  const c = buildPracticeCensus(sampleInput({ appointments: [appt({ clientId: 'client_secret_id', startsAt: at('09:00'), status: 'COMPLETED', clinicianName: '=HYPERLINK("x")' })] }));
  const csv = censusCsv(c);
  assert.ok(!csv.includes('client_secret_id'));
  assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`));
  assert.ok(csv.startsWith('Practice census,2026-10-18'));
  assert.ok(csv.includes('Beds not configured'));
});

// ─── capacity ────────────────────────────────────────────────────────────────

test('capacity unset: no default beds, occupancy unknown, "Beds not configured"', () => {
  const s = summarizeCapacity([]);
  assert.equal(s.configured, false);
  assert.equal(s.totalBeds, null);
  const occ = occupancyByLevel(s, ['3.5', '3.5', '3.1']);
  assert.deepEqual(occ.map((o) => [o.level, o.beds, o.residents, o.open]), [['3.1', null, 1, null], ['3.5', null, 2, null], ['3.7', null, 0, null]]);
  assert.deepEqual(totalOccupancy(occ), { residents: 3, beds: null, open: null, occupancyPct: null });
  assert.equal(occupancyLabel({ residents: 3, beds: null }), '3 residents · Beds not configured');

  const c = buildPracticeCensus(input({ date: D, residents: [{ clientLocationId: 'bow', program: '3.5', admitDate: new Date(`${D}T00:00:00.000Z`), active: true, updatedAt: at('09:00') }] }));
  assert.equal(c.residential.configured, false);
  assert.equal(c.residential.total.beds, null);
  assert.equal(c.residential.total.residents, 1);
  assert.equal(c.residential.admissions, 1);
});

test('capacity set: beds per location and level, open beds, rooms, over capacity, site attribution', () => {
  const rows = [
    { locationId: 'bow', asamLevel: '3.5', beds: 2, rooms: ['B-1', 'B-2'] },
    { locationId: 'bow', asamLevel: '3.1', beds: 4, rooms: [] },
  ];
  const s = summarizeCapacity(rows);
  assert.equal(s.configured, true);
  assert.equal(s.totalBeds, 6);
  const occ = occupancyByLevel(s, ['3.5', '3.5', '3.5', '3.1']);
  const l35 = occ.find((o) => o.level === '3.5')!;
  assert.deepEqual([l35.beds, l35.residents, l35.open, l35.overCapacity, l35.occupancyPct], [2, 3, 0, 1, 150]);
  assert.equal(occ.find((o) => o.level === '3.7')!.beds, null);
  assert.deepEqual(openRoomLabels(s, '3.5', ['b-1 ']), ['B-2']);
  assert.deepEqual(openRoomLabels(s, '3.1', []), []);
  assert.equal(summarizeCapacity(rows, 'ss').configured, false);

  // one configured site: every resident counts there, even with another home location
  const c = buildPracticeCensus(
    input({
      date: D,
      capacity: rows,
      residents: [
        { clientLocationId: 'ss', program: '3.5', admitDate: new Date('2026-10-01T00:00:00.000Z'), active: true, updatedAt: at('09:00') },
        { clientLocationId: 'bow', program: '3.1', admitDate: new Date('2026-09-01T00:00:00.000Z'), active: false, updatedAt: at('10:00') },
      ],
    })
  );
  assert.equal(c.residential.attribution, 'residential_site');
  assert.deepEqual([c.residential.total.residents, c.residential.total.beds, c.residential.total.open], [1, 6, 5]);
  assert.equal(c.residential.discharges, 1);
  assert.equal(c.locations.find((l) => l.locationId === 'bow')?.residents, 1);
  assert.equal(c.caseload.rows.find((r) => r.locationId === 'bow')?.residentialResidents, 1);
  // Silver Spring filter: no beds configured there and no residents attributed there
  const ss = buildPracticeCensus(input({ date: D, capacity: rows, locationId: 'ss', residents: c.residential.total.residents ? [{ clientLocationId: 'ss', program: '3.5', admitDate: new Date('2026-10-01T00:00:00.000Z'), active: true, updatedAt: at('09:00') }] : [] }));
  assert.equal(ss.residential.configured, false);
  assert.equal(ss.residential.total.residents, 0);
});

test('capacity input validation', () => {
  assert.equal(capacityEntrySchema.safeParse({ locationId: 'bow', asamLevel: '3.5', beds: 8, rooms: 'A, B , ,A' }).success, false, 'rooms must match beds');
  const ok = capacityEntrySchema.parse({ locationId: 'bow', asamLevel: '3.5', beds: 2, rooms: 'A, B , ,A' });
  assert.deepEqual(ok.rooms, ['A', 'B']);
  assert.equal(capacityEntrySchema.safeParse({ locationId: 'bow', asamLevel: '3.3', beds: 2 }).success, false);
  assert.equal(capacityEntrySchema.safeParse({ locationId: 'bow', asamLevel: '3.1', beds: -1 }).success, false);
  assert.equal(capacityEntrySchema.parse({ locationId: 'bow', asamLevel: '3.1', beds: null }).beds, null);
});

// ─── wiring ──────────────────────────────────────────────────────────────────

test('no hard-coded residential beds; census wired with the overview gate and audit', () => {
  const page = read('src/app/dashboard/residential/page.tsx');
  assert.ok(!/beds:\s*\d/.test(page), 'residential page has no fixed bed counts');
  assert.ok(!/const ROOMS\b/.test(page), 'residential page has no fixed room list');
  assert.ok(page.includes('/api/residential/capacity'));
  const board = read('src/app/api/residential/bed-board/route.ts');
  assert.ok(!/totalBeds\s*=\s*\d/.test(board), 'bed board has no fixed total');
  assert.match(board, /auditPhiAccess/);
  const route = read('src/app/api/locations/census/route.ts');
  assert.match(route, /requireOverviewViewer\(\)/);
  assert.match(route, /PRACTICE_CENSUS_EXPORT/);
  assert.match(read('src/app/api/locations/overview/route.ts'), /requireOverviewViewer\(\)/);
  // mapping edits and the client-location recompute stay leadership only
  assert.match(read('src/app/api/locations/facility-map/route.ts'), /requireLeadership\(\)/);
  assert.match(read('src/app/api/locations/client-locations/route.ts'), /requireLeadership\(\)/);
  const server = read('src/lib/locations/server.ts');
  assert.match(server, /OVERVIEW_VIEWERS = new Set\(\[\.\.\.LEADERSHIP, 'OFFICE_MANAGER'\]\)/);
  assert.match(read('src/lib/locations/overviewServer.ts'), /clientOrgFilter\(organizationId\)/);
  assert.match(read('src/app/dashboard/enterprise/page.tsx'), /altrixs:enterprise-tab/);
  assert.match(read('src/components/layout/SidebarLocationSwitcher.tsx'), /altrixs:enterprise-tab/);
  assert.match(read('src/app/dashboard/enterprise/page.tsx'), /CensusTab/);
  assert.match(read('src/components/layout/SidebarLocationSwitcher.tsx'), /\/dashboard\/enterprise\?tab=census/);
  const migration = read('prisma/migrations/20261018_residential_capacity.sql');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS residential_capacity/);
  assert.ok(!/INSERT INTO/i.test(migration), 'no seeded beds');
});

// ─── overview: access + practice-clock windows ───────────────────────────────

test('Office Manager reads the Practice overview / Census; Locations admin stays leadership', () => {
  for (const r of ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'OFFICE_MANAGER']) assert.equal(canAccessPath(r, '/dashboard/enterprise'), true, r);
  for (const r of ['THERAPIST', 'FRONT_DESK', 'BILLING_SPECIALIST']) assert.equal(canAccessPath(r, '/dashboard/enterprise'), false, r);
  assert.equal(canAccessPath('OFFICE_MANAGER', '/dashboard/admin/locations'), false);
  assert.equal(canAccessPath('OFFICE_MANAGER', '/dashboard/practice-setup'), false);
});

test('overview months and 90-day window use the practice clock, not UTC', () => {
  // 11:30 PM ET on Sep 30 is Oct 1 in UTC
  const lateSep = new Date('2026-10-01T03:30:00Z');
  assert.equal(monthKey(lateSep), '2026-10');
  assert.equal(monthKey(lateSep, TZ), '2026-09');
  // 9 PM ET Oct 31 = Nov 1 UTC: still October on the practice clock
  assert.deepEqual(lastMonths(new Date('2026-11-01T01:00:00Z'), 2, TZ), ['2026-09', '2026-10']);
  const now = new Date('2026-10-17T16:00:00Z'); // noon EDT
  const base = {
    now, timeZone: TZ, organizationName: 'P',
    locations: [{ id: 'bow', name: 'Bowie', code: null, addressLine1: null, addressLine2: null, city: null, state: null, postalCode: null, phone: null, timezone: TZ, active: true, isPrimary: true }],
    clientGroups: [], newClientGroups: [], primaryCareFlagGroups: [], appointmentLocationColumn: true, valantGroups: [], facilityHomeGroups: [],
    journalRowCount: 0, mappings: [], staffLinks: [], staff: [],
  };
  const o = buildPracticeOverview({
    ...base,
    appointments: [
      // 90 practice days ending Oct 17 start Jul 20 00:00 EDT (Jul 20 04:00 UTC)
      { clientLocationId: 'bow', appointmentLocation: null, status: 'COMPLETED', startsAt: new Date('2026-07-20T04:30:00Z') },
      { clientLocationId: 'bow', appointmentLocation: null, status: 'COMPLETED', startsAt: new Date('2026-07-20T03:30:00Z') }, // Jul 19 ET: out
      { clientLocationId: 'bow', appointmentLocation: null, status: 'COMPLETED', startsAt: lateSep },
      // upcoming through the end of practice day Nov 16 (Nov 17 05:00 UTC, after DST ends)
      { clientLocationId: 'bow', appointmentLocation: null, status: 'SCHEDULED', startsAt: new Date('2026-11-17T04:30:00Z') },
      { clientLocationId: 'bow', appointmentLocation: null, status: 'SCHEDULED', startsAt: new Date('2026-11-17T05:30:00Z') },
    ],
  });
  const bow = o.locations[0];
  assert.equal(bow.appointments.last90.completed, 2);
  assert.equal(bow.appointments.upcoming30, 1);
  const sep = o.months.find((m) => m.month === '2026-09')!;
  const oct = o.months.find((m) => m.month === '2026-10')!;
  assert.equal(sep.byLocation.bow.completed, 1);
  assert.equal(oct.byLocation.bow.completed, 0);
});
