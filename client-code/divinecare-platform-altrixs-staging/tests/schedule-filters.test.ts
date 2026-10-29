import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  NO_LABEL_KEY,
  UNASSIGNED_KEY,
  activeChips,
  activeFilterCount,
  applyScheduleFilters,
  defaultFilters,
  distinctOptions,
  effectiveStatus,
  emptyFilters,
  filtersFromQuery,
  filtersToQuery,
  loadRememberedFilters,
  loadSavedViews,
  matchesClientSearch,
  programOf,
  rememberFilters,
  removeChip,
  savedViewFilters,
  storeSavedViews,
  upsertSavedView,
  visitMode,
  type FilterableAppointment,
  type ScheduleFilters,
  type StorageLike,
} from '../src/features/appointments/filters';
import { monthGrid, shiftDate, visibleDates, weekDates } from '../src/features/appointments/scheduleNav';

const TODAY = '2026-10-19';
const ctx = { userId: 'me', today: TODAY, clinicianRoles: { doc: 'PHYSICIAN', me: 'THERAPIST' } };

function appt(over: Partial<FilterableAppointment> & { id: string }): FilterableAppointment {
  return {
    clientName: 'Jane Doe',
    clinicianId: 'me',
    type: 'Individual Therapy',
    date: TODAY,
    status: 'scheduled',
    noteStatus: 'not-started',
    isVirtual: false,
    audioOnly: false,
    labelId: null,
    seriesId: null,
    confirmedAt: null,
    ...over,
  };
}

const LIST: FilterableAppointment[] = [
  appt({ id: 'a1', clientName: 'Jane Doe', clientMrn: 'MRN-0042', siteId: 'loc-bowie', payer: 'Maryland Medicaid', isNewClient: true }),
  appt({ id: 'a2', clientName: 'John Smith', clinicianId: 'other', confirmedAt: '2026-10-18T12:00:00Z', siteId: 'loc-ss', payer: 'Aetna', labelId: 'lbl-1' }),
  appt({ id: 'a3', clientName: 'Ann Lee', status: 'cancelled', clinicianId: 'other' }),
  appt({ id: 'a4', clientName: 'Bo Park', status: 'no-show' }),
  appt({ id: 'a5', clientName: 'Cy Ray', status: 'late-cancel' }),
  appt({ id: 'a6', clientName: 'Di Wu', status: 'completed', noteStatus: 'in-progress', isVirtual: true, seriesId: 's1' }),
  appt({ id: 'a7', clientName: 'Ed Fox', status: 'completed', noteStatus: 'signed', isVirtual: true, audioOnly: true }),
  appt({ id: 'a8', clientName: 'Flo Kim', type: 'PRP Session', clinicianId: null, date: '2026-10-21' }),
  appt({ id: 'a9', clientName: 'Gus Hart', type: 'Medication Management', clinicianId: 'doc', status: 'checked-in' }),
  appt({ id: 'a10', clientName: 'Hal Ito', type: 'IOP Group', status: 'in-session', noteStatus: 'not-started' }),
];
const ids = (list: FilterableAppointment[]) => list.map((a) => a.id);
const run = (f: Partial<ScheduleFilters>) => ids(applyScheduleFilters(LIST, { ...emptyFilters(), ...f }, ctx));

test('empty filters show everything', () => {
  assert.equal(run({}).length, LIST.length);
  assert.equal(activeFilterCount(emptyFilters()), 0);
});

test('provider multi-select, unassigned, and My schedule', () => {
  assert.deepEqual(run({ providers: ['other'] }), ['a2', 'a3']);
  assert.deepEqual(run({ providers: ['doc', UNASSIGNED_KEY] }), ['a8', 'a9']);
  assert.deepEqual(run({ mine: true }), ['a1', 'a4', 'a5', 'a6', 'a7', 'a10']);
  // My schedule with no signed-in id narrows nothing (never hides everything by accident)
  assert.equal(applyScheduleFilters(LIST, { ...emptyFilters(), mine: true }, { today: TODAY }).length, LIST.length);
});

test('location (client site) incl. no site on file', () => {
  assert.deepEqual(run({ locations: ['loc-ss'] }), ['a2']);
  assert.equal(run({ locations: [UNASSIGNED_KEY] }).length, LIST.length - 2);
});

test('appointment type from the data', () => {
  assert.deepEqual(run({ types: ['PRP Session', 'IOP Group'] }), ['a8', 'a10']);
  const opts = distinctOptions(LIST, (a) => a.type);
  assert.deepEqual(opts.map((o) => o.value), ['Individual Therapy', 'IOP Group', 'Medication Management', 'PRP Session']);
  assert.equal(opts.find((o) => o.value === 'Individual Therapy')?.count, 7);
});

test('status incl. confirmed (patient replied C) vs scheduled', () => {
  assert.equal(effectiveStatus(LIST[1]), 'confirmed');
  assert.equal(effectiveStatus(LIST[0]), 'scheduled');
  assert.deepEqual(run({ statuses: ['confirmed'] }), ['a2']);
  assert.deepEqual(run({ statuses: ['scheduled'] }), ['a1', 'a8']);
  assert.deepEqual(run({ statuses: ['checked-in', 'in-session'] }), ['a9', 'a10']);
});

test('hide cancelled / no-shows; an explicit status pick overrides it', () => {
  assert.deepEqual(run({ hideCancelled: true }), ['a1', 'a2', 'a6', 'a7', 'a8', 'a9', 'a10']);
  assert.deepEqual(run({ hideCancelled: true, statuses: ['no-show'] }), ['a4']);
  // header metrics can still count no-shows
  const all = applyScheduleFilters(LIST, { ...emptyFilters(), hideCancelled: true }, ctx, { ignoreHide: true });
  assert.equal(all.length, LIST.length);
});

test('visit mode: in person / video / audio only', () => {
  assert.equal(visitMode(LIST[5]), 'video');
  assert.equal(visitMode(LIST[6]), 'audio');
  assert.deepEqual(run({ modes: ['video', 'audio'] }), ['a6', 'a7']);
  assert.equal(run({ modes: ['in-person'] }).length, LIST.length - 2);
});

test('calendar label incl. no label', () => {
  assert.deepEqual(run({ labels: ['lbl-1'] }), ['a2']);
  assert.equal(run({ labels: [NO_LABEL_KEY] }).length, LIST.length - 1);
});

test('program from type and medical provider role', () => {
  assert.equal(programOf(LIST[7]), 'prp');
  assert.equal(programOf(LIST[9]), 'iop');
  assert.equal(programOf(LIST[8], ctx), 'primary-care');
  assert.equal(programOf({ type: 'Residential Check-in', clinicianId: null }), 'residential');
  assert.equal(programOf({ type: 'Annual Physical', clinicianId: null }), 'primary-care');
  assert.equal(programOf(LIST[0], ctx), 'omhc');
  assert.deepEqual(run({ programs: ['prp', 'primary-care'] }), ['a8', 'a9']);
});

test('payer incl. none on file', () => {
  assert.deepEqual(run({ payers: ['Aetna'] }), ['a2']);
  assert.equal(run({ payers: [UNASSIGNED_KEY] }).length, LIST.length - 2);
});

test('client search by name words or MRN', () => {
  assert.equal(matchesClientSearch(LIST[0], 'doe jane'), true);
  assert.equal(matchesClientSearch(LIST[0], 'mrn0042'), true);
  assert.equal(matchesClientSearch(LIST[0], '0042'), true);
  assert.equal(matchesClientSearch(LIST[0], 'smith'), false);
  assert.deepEqual(run({ q: 'john' }), ['a2']);
});

test('quick filters', () => {
  assert.deepEqual(run({ quick: ['new'] }), ['a1']);
  assert.deepEqual(run({ quick: ['unconfirmed'] }), ['a1', 'a8']);
  assert.deepEqual(run({ quick: ['needs-checkin'] }), ['a1', 'a2']);
  assert.deepEqual(run({ quick: ['unsigned'] }), ['a6', 'a10']);
  assert.deepEqual(run({ quick: ['recurring'] }), ['a6']);
  // past unconfirmed visits are not "unconfirmed" work
  assert.deepEqual(ids(applyScheduleFilters([appt({ id: 'old', date: '2026-10-01' })], { ...emptyFilters(), quick: ['unconfirmed'] }, ctx)), []);
});

test('filters combine with AND across fields, OR within a field', () => {
  assert.deepEqual(run({ mine: true, modes: ['video', 'audio'], quick: ['unsigned'] }), ['a6']);
  assert.deepEqual(run({ hideCancelled: true, providers: ['other'] }), ['a2']);
  assert.deepEqual(run({ types: ['Individual Therapy'], statuses: ['completed'], modes: ['audio'] }), ['a7']);
});

test('defaults by role: clinical roles on My schedule, front desk / leadership on all', () => {
  for (const r of ['THERAPIST', 'PSYCHIATRIST', 'NP', 'PHYSICIAN', 'MEDICAL_NP', 'PRP_SPECIALIST', 'CASE_MANAGER', 'PEER_SUPPORT', 'CLINICIAN']) {
    assert.equal(defaultFilters(r).mine, true, r);
  }
  for (const r of ['FRONT_DESK', 'OFFICE_MANAGER', 'ADMIN', 'PRACTICE_DIRECTOR', 'DIRECTOR', 'SUPER_ADMIN', 'BILLING', 'MEDICAL_ASSISTANT', undefined]) {
    assert.equal(defaultFilters(r).mine, false, String(r));
  }
  assert.equal(defaultFilters('PSYCHIATRIST', { leadership: true }).mine, false);
  // hide cancelled / no-shows is on by default for everyone
  assert.equal(defaultFilters('FRONT_DESK').hideCancelled, true);
  assert.equal(defaultFilters('THERAPIST').hideCancelled, true);
});

test('URL round-trip keeps every filter and other params', () => {
  const f: ScheduleFilters = {
    providers: ['u2', 'u1'],
    mine: true,
    locations: ['loc-ss'],
    types: ['PRP Session', 'Family Therapy'],
    statuses: ['confirmed', 'no-show'],
    modes: ['audio'],
    labels: [NO_LABEL_KEY, 'lbl-1'],
    programs: ['prp'],
    payers: ['Aetna', UNASSIGNED_KEY],
    q: 'Doe & Sons',
    quick: ['unsigned', 'new'],
    hideCancelled: false,
  };
  const qs = filtersToQuery(f, new URLSearchParams('view=calendar&d=2026-10-19&status=junk'));
  assert.equal(qs.get('view'), 'calendar');
  assert.equal(qs.get('d'), '2026-10-19');
  const back = filtersFromQuery(new URLSearchParams(qs.toString()))!;
  const sorted = (x: ScheduleFilters) => ({ ...x, providers: [...x.providers].sort(), types: [...x.types].sort(), statuses: [...x.statuses].sort(), labels: [...x.labels].sort(), payers: [...x.payers].sort(), quick: [...x.quick].sort() });
  assert.deepEqual(back, sorted(f));
  assert.equal(filtersFromQuery(filtersToQuery(defaultFilters('FRONT_DESK')))!.hideCancelled, true);
});

test('URL without f=1 is not filter state; junk values are dropped', () => {
  assert.equal(filtersFromQuery(new URLSearchParams('view=list')), null);
  const f = filtersFromQuery(new URLSearchParams('f=1&status=bogus&status=completed&mode=fax&prog=omhc&quick=nope'))!;
  assert.deepEqual(f.statuses, ['completed']);
  assert.deepEqual(f.modes, []);
  assert.deepEqual(f.programs, ['omhc']);
  assert.deepEqual(f.quick, []);
  assert.equal(f.hideCancelled, true);
});

test('chips: one per value, removable one at a time', () => {
  const f: ScheduleFilters = { ...defaultFilters('THERAPIST'), statuses: ['confirmed'], providers: ['u1'], labels: [NO_LABEL_KEY] };
  const chips = activeChips(f, { provider: (id) => (id === 'u1' ? 'Dr. One' : undefined) });
  assert.deepEqual(chips.map((c) => c.label), ['My schedule', 'Provider: Dr. One', 'Status: Confirmed', 'Label: No label', 'Hiding cancelled / no-shows']);
  let next = f;
  for (const c of chips) next = removeChip(next, c);
  assert.equal(activeFilterCount(next), 0);
});

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

test('remembered per user, reset clears; storage failures never throw', () => {
  const s = memoryStorage();
  const f = { ...defaultFilters('FRONT_DESK'), types: ['PRP Session'] };
  rememberFilters(s, 'u1', f);
  assert.deepEqual(loadRememberedFilters(s, 'u1')?.types, ['PRP Session']);
  assert.equal(loadRememberedFilters(s, 'u2'), null);
  rememberFilters(s, 'u1', null);
  assert.equal(loadRememberedFilters(s, 'u1'), null);
  const broken: StorageLike = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); }, removeItem: () => { throw new Error('x'); } };
  assert.doesNotThrow(() => rememberFilters(broken, 'u1', f));
  assert.equal(loadRememberedFilters(broken, 'u1'), null);
  assert.deepEqual(loadSavedViews(broken, 'u1'), []);
});

test('saved views: named presets, replace by name, restore filters', () => {
  const s = memoryStorage();
  let views = upsertSavedView([], 'PRP today', { ...emptyFilters(), programs: ['prp'] });
  views = upsertSavedView(views, 'Unsigned', { ...emptyFilters(), quick: ['unsigned'] });
  views = upsertSavedView(views, 'prp TODAY', { ...emptyFilters(), programs: ['prp', 'iop'] });
  assert.deepEqual(views.map((v) => v.name), ['prp TODAY', 'Unsigned']);
  storeSavedViews(s, 'u1', views);
  const loaded = loadSavedViews(s, 'u1');
  assert.deepEqual(savedViewFilters(loaded[0])?.programs, ['iop', 'prp']);
  s.setItem('altrixs.schedule.views.u1', '{bad json');
  assert.deepEqual(loadSavedViews(s, 'u1'), []);
});

test('date navigation: weeks, month grid, prev / next', () => {
  assert.deepEqual(weekDates('2026-10-19'), ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']);
  assert.equal(weekDates('2026-10-25')[0], '2026-10-19');
  const grid = monthGrid('2026-10-19');
  assert.equal(grid[0][0], '2026-09-28');
  assert.equal(grid.every((w) => w.length === 7), true);
  assert.equal(grid.flat().includes('2026-10-31'), true);
  assert.equal(grid.flat().includes('2026-10-01'), true);
  assert.deepEqual(visibleDates('2026-10-19', 'month'), { from: '2026-09-28', to: grid[grid.length - 1][6] });
  assert.equal(shiftDate('2026-01-31', 'month', 1), '2026-02-28');
  assert.equal(shiftDate('2026-03-31', 'month', -1), '2026-02-28');
  assert.equal(shiftDate('2026-12-15', 'month', 1), '2027-01-15');
  assert.equal(shiftDate('2026-11-01', 'week', 1), '2026-11-08');
  assert.equal(shiftDate('2026-11-01', 'day', -1), '2026-10-31');
});

test('scheduler page wires the filters everywhere and the API keeps scoping', () => {
  const page = fs.readFileSync(path.join(__dirname, '../src/app/dashboard/appointments/page.tsx'), 'utf8');
  assert.match(page, /applyScheduleFilters/);
  assert.match(page, /ScheduleFilterBar/);
  assert.match(page, /calMode === 'month'/);
  const route = fs.readFileSync(path.join(__dirname, '../src/app/api/appointments/route.ts'), 'utf8');
  assert.match(route, /listAppointmentsForUser\(/);
  // Facets only enrich listed rows; the viewer (org + role) is passed for the Carelon attestation badge
  assert.match(route, /facets \? await withFilterFacets\(listed(, \{ organizationId: gate\.organizationId, role: gate\.role \})?\) : listed/);
});
