import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildFacilityOverview,
  EXPECTED_VALANT_FACILITIES,
  NOT_RECORDED_LABEL,
  resolveClientFacility,
  type FacilityOverviewInput,
  type FacilitySiteRow,
} from '../src/lib/locations/facilityOverview';
import { buildPracticeCensus, type CensusInput } from '../src/lib/locations/census';
import { practiceDayBounds } from '../src/lib/dashboard/practiceDay';
import { planClientFacilityUpdates } from '../src/lib/migration/clientFacility';
import { resolveClientFields } from '../src/lib/migration/fieldMaps';
import { validateClient } from '../src/lib/migration/validate';

const ROOT = path.join(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const TZ = 'America/New_York';
const NOW = new Date('2026-10-18T16:00:00Z');
const IMPORTED = new Date('2026-10-18T12:00:00Z');

const site = (facilityName: string, billingEntityName: string, p: Partial<FacilitySiteRow> = {}): FacilitySiteRow => ({
  facilityName, billingEntityName, timezone: 'America/New_York', sourceActive: true, kind: 'location', locationId: 'bow', programKey: null,
  needsConfirmation: false, facilityImportedAt: IMPORTED, ...p,
});
const SITES: FacilitySiteRow[] = [
  site('Family Practice', 'MD Behavioral Health', { kind: 'program', programKey: 'primary_care', locationId: null }),
  site('Outpatient Mental Health Clinic - Bowie', 'MD Behavioral Health'),
  site('IOP', 'MD Behavioral Health', { kind: 'program', programKey: 'iop', locationId: null }),
  site('PRP', 'MD Behavioral Health - PRP', { kind: 'program', programKey: 'prp', locationId: null }),
  site('Outpatient Mental Health Clinic - STM', 'MD Behavioral Health - STM', { locationId: 'lp' }),
];

function input(p: Partial<FacilityOverviewInput> = {}): FacilityOverviewInput {
  return {
    now: NOW, timeZone: TZ, facilityRows: SITES, locations: [{ id: 'bow', name: 'Bowie' }, { id: 'lp', name: 'Lexington Park' }],
    clientFacilityColumn: true, clientFacilityGroups: [], valantGroups: [], visitGroups: [], payerGroups: [], firstChargeGroups: [],
    journalFirstServiceDate: null, appointments: [],
    programs: { prpEnrollments: [], prpAttendance90: { encounters: 0, clients: 0 }, primaryCareActive: 0, medicalVisits90: 0 },
    ...p,
  };
}

test('sites come from the facility import; five rows when imported', () => {
  const fv = buildFacilityOverview(input());
  assert.equal(fv.source, 'facility_import');
  assert.equal(fv.sites.length, 5);
  assert.equal(fv.expected.length, 0);
  const prp = fv.sites.find((s) => s.facilityName === 'PRP')!;
  assert.equal(prp.separateBillingEntity, true);
  assert.equal(fv.sites.find((s) => s.facilityName === 'IOP')!.separateBillingEntity, false);
  assert.equal(fv.mainBillingEntity, 'MD Behavioral Health');
});

test('without the facility import: the 5 are expected only, no fabricated rows or figures', () => {
  // a saved mapping that the facility import did not touch is not a site
  const fv = buildFacilityOverview(input({
    facilityRows: [site('Outpatient Mental Health Clinic - Bowie', 'MD Behavioral Health', { facilityImportedAt: null })],
    valantGroups: [{ facility: 'Outpatient Mental Health Clinic - Bowie', category: 'charge', month: '2026-10', in90: true, cents: 50_000, count: 2 }],
    clientFacilityGroups: [{ valantFacility: 'MD Behavioral Health - PRP', status: 'ACTIVE', count: 4 }],
  }));
  assert.equal(fv.source, 'expected');
  assert.equal(fv.sites.length, 0);
  assert.deepEqual(fv.expected.map((e) => e.facilityName), EXPECTED_VALANT_FACILITIES.map((e) => e.facilityName));
  assert.equal(fv.totals.charges90Cents, 0);
  // the money is still shown, as journal rows not in the (missing) list, and in the practice total
  assert.equal(fv.practice.valant90.chargesCents, 50_000);
  assert.equal(fv.extras.find((x) => x.key === 'not_in_list')!.money90.chargesCents, 50_000);
  assert.equal(fv.clientAssignment.unmatched[0].clients, 4);
  assert.ok(fv.notes.some((n) => /not been imported/.test(n)));
});

test('client facility: facility name, billing entity with one facility; ambiguous entity counted nowhere', () => {
  assert.equal(resolveClientFacility('Outpatient Mental Health Clinic - STM', SITES).basis, 'facility');
  const prp = resolveClientFacility('MD Behavioral Health - PRP', SITES);
  assert.deepEqual([prp.facilityName, prp.basis], ['PRP', 'billing_entity']);
  const amb = resolveClientFacility('MD Behavioral Health', SITES);
  assert.equal(amb.facilityName, null);
  assert.equal(amb.basis, 'ambiguous');
  assert.equal(amb.candidates.length, 3);
  assert.equal(resolveClientFacility('Bowie', SITES).basis, 'unmatched'); // never from the city
  assert.equal(resolveClientFacility('  ', SITES).basis, 'missing');

  const fv = buildFacilityOverview(input({
    clientFacilityGroups: [
      { valantFacility: 'MD Behavioral Health - PRP', status: 'ACTIVE', count: 10 },
      { valantFacility: 'MD Behavioral Health - PRP', status: 'INACTIVE', count: 2 },
      { valantFacility: 'MD Behavioral Health', status: 'ACTIVE', count: 100 },
      { valantFacility: null, status: 'ACTIVE', count: 7 },
    ],
  }));
  const prpSite = fv.sites.find((s) => s.facilityName === 'PRP')!;
  assert.deepEqual(prpSite.clients, { assigned: 12, active: 10, viaBillingEntity: 12 });
  assert.equal(fv.totals.assignedClients, 12);
  assert.equal(fv.clientAssignment.ambiguous[0].clients, 100);
  assert.equal(fv.clientAssignment.withoutFacility, 7);
});

test('transactions match the facility name exactly; untagged money goes to "Facility not recorded" and rows sum to the total', () => {
  const fv = buildFacilityOverview(input({
    valantGroups: [
      { facility: 'Outpatient Mental Health Clinic - Bowie', category: 'charge', month: '2026-10', in90: true, cents: 100_000, count: 4 },
      { facility: 'outpatient mental health clinic -  bowie', category: 'insurance_payment', month: '2026-10', in90: true, cents: -60_000, count: 2 },
      // prefix / contains is not a match
      { facility: 'Outpatient Mental Health Clinic - Bowie Annex', category: 'charge', month: '2026-10', in90: true, cents: 7_000, count: 1 },
      { facility: 'Bowie', category: 'charge', month: '2026-10', in90: true, cents: 3_000, count: 1 },
      { facility: null, category: 'charge', month: '2026-09', in90: true, cents: 40_000, count: 3 },
      { facility: null, category: 'patient_payment', month: '2026-09', in90: true, cents: -5_000, count: 1 },
    ],
  }));
  const bowie = fv.sites.find((s) => s.facilityName === 'Outpatient Mental Health Clinic - Bowie')!;
  assert.equal(bowie.money90.chargesCents, 100_000);
  assert.equal(bowie.money90.insurancePaymentsCents, 60_000);
  const nr = fv.extras.find((x) => x.key === 'not_recorded')!;
  assert.equal(nr.label, NOT_RECORDED_LABEL);
  assert.equal(nr.money90.chargesCents, 40_000);
  assert.equal(fv.extras.find((x) => x.key === 'not_in_list')!.money90.chargesCents, 10_000);
  const rowsSum = fv.sites.reduce((n, s) => n + s.money90.chargesCents, 0) + fv.extras.reduce((n, x) => n + x.money90.chargesCents, 0);
  assert.equal(rowsSum, fv.practice.valant90.chargesCents);
  assert.equal(fv.practice.valant90.chargesCents, 150_000);
  assert.deepEqual(fv.practice.notRecorded, { rows: 4, chargesCents: 40_000, paymentsCents: 5_000 });
});

test('staging shape: all rows untagged, no list -> practice totals carry the money, never $0', () => {
  const fv = buildFacilityOverview(input({
    facilityRows: [],
    valantGroups: [
      { facility: null, category: 'charge', month: '2026-09', in90: true, cents: 106_663_900, count: 9000 },
      { facility: null, category: 'insurance_payment', month: '2026-09', in90: true, cents: -73_633_900, count: 5000 },
    ],
  }));
  assert.equal(fv.practice.valant90.chargesCents, 106_663_900);
  assert.equal(fv.practice.valant90.netCollectionsCents, 73_633_900);
  assert.equal(fv.extras[0].key, 'not_recorded');
  assert.equal(fv.journalImported, false);
});

test('appointments: facility inferred from the client facility; ambiguous clients are not placed', () => {
  const d = (iso: string) => new Date(iso);
  const fv = buildFacilityOverview(input({
    appointments: [
      { clientValantFacility: 'Outpatient Mental Health Clinic - STM', status: 'COMPLETED', startsAt: d('2026-10-10T14:00:00Z') },
      { clientValantFacility: 'Outpatient Mental Health Clinic - STM', status: 'NO_SHOW', startsAt: d('2026-10-11T14:00:00Z') },
      { clientValantFacility: 'MD Behavioral Health', status: 'COMPLETED', startsAt: d('2026-10-12T14:00:00Z') },
      { clientValantFacility: 'Outpatient Mental Health Clinic - STM', status: 'SCHEDULED', startsAt: d('2026-10-25T14:00:00Z') },
    ],
  }));
  const stm = fv.sites.find((s) => s.facilityName === 'Outpatient Mental Health Clinic - STM')!;
  assert.equal(stm.appointments.last90.total, 2);
  assert.equal(stm.appointments.last90.inferred, 2);
  assert.equal(stm.appointments.last90.noShowRate, 0.5);
  assert.equal(stm.appointments.upcoming30, 1);
  assert.deepEqual(fv.appointmentsInferred, { total90: 3, noFacility90: 1 });
  assert.ok(fv.notes.some((n) => /inferred/.test(n)));
});

test('programs per facility: PRP enrollments / attendance, primary care, IOP has no Altrixs data', () => {
  const fv = buildFacilityOverview(input({
    programs: { prpEnrollments: [{ status: 'active', count: 30 }, { status: 'discharged', count: 5 }], prpAttendance90: { encounters: 400, clients: 28 }, primaryCareActive: 55, medicalVisits90: 120 },
  }));
  const prp = fv.sites.find((s) => s.facilityName === 'PRP')!.program!;
  assert.ok('enrollments' in prp && prp.enrollments.total === 35 && prp.attendance90.encounters === 400);
  const pc = fv.sites.find((s) => s.facilityName === 'Family Practice')!.program!;
  assert.ok('activePatients' in pc && pc.activePatients === 55 && pc.visits90 === 120);
  const iop = fv.sites.find((s) => s.facilityName === 'IOP')!.program!;
  assert.ok('note' in iop);
  assert.equal(fv.sites.find((s) => s.facilityName === 'Outpatient Mental Health Clinic - Bowie')!.program, null);
});

test('new clients need journal history before the window (null, not 0)', () => {
  const g = [{ facility: 'PRP', first30: 3, first90: 9 }];
  const short = buildFacilityOverview(input({ firstChargeGroups: g, journalFirstServiceDate: '2026-09-01' }));
  assert.deepEqual(short.sites.find((s) => s.facilityName === 'PRP')!.newClients, { first30: 3, first90: null });
  const long = buildFacilityOverview(input({ firstChargeGroups: g, journalFirstServiceDate: '2026-01-02' }));
  assert.deepEqual(long.sites.find((s) => s.facilityName === 'PRP')!.newClients, { first30: 3, first90: 9 });
});

test('census facility grouping: rows are facilities, unknown facility under "No Valant facility", appointments inferred', () => {
  const date = '2026-10-18';
  const window = practiceDayBounds(date, TZ);
  const at = new Date(window.start.getTime() + 14 * 3_600_000);
  const base: CensusInput = {
    now: new Date(window.start.getTime() + 15 * 3_600_000), date, timeZone: TZ, window,
    locations: [{ id: 'PRP', name: 'PRP', active: true }, { id: 'IOP', name: 'IOP', active: true }],
    locationId: null, prpAttendance: [], tmsSessions: [], spravatoSessions: [], residents: [], unlinkedResidents: 0, capacity: [], crisisEpisodes: [],
    caseload: { activeClients: [{ locationId: 'PRP', count: 4 }, { locationId: null, count: 9 }], prpActive: [], primaryCareActive: [], tmsActive: [], spravatoActive: [] },
    appointmentLocationColumn: false, grouping: 'facility',
    appointments: [
      { clientId: 'c1', clinicianId: null, clinicianName: null, clinicianRole: null, type: 'Therapy', notes: null, isVirtual: false, status: 'COMPLETED', startsAt: at, appointmentLocation: null, clientLocationId: 'PRP', protected: false },
      { clientId: 'c2', clinicianId: null, clinicianName: null, clinicianRole: null, type: 'Therapy', notes: null, isVirtual: false, status: 'COMPLETED', startsAt: at, appointmentLocation: null, clientLocationId: null, protected: false },
    ],
  };
  const c = buildPracticeCensus(base);
  assert.equal(c.grouping, 'facility');
  const prp = c.locations.find((l) => l.locationId === 'PRP')!;
  assert.equal(prp.appointments.counts.completed, 1);
  assert.equal(prp.inferredAppointments, 1);
  const none = c.locations.find((l) => l.locationId === null)!;
  assert.equal(none.name, 'No Valant facility');
  assert.equal(c.caseload.rows.find((r) => r.locationId === null)!.activeClients, 9);
  assert.equal(c.caseload.totals.activeClients, 13);
  // default stays by location
  assert.equal(buildPracticeCensus({ ...base, grouping: undefined }).locations.find((l) => l.locationId === null)!.name, 'No location');
});

test('client import captures the assigned facility; facility-only re-import is idempotent and touches nothing else', () => {
  const f = resolveClientFields({ 'Pt. ID': '101', 'Pt. Name (First)': 'A', 'Pt. Name (Last)': 'B', 'Assigned Fac Name': ' MD Behavioral Health  - PRP ', 'Assigned Fac Address (City)': 'Bowie' }, 'valant');
  assert.equal(f.valantFacility, 'MD Behavioral Health  - PRP');
  const v = validateClient(f);
  assert.ok(v.ok && v.value.valantFacility === 'MD Behavioral Health - PRP' && v.value.location === 'Bowie');
  // a facility Id column wins over the entity name
  assert.equal(resolveClientFields({ 'Assigned Fac Id': 'PRP', 'Assigned Fac Name': 'MD Behavioral Health - PRP' }, 'valant').valantFacility, 'PRP');

  const existing = [
    { id: 'c1', sourceId: '101', valantFacility: null },
    { id: 'c2', sourceId: '102', valantFacility: 'MD Behavioral Health' },
    { id: 'c3', sourceId: '103', valantFacility: 'MD Behavioral Health - STM' },
    { id: 'c4a', sourceId: '104', valantFacility: null },
    { id: 'c4b', sourceId: '104', valantFacility: null },
  ];
  const rows = [
    { row: 1, sourceId: '101', valantFacility: 'MD Behavioral Health - PRP' },
    { row: 2, sourceId: '102', valantFacility: 'MD Behavioral Health' },
    { row: 3, sourceId: '103', valantFacility: '' }, // blank never clears
    { row: 4, sourceId: '104', valantFacility: 'MD Behavioral Health' },
    { row: 5, sourceId: '999', valantFacility: 'MD Behavioral Health' },
  ];
  const plan = planClientFacilityUpdates(rows, existing);
  assert.deepEqual(plan.updates, [{ clientId: 'c1', from: null, to: 'MD Behavioral Health - PRP' }]);
  assert.equal(plan.unchanged, 1);
  assert.equal(plan.noFacility, 1);
  assert.equal(plan.ambiguous.length, 1);
  assert.equal(plan.notFound.length, 1);
  const again = planClientFacilityUpdates(rows, existing.map((c) => (c.id === 'c1' ? { ...c, valantFacility: 'MD Behavioral Health - PRP' } : c)));
  assert.equal(again.updates.length, 0);

  const route = read('src/app/api/migration/clients/route.ts');
  const facBlock = route.slice(route.indexOf("if (scope === 'facility')"), route.indexOf('const primaryLocationId'));
  assert.match(facBlock, /data: \{ valantFacility: value \}/);
  assert.doesNotMatch(facBlock, /client\.create|client\.update\(|locationId:|status: '/);
});

test('no backfill from the city; migration adds the column only', () => {
  const sql = read('prisma/migrations/20261019_client_valant_facility.sql');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "valantFacility" TEXT/);
  assert.doesNotMatch(sql, /UPDATE\s+"Client"/i);
  assert.match(read('prisma/schema.prisma'), /valantFacility String\?/);
});

test('practice overview loaders and the check script stay free of auth / next-auth imports', () => {
  const os = read('src/lib/locations/overviewServer.ts');
  assert.doesNotMatch(os, /from '(@\/lib\/auth\/tenant|next-auth|next\/navigation)/);
  const census = read('src/lib/locations/censusServer.ts');
  assert.doesNotMatch(census, /from '\.\/server'|@\/lib\/auth\/tenant/);
  const script = read('scripts/check-practice-overview.ts');
  assert.doesNotMatch(script, /@\/lib\/locations\/server'/);
  for (const f of ['src/lib/locations/facilityOverview.ts', 'src/lib/billing/overviewValant.ts', 'src/lib/reports/outcomesReports.ts']) {
    assert.doesNotMatch(read(f), /^'use client'|from '(next\/navigation|next-auth)/m, f);
  }
});
