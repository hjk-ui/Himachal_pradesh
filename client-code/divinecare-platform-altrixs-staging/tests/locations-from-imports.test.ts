import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildFacilityResolver,
  facilitySiteTerm,
  suggestFacilityMapping,
  suggestMissingMappings,
  validateMappingRow,
  type FacilityMapRow,
  type LocationLite,
} from '../src/lib/locations/facilityMapping';
import { buildAppointmentLocationResolver, effectiveLocation } from '../src/lib/locations/effectiveLocation';
import {
  collectEvidence,
  decideClientLocation,
  planFingerprint,
  summarizeDecisions,
  type ClientEvidence,
} from '../src/lib/locations/recompute';
import { buildPracticeOverview, lastMonths, noShowRate, type OverviewInput } from '../src/lib/locations/overview';
import {
  distinctBillingEntities,
  locationsWithoutFacility,
  parseFacilityListRecords,
  planFacilityListImport,
  type ExistingFacilityRow,
} from '../src/lib/locations/valantFacilities';

// Synthetic fixtures only (no real patient data).
const LOCS: LocationLite[] = [
  { id: 'loc_bowie', name: 'Bowie', city: 'Bowie', isPrimary: true, active: true },
  { id: 'loc_ss', name: 'Silver Spring', city: 'Silver Spring', isPrimary: false, active: true },
  { id: 'loc_lp', name: 'Lexington Park', city: 'Lexington Park', isPrimary: false, active: true },
  { id: 'loc_balt', name: 'Baltimore', city: 'Baltimore', isPrimary: false, active: true },
];

// ─── Mapping suggestions ─────────────────────────────────────────────────────

test('facility suggestions: Bowie exact, STM -> Lexington Park (confirmed), Family Practice / IOP / PRP programs', () => {
  const bowie = suggestFacilityMapping('Outpatient Mental Health Clinic - Bowie', LOCS);
  assert.equal(bowie.kind, 'location');
  assert.equal(bowie.locationId, 'loc_bowie');
  assert.equal(bowie.needsConfirmation, false);

  const stm = suggestFacilityMapping('Outpatient Mental Health Clinic - STM', LOCS);
  assert.equal(stm.kind, 'location');
  assert.equal(stm.locationId, 'loc_lp');
  assert.equal(stm.needsConfirmation, false, 'STM = Lexington Park confirmed by the owner 2026-10-17');
  assert.equal(stm.basis, 'abbreviation');

  const fp = suggestFacilityMapping('Family Practice', LOCS);
  assert.deepEqual([fp.kind, fp.programKey, fp.locationId], ['program', 'primary_care', null]);
  const iop = suggestFacilityMapping(' IOP ', LOCS);
  assert.deepEqual([iop.kind, iop.programKey], ['program', 'iop']);
  const prp = suggestFacilityMapping('PRP', LOCS);
  assert.deepEqual([prp.kind, prp.programKey, prp.locationId], ['program', 'prp', null]);

  const unknown = suggestFacilityMapping('Outpatient Mental Health Clinic - Annapolis', LOCS);
  assert.equal(unknown.locationId, null);
  assert.equal(unknown.basis, 'none');
  assert.equal(facilitySiteTerm('A - B - Bowie'), 'Bowie');
});

test('suggestions skip saved facilities and duplicates; inactive locations are not suggested', () => {
  const saved = [{ facilityName: 'family practice' }];
  const out = suggestMissingMappings(['Family Practice', 'IOP', 'iop', 'Outpatient Mental Health Clinic - Bowie'], saved, LOCS);
  assert.deepEqual(out.map((s) => s.facilityName), ['IOP', 'Outpatient Mental Health Clinic - Bowie']);
  const inactive = LOCS.map((l) => (l.id === 'loc_lp' ? { ...l, active: false } : l));
  assert.equal(suggestFacilityMapping('Outpatient Mental Health Clinic - STM', inactive).locationId, null);
});

test('resolver uses saved rows only; validation requires a location or program', () => {
  const rows: FacilityMapRow[] = [
    { facilityName: 'Outpatient Mental Health Clinic - STM', kind: 'location', locationId: 'loc_lp', programKey: null, needsConfirmation: true, note: null },
    { facilityName: 'Family Practice', kind: 'program', locationId: null, programKey: 'primary_care', needsConfirmation: false, note: null },
  ];
  const r = buildFacilityResolver(rows);
  assert.deepEqual(r('outpatient mental health clinic -  stm'), { kind: 'location', locationId: 'loc_lp', confirmed: false });
  assert.equal(r('Family Practice').kind, 'program');
  assert.equal(r('Outpatient Mental Health Clinic - Bowie').kind, 'unmapped');
  const ids = new Set(LOCS.map((l) => l.id));
  assert.match(validateMappingRow({ kind: 'location', locationId: null, programKey: null }, ids) ?? '', /Choose/);
  assert.match(validateMappingRow({ kind: 'location', locationId: 'other_org_loc', programKey: null }, ids) ?? '', /not found/);
  assert.equal(validateMappingRow({ kind: 'program', locationId: null, programKey: 'iop' }, ids), null);
  assert.equal(validateMappingRow({ kind: 'ignore', locationId: null, programKey: null }, ids), null);
});

// ─── Effective location ──────────────────────────────────────────────────────

test('effective location: appointment location, legacy practice_locations ids, else inferred from client', () => {
  const resolve = buildAppointmentLocationResolver(LOCS);
  assert.deepEqual(effectiveLocation({ appointmentLocation: 'loc_ss', clientLocationId: 'loc_bowie' }, resolve), {
    locationId: 'loc_ss', source: 'appointment', inferred: false,
  });
  assert.equal(effectiveLocation({ appointmentLocation: 'lex', clientLocationId: 'loc_bowie' }, resolve).locationId, 'loc_lp');
  assert.deepEqual(effectiveLocation({ appointmentLocation: null, clientLocationId: 'loc_bowie' }, resolve), {
    locationId: 'loc_bowie', source: 'client_home', inferred: true,
  });
  // Unknown raw values are ignored, not trusted
  assert.equal(effectiveLocation({ appointmentLocation: 'nowhere', clientLocationId: 'loc_ss' }, resolve).source, 'client_home');
  assert.deepEqual(effectiveLocation({ appointmentLocation: '', clientLocationId: null }, resolve), { locationId: null, source: 'none', inferred: true });
});

// ─── Recompute rules ─────────────────────────────────────────────────────────

function ev(over: Partial<ClientEvidence>): ClientEvidence {
  return {
    clientId: 'c1',
    currentLocationId: 'loc_bowie',
    sourcePlatform: 'valant',
    journal: [],
    journalUnconfirmedLocationIds: [],
    journalProgramRows: 0,
    journalUnmappedRows: 0,
    clinician: [],
    clinicianMultiSiteWeight: 0,
    ...over,
  };
}
const DEF = 'loc_bowie';

test('recompute: default-location client moves on one strong source', () => {
  const d = decideClientLocation(ev({ journal: [{ locationId: 'loc_ss', count: 5 }] }), DEF);
  assert.equal(d.action, 'move');
  assert.equal(d.toLocationId, 'loc_ss');
  assert.equal(d.evidence, 'journal');
  const n = decideClientLocation(ev({ currentLocationId: null, clinician: [{ locationId: 'loc_balt', count: 3 }] }), DEF);
  assert.equal(n.action, 'move');
  assert.equal(n.toLocationId, 'loc_balt');
});

test('recompute: weak evidence never moves anyone', () => {
  assert.equal(decideClientLocation(ev({ journal: [{ locationId: 'loc_ss', count: 1 }] }), DEF).reason, 'weak');
  assert.equal(
    decideClientLocation(ev({ journal: [{ locationId: 'loc_ss', count: 3 }, { locationId: 'loc_balt', count: 2 }] }), DEF).reason,
    'weak',
    '60% share is below the threshold'
  );
  assert.equal(
    decideClientLocation(ev({ journal: [{ locationId: 'loc_lp', count: 9 }], journalUnconfirmedLocationIds: ['loc_lp'] }), DEF).reason,
    'weak',
    'unconfirmed mapping (STM) is weak'
  );
  assert.equal(decideClientLocation(ev({ clinician: [{ locationId: 'loc_ss', count: 1 }] }), DEF).reason, 'weak');
  assert.equal(decideClientLocation(ev({}), DEF).reason, 'no_evidence');
});

test('recompute: a non-default location is never overwritten on weak or default-pointing evidence', () => {
  // Strong evidence for the default (Bowie billing facility + Bowie-only clinicians) keeps a Silver Spring client
  const both = decideClientLocation(
    ev({ currentLocationId: 'loc_ss', journal: [{ locationId: 'loc_bowie', count: 20 }], clinician: [{ locationId: 'loc_bowie', count: 10 }] }),
    DEF
  );
  assert.equal(both.action, 'keep');
  assert.equal(both.reason, 'protected');
  // One strong source for another non-default location is not enough
  const one = decideClientLocation(ev({ currentLocationId: 'loc_lp', journal: [{ locationId: 'loc_ss', count: 6 }] }), DEF);
  assert.equal(one.reason, 'protected');
  // Weak evidence elsewhere
  assert.equal(decideClientLocation(ev({ currentLocationId: 'loc_lp', journal: [{ locationId: 'loc_ss', count: 1 }] }), DEF).action, 'keep');
  // Two agreeing strong sources for another non-default location do move it
  const agree = decideClientLocation(
    ev({ currentLocationId: 'loc_lp', journal: [{ locationId: 'loc_ss', count: 4 }], clinician: [{ locationId: 'loc_ss', count: 3 }] }),
    DEF
  );
  assert.equal(agree.action, 'move');
  assert.equal(agree.evidence, 'clinician+journal');
});

test('recompute: conflicts and agreement with current location keep the client', () => {
  assert.equal(
    decideClientLocation(ev({ journal: [{ locationId: 'loc_ss', count: 4 }], clinician: [{ locationId: 'loc_balt', count: 4 }] }), DEF).reason,
    'conflict'
  );
  assert.equal(decideClientLocation(ev({ journal: [{ locationId: 'loc_bowie', count: 4 }] }), DEF).reason, 'unchanged');
});

test('collectEvidence: program/unmapped facilities and multi-site clinicians do not vote', () => {
  const evidence = collectEvidence({
    clients: [{ id: 'c1', locationId: 'loc_bowie', sourcePlatform: 'valant' }],
    journalGroups: [
      { clientId: 'c1', facility: 'Family Practice', rows: 9 },
      { clientId: 'c1', facility: 'Somewhere', rows: 2 },
      { clientId: 'c1', facility: 'STM', rows: 3 },
      { clientId: 'other_org_client', facility: 'STM', rows: 50 },
    ],
    resolveFacility: (f) =>
      f === 'Family Practice' ? { kind: 'program' } : f === 'STM' ? { kind: 'location', locationId: 'loc_lp', confirmed: false } : { kind: 'unmapped' },
    appointmentGroups: [
      { clientId: 'c1', clinicianId: 'u_multi', count: 7 },
      { clientId: 'c1', clinicianId: 'u_ss', count: 2 },
      { clientId: 'c1', clinicianId: null, count: 4 },
    ],
    staffLocations: new Map([
      ['u_multi', ['loc_bowie', 'loc_ss']],
      ['u_ss', ['loc_ss']],
    ]),
  });
  assert.equal(evidence.length, 1);
  const e = evidence[0];
  assert.deepEqual(e.journal, [{ locationId: 'loc_lp', count: 3 }]);
  assert.deepEqual(e.journalUnconfirmedLocationIds, ['loc_lp']);
  assert.equal(e.journalProgramRows, 9);
  assert.equal(e.journalUnmappedRows, 2);
  assert.deepEqual(e.clinician, [{ locationId: 'loc_ss', count: 2 }]);
  assert.equal(e.clinicianMultiSiteWeight, 7);
  const d = decideClientLocation(e, DEF);
  assert.equal(d.action, 'move', 'clinician evidence (2 visits, 100%) is strong; unconfirmed STM journal rows are weak');
  assert.equal(d.toLocationId, 'loc_ss');
});

test('summary and fingerprint are stable and only count moves', () => {
  const ds = [
    decideClientLocation(ev({ clientId: 'a', journal: [{ locationId: 'loc_ss', count: 5 }] }), DEF),
    decideClientLocation(ev({ clientId: 'b', journal: [{ locationId: 'loc_ss', count: 5 }] }), DEF),
    decideClientLocation(ev({ clientId: 'c' }), DEF),
  ];
  const s = summarizeDecisions(ds);
  assert.equal(s.byReason.move, 2);
  assert.equal(s.byReason.no_evidence, 1);
  assert.deepEqual(s.moves, [{ fromLocationId: 'loc_bowie', toLocationId: 'loc_ss', count: 2 }]);
  assert.equal(planFingerprint(ds), planFingerprint([...ds].reverse()));
  assert.notEqual(planFingerprint(ds), planFingerprint(ds.slice(0, 1)));
  assert.match(planFingerprint([]), /^0-/);
});

// ─── Overview aggregation ────────────────────────────────────────────────────

const NOW = new Date('2026-10-17T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

function input(over: Partial<OverviewInput> = {}): OverviewInput {
  return {
    now: NOW,
    organizationName: 'Test Practice',
    locations: LOCS.map((l) => ({
      id: l.id, name: l.name, code: null, addressLine1: null, addressLine2: null, city: l.city, state: 'MD',
      postalCode: null, phone: null, timezone: 'America/New_York', active: l.active, isPrimary: l.isPrimary,
    })),
    clientGroups: [
      { locationId: 'loc_bowie', status: 'ACTIVE', sourcePlatform: 'valant', count: 30 },
      { locationId: 'loc_bowie', status: 'INACTIVE', sourcePlatform: 'valant', count: 70 },
      { locationId: 'loc_ss', status: 'ACTIVE', sourcePlatform: 'valant', count: 9 },
      { locationId: 'loc_ss', status: 'ACTIVE', sourcePlatform: null, count: 1 },
      { locationId: null, status: 'ACTIVE', sourcePlatform: null, count: 2 },
    ],
    newClientGroups: [
      { locationId: 'loc_ss', days: 30, count: 1 },
      { locationId: 'loc_ss', days: 90, count: 1 },
    ],
    primaryCareFlagGroups: [{ locationId: 'loc_ss', count: 1 }],
    appointments: [
      { clientLocationId: 'loc_bowie', appointmentLocation: null, status: 'COMPLETED', startsAt: daysAgo(5) },
      { clientLocationId: 'loc_bowie', appointmentLocation: null, status: 'COMPLETED', startsAt: daysAgo(40) },
      { clientLocationId: 'loc_bowie', appointmentLocation: null, status: 'NO_SHOW', startsAt: daysAgo(6) },
      { clientLocationId: 'loc_bowie', appointmentLocation: 'loc_ss', status: 'COMPLETED', startsAt: daysAgo(7) },
      { clientLocationId: 'loc_bowie', appointmentLocation: null, status: 'COMPLETED', startsAt: daysAgo(120) },
      { clientLocationId: 'loc_ss', appointmentLocation: null, status: 'SCHEDULED', startsAt: new Date(NOW.getTime() + 3 * 86_400_000) },
    ],
    appointmentLocationColumn: true,
    valantGroups: [
      { facility: 'Outpatient Mental Health Clinic - Bowie', category: 'charge', month: '2026-10', in90: true, cents: 100_000, count: 4 },
      { facility: 'Outpatient Mental Health Clinic - Bowie', category: 'insurance_payment', month: '2026-10', in90: true, cents: -60_000, count: 3 },
      { facility: 'Outpatient Mental Health Clinic - Bowie', category: 'charge', month: '2026-06', in90: false, cents: 50_000, count: 2 },
      { facility: 'Family Practice', category: 'charge', month: '2026-09', in90: true, cents: 20_000, count: 2 },
      { facility: 'Outpatient Mental Health Clinic - STM', category: 'charge', month: '2026-09', in90: true, cents: 7_000, count: 1 },
      { facility: null, category: 'charge', month: '2026-09', in90: true, cents: 999_999, count: 11 },
    ],
    facilityHomeGroups: [
      { facility: 'Family Practice', homeLocationId: 'loc_ss', clients: 5, rows: 10 },
      { facility: 'Family Practice', homeLocationId: 'loc_bowie', clients: 1, rows: 1 },
    ],
    journalRowCount: 22,
    mappings: [
      { facilityName: 'Outpatient Mental Health Clinic - Bowie', kind: 'location', locationId: 'loc_bowie', programKey: null, needsConfirmation: false, note: null },
      { facilityName: 'Family Practice', kind: 'program', locationId: null, programKey: 'primary_care', needsConfirmation: false, note: null },
    ],
    staffLinks: [
      { userId: 'u1', locationId: 'loc_bowie' },
      { userId: 'u2', locationId: 'loc_bowie' },
      { userId: 'u2', locationId: 'loc_ss' },
      { userId: 'u3', locationId: 'loc_bowie' },
    ],
    staff: [
      { id: 'u1', name: 'Staff One', role: 'THERAPIST', status: 'ACTIVE' },
      { id: 'u2', name: 'Staff Two', role: 'NP', status: 'ACTIVE' },
      { id: 'u3', name: 'Staff Three', role: 'THERAPIST', status: 'DEACTIVATED' },
    ],
    ...over,
  };
}

test('overview: clients, effective-location appointments, no-show rate', () => {
  const o = buildPracticeOverview(input());
  const bowie = o.locations.find((l) => l.id === 'loc_bowie')!;
  const ss = o.locations.find((l) => l.id === 'loc_ss')!;
  assert.deepEqual([bowie.clients.total, bowie.clients.active, bowie.clients.valantImported], [100, 30, 100]);
  assert.deepEqual([ss.clients.total, ss.clients.active, ss.clients.newIn30, ss.clients.primaryCareFlag], [10, 10, 1, 1]);
  assert.equal(o.unassigned.clients, 2);
  // Bowie: 2 completed + 1 no-show in 90 days (120-day-old one excluded; the loc_ss appointment counts at SS)
  assert.equal(bowie.appointments.last90.completed, 2);
  assert.equal(bowie.appointments.last90.noShow, 1);
  assert.equal(bowie.appointments.last90.inferred, 3);
  assert.equal(bowie.appointments.last90.noShowRate, 1 / 3);
  assert.equal(ss.appointments.last90.completed, 1);
  assert.equal(ss.appointments.last90.inferred, 0);
  assert.equal(ss.appointments.upcoming30, 1);
  assert.equal(o.totals.completed90, 3);
  assert.equal(noShowRate({ completed: 0, noShow: 0, lateCancel: 0 }), null);
});

test('overview: Valant money by mapped facility only; programs and unmapped kept apart', () => {
  const o = buildPracticeOverview(input());
  const bowie = o.locations.find((l) => l.id === 'loc_bowie')!;
  assert.equal(bowie.valant.last90.chargesCents, 100_000);
  assert.equal(bowie.valant.last90.paymentsCents, 60_000);
  assert.deepEqual(bowie.valant.facilities, ['Outpatient Mental Health Clinic - Bowie']);
  const lp = o.locations.find((l) => l.id === 'loc_lp')!;
  assert.equal(lp.valant.last90.chargesCents, 0, 'STM is not mapped yet: not counted at Lexington Park');
  assert.equal(o.totals.charges90Cents, 100_000);
  assert.equal(o.noFacilityRows90, 11);
  const pc = o.programs.find((p) => p.programKey === 'primary_care')!;
  assert.equal(pc.clients, 6);
  assert.deepEqual(pc.byHomeLocation[0], { locationId: 'loc_ss', clients: 5 });
  assert.equal(pc.last90.chargesCents, 20_000);
  assert.equal(pc.intakeFlagged, 1);
  // monthly: June and October in the 6-month window
  assert.deepEqual(lastMonths(NOW, 6), ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
  const june = o.months.find((m) => m.month === '2026-06')!;
  assert.equal(june.byLocation.loc_bowie.chargesCents, 50_000);
  const oct = o.months.find((m) => m.month === '2026-10')!;
  assert.equal(oct.byLocation.loc_bowie.completed, 1);
});

test('overview: staff counts, shared staff, warnings', () => {
  const o = buildPracticeOverview(input());
  const bowie = o.locations.find((l) => l.id === 'loc_bowie')!;
  assert.equal(bowie.staff.count, 2, 'deactivated staff excluded');
  assert.equal(bowie.staff.shared, 1);
  assert.deepEqual(o.sharedStaff.map((s) => s.name), ['Staff Two']);
  const codes = o.warnings.map((w) => w.code);
  assert.ok(codes.includes('valant_default_location'));
  assert.ok(codes.includes('location_no_clients'), 'Baltimore and Lexington Park have no clients');
  assert.ok(codes.includes('clients_no_location'));
  assert.ok(codes.includes('appointments_inferred'));
  assert.ok(codes.includes('facilities_unmapped'), 'STM row has no saved mapping');
  assert.ok(!codes.includes('journal_not_imported'));
  assert.ok(!codes.includes('staff_one_location'));

  const bare = buildPracticeOverview(
    input({ journalRowCount: 0, valantGroups: [], staffLinks: [{ userId: 'u1', locationId: 'loc_bowie' }], appointmentLocationColumn: false })
  );
  const bareCodes = bare.warnings.map((w) => w.code);
  assert.ok(bareCodes.includes('journal_not_imported'));
  assert.ok(bareCodes.includes('staff_one_location'));
  assert.ok(bareCodes.includes('appointment_location_missing'));
});

test('enterprise page has no hard-coded locations or placeholder trends', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'dashboard', 'enterprise', 'page.tsx'), 'utf8');
  assert.ok(!/INITIAL_ENTITIES|REVENUE_TREND|SESSION_TREND|SHARED_STAFF/.test(src));
  assert.ok(src.includes('/api/locations/overview'));
});

// ─── Valant facility list import ─────────────────────────────────────────────

const FACILITY_FILE: string[][] = [
  ['Facility Id', 'Name', 'Local Time Zone', 'Active'],
  ['Family Practice', 'MD Behavioral Health', 'America/New_York', 'Active'],
  ['Outpatient Mental Health Clinic - Bowie', 'MD Behavioral Health', 'America/New_York', 'Active'],
  ['IOP', 'MD Behavioral Health', 'America/New_York', 'Active'],
  ['PRP', 'MD Behavioral Health - PRP', 'America/New_York', 'Active'],
  ['Outpatient Mental Health Clinic - STM', 'MD Behavioral Health - STM', 'America/New_York', 'Active'],
];

test('facility list parser: header, attributes, duplicates, bad values', () => {
  assert.equal(parseFacilityListRecords([['Name', 'Display Name', 'Availability'], ['Blue', 'Blue', 'Free']]).headerOk, false);
  const withBom = [[String.fromCharCode(0xfeff) + 'Facility Id', 'Name', 'Local Time Zone', 'Active'], ...FACILITY_FILE.slice(1)];
  const p = parseFacilityListRecords(withBom);
  assert.equal(p.headerOk, true);
  assert.equal(p.rows.length, 5);
  assert.deepEqual(p.rows[3], { line: 5, facilityName: 'PRP', billingEntityName: 'MD Behavioral Health - PRP', timezone: 'America/New_York', active: true });
  const messy = parseFacilityListRecords([
    FACILITY_FILE[0],
    ['IOP', 'MD Behavioral Health', 'Eastern', 'Inactive'],
    ['iop ', 'Other', 'America/New_York', 'Active'],
    ['', 'MD Behavioral Health', '', ''],
    ['', '', '', ''],
    ['X', '', '', 'maybe'],
  ]);
  assert.equal(messy.rows.length, 2);
  assert.deepEqual([messy.rows[0].timezone, messy.rows[0].active], [null, false]);
  assert.deepEqual(messy.duplicates, [{ facilityName: 'IOP', lines: [2, 3] }]);
  assert.deepEqual(messy.errors.map((e) => e.line), [2, 4, 6]);
});

function asExisting(plan: ReturnType<typeof planFacilityListImport>, origin = 'facility_import'): ExistingFacilityRow[] {
  return plan.map((p, i) => ({
    id: `f${i}`,
    facilityName: p.data.facilityName,
    kind: p.data.kind,
    locationId: p.data.locationId,
    programKey: p.data.programKey,
    needsConfirmation: p.data.needsConfirmation,
    note: p.data.note,
    origin,
    billingEntityName: p.data.billingEntityName,
    timezone: p.data.timezone,
    sourceActive: p.data.sourceActive,
  }));
}

test('facility list import: suggested mapping on create, then idempotent', () => {
  const rows = parseFacilityListRecords(FACILITY_FILE).rows;
  const first = planFacilityListImport([], rows, LOCS);
  assert.ok(first.every((p) => p.action === 'create' && p.mapping === 'suggested'));
  const by = new Map(first.map((p) => [p.facilityName, p.data]));
  const bowie = by.get('Outpatient Mental Health Clinic - Bowie')!;
  assert.deepEqual([bowie.kind, bowie.locationId], ['location', 'loc_bowie']);
  const stm = by.get('Outpatient Mental Health Clinic - STM')!;
  assert.deepEqual([stm.locationId, stm.needsConfirmation], ['loc_lp', false]);
  assert.equal(by.get('Family Practice')!.programKey, 'primary_care');
  assert.equal(by.get('IOP')!.programKey, 'iop');
  assert.equal(by.get('PRP')!.programKey, 'prp');
  assert.equal(by.get('PRP')!.billingEntityName, 'MD Behavioral Health - PRP');

  const second = planFacilityListImport(asExisting(first), rows, LOCS);
  assert.ok(second.every((p) => p.action === 'unchanged'), 'same file again changes nothing');
});

test('facility list import: owner mapping kept, attributes updated, unknown facility not counted', () => {
  const rows = parseFacilityListRecords(FACILITY_FILE).rows;
  const existing: ExistingFacilityRow[] = [
    {
      id: 'f1', facilityName: 'IOP', kind: 'location', locationId: 'loc_balt', programKey: null, needsConfirmation: false, note: 'owner edit',
      origin: 'owner', billingEntityName: null, timezone: null, sourceActive: null,
    },
    {
      id: 'f2', facilityName: 'Outpatient Mental Health Clinic - STM', kind: 'location', locationId: 'loc_lp', programKey: null, needsConfirmation: true, note: 'old',
      origin: 'suggested', billingEntityName: null, timezone: null, sourceActive: null,
    },
  ];
  const plan = planFacilityListImport(existing, rows, LOCS);
  const iop = plan.find((p) => p.facilityName === 'IOP')!;
  assert.equal(iop.mapping, 'kept_owner');
  assert.deepEqual([iop.data.kind, iop.data.locationId], ['location', 'loc_balt']);
  assert.deepEqual([...iop.changed].sort(), ['billingEntityName', 'sourceActive', 'timezone']);
  const stm = plan.find((p) => p.facilityName.endsWith('STM'))!;
  assert.equal(stm.action, 'update');
  assert.equal(stm.data.needsConfirmation, false, 'suggested row picks up the confirmed mapping');

  const unknownRows = parseFacilityListRecords([FACILITY_FILE[0], ['Annapolis Annex', 'MD Behavioral Health', 'America/New_York', 'Active']]).rows;
  const unknown = planFacilityListImport([], unknownRows, LOCS);
  assert.deepEqual([unknown[0].mapping, unknown[0].data.kind, unknown[0].data.needsConfirmation], ['unmatched', 'ignore', true]);
});

test('facility notes: locations without a facility, separate billing entities', () => {
  const plan = planFacilityListImport([], parseFacilityListRecords(FACILITY_FILE).rows, LOCS);
  const mappings = plan.map((p) => p.data);
  assert.deepEqual(locationsWithoutFacility(LOCS, mappings).map((l) => l.name), ['Silver Spring', 'Baltimore']);
  const be = distinctBillingEntities(mappings);
  assert.equal(be.mainEntity, 'MD Behavioral Health');
  assert.deepEqual(be.others.map((o) => o.facilityName), ['PRP', 'Outpatient Mental Health Clinic - STM']);
});

test('overview: PRP program from mapping and PrpEnrollment', () => {
  const o = buildPracticeOverview(
    input({
      mappings: [{ facilityName: 'PRP', kind: 'program', locationId: null, programKey: 'prp', needsConfirmation: false, note: null }],
      prpEnrollmentGroups: [
        { status: 'active', homeLocationId: 'loc_bowie', count: 3 },
        { status: 'discharged', homeLocationId: 'loc_bowie', count: 1 },
        { status: 'active', homeLocationId: null, count: 1 },
      ],
    })
  );
  const prp = o.programs.find((p) => p.programKey === 'prp')!;
  assert.deepEqual(prp.facilities, ['PRP']);
  assert.equal(prp.enrollments!.total, 5);
  assert.deepEqual(prp.enrollments!.byStatus, { active: 4, discharged: 1 });
  assert.deepEqual(prp.enrollments!.byHomeLocation[0], { locationId: 'loc_bowie', clients: 4 });
  assert.equal(buildPracticeOverview(input()).programs.some((p) => p.programKey === 'prp'), false);
});

test('program facility money (Family Practice) lands at the client home location, labelled inferred', () => {
  const o = buildPracticeOverview(
    input({
      valantGroups: [
        { facility: 'Family Practice', category: 'charge', month: '2026-09', in90: true, cents: 20_000, count: 2, homeLocationId: 'loc_ss' },
        { facility: 'Family Practice', category: 'charge', month: '2026-09', in90: true, cents: 5_000, count: 1, homeLocationId: null },
      ],
    })
  );
  const ss = o.locations.find((l) => l.id === 'loc_ss')!;
  assert.equal(ss.valant.last90.chargesCents, 20_000);
  assert.ok(ss.valant.facilities.includes('Family Practice (by client home location)'));
  // no home location: stays out of every location (unassigned), still counted under the program
  assert.equal(o.programs.find((p) => p.programKey === 'primary_care')!.last90.chargesCents, 25_000);
  assert.equal(o.programChargesInferred90Cents, 20_000);
  assert.ok(o.warnings.some((w) => w.code === 'program_charges_inferred'));
});
