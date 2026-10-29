import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  detectVirtual,
  extractChartId,
  historyExternalKey,
  isNonPatient,
  isValantBillerLayout,
  legacyLocationId,
  mapHeaders,
  mapValantStatus,
  maskChartId,
  matchInitialLastName,
  mergeVisits,
  nameDobKey,
  parseClock,
  parseClockRange,
  parseHistoryDate,
  parseValantHistoryCsv,
  planValantHistory,
  procedureCodes,
  resolveHistoryStatus,
  slotKey,
  summarizeParse,
  VALANT_HISTORY_SOURCE,
  type ClientRef,
  type PlanLookups,
} from '../src/lib/migration/valantAppointmentHistory';
import { buildProviderCodeMap } from '../src/lib/migration/valantProviderMap';
import { ATTENDED_APPOINTMENT_STATUSES } from '../src/lib/clinical/sessionFrequency';
import { NOT_IMPORTED_HISTORY } from '../src/lib/appointments/importedHistory';

const ROOT = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// Synthetic fixture: fake names and chart ids only
const CLEAN_CSV = [
  '﻿Appointment Date,Time,Rendering Provider,Patient Name,Chart #,DOB,Dx,Duration,Tx Code,Units,Modifiers,Appt Status,Location,Notes',
  '7/1/2025,10:00-10:50 AM,A.Tester,"Testy Q. Person (TST001)",,1/2/1980,"F33.1, F41.1",50,90837T,1,,Checked Out,Bowie,Tele',
  '7/1/2025,11:30-12:20 PM,A.Tester,"Fakey Patient (TST002)",,,F41.1,50,90837,1,95,,Silver Spring,',
  '45839,2:00 PM,B.Sample,"Nobody Real (TST003)",,,,30,,,,No Show,,',
  '7/2/2025,09:00-09:30 AM,A.Tester,NON-PATIENT,,,,30,,,,,,Lunch',
  '7/2/2025,1:00-1:30 PM,A.Tester,"Missing Chart",,,,30,90834,,,,,',
  '7/3/2025,3:00-3:50 PM,Zed Unknown,"Not Imported (ZZZ999)",,,,50,90834,,,,,',
  '7/3/2025,4:00-4:30 PM,A.Tester,"Fakey Patient (TST002)",,,,30,,,,,,',
].join('\r\n');

function billerRow(cells: Record<number, string>): string[] {
  const r = Array.from({ length: 29 }, () => '');
  r[0] = 'Appointments between 7/1/2025 and 10/24/2026';
  for (const [k, v] of Object.entries(cells)) r[Number(k)] = v;
  return r;
}
const BILLER_HEADER = ['textBox1', 'textBox2', 'textBox9', 'textBox1', 'textBox1', 'textBox1', 'textBox3', 'textBox2', 'textBox4', 'textBox5', 'textBox7', 'textBox8', 'textBox9', 'Note', 'textBox10', 'textBox6', 'textBox11', 'textBox12', 'textBox13', 'textBox14', 'textBox15', 'textBox16', 'textBox17', 'textBox18', 'textBox20', 'textBox21', 'textBox22', 'textBox23', 'textBox24'];
const csvLine = (cells: string[]) => cells.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',');
const BILLER_CSV = [
  csvLine(BILLER_HEADER),
  csvLine(billerRow({ 5: 'Tuesday, July 1, 2025', 6: '12:00-10:00 AM', 7: 'NON-PATIENT', 13: 'Notes:', 15: 'A.Tester', 18: '600' })),
  csvLine(billerRow({ 5: 'Tuesday, July 1, 2025', 6: '11:30-12:20 PM', 7: 'Testy Q. Person (TST001)', 8: 'F33.1, F41.1', 9: '99214T', 13: 'Notes: ', 15: 'A.Tester', 17: '1', 18: '50' })),
  csvLine(billerRow({ 5: 'Tuesday, July 1, 2025', 6: '02:00-02:50 PM', 7: 'Fakey Patient (TST002)', 9: 'NSH - Thrpy', 13: 'Notes: tele', 15: 'B.Sample', 18: '50' })),
  csvLine(billerRow({ 5: 'Wednesday, July 2, 2025', 6: '09:00-09:50 AM', 7: 'Fakey Patient (TST002)', 9: 'RESCHEDULED', 13: 'Notes:', 15: 'B.Sample', 18: '50' })),
  csvLine(billerRow({ 5: 'Wednesday, July 2, 2025', 6: '10:00-10:50 AM', 7: 'Fakey Patient (TST002)', 9: '99215-Spravato', 13: 'Notes:', 15: 'B.Sample', 18: '50' })),
  csvLine(billerRow({ 5: 'Wednesday, July 2, 2025', 6: '11:00-11:50 AM', 7: 'Fakey Patient (TST002)', 9: '', 13: 'Notes:', 15: 'B.Sample', 18: '50' })),
].join('\n');

// ─── Header aliasing / CSV quirks ─────────────────────────────────────────────

test('header aliases are case/space/punctuation-insensitive', () => {
  const m = mapHeaders(['Service Date', ' START TIME ', 'End Time', 'Clinician', 'Client Name', 'Account #', 'Dx', 'Minutes', 'CPT Code', 'Appt. Status', 'Facility', 'Comments', 'POS']);
  assert.deepEqual(m, { date: 0, start: 1, end: 2, provider: 3, patient: 4, patientId: 5, diagnoses: 6, duration: 7, code: 8, status: 9, facility: 10, notes: 11, pos: 12 });
  assert.equal(mapHeaders(['MRN']).patientId, 0);
  assert.equal(mapHeaders(['Procedure']).code, 0);
});

test('clean export: BOM, quotes, CRLF, serial date, NON-PATIENT, missing chart id', () => {
  const p = parseValantHistoryCsv(CLEAN_CSV);
  assert.equal(p.ok, true);
  if (!p.ok) return;
  assert.equal(p.layout, 'headers');
  assert.equal(p.nonPatient, 1);
  assert.equal(p.noChartId, 1);
  assert.equal(p.rows.length, 5);
  const [a, b, c] = p.rows;
  assert.equal(a.chartId, 'TST001');
  assert.equal(a.patientName, 'Testy Q. Person');
  assert.equal(a.dob, '1980-01-02');
  assert.equal(a.localDate, '2025-07-01');
  // 10:00 EDT = 14:00Z
  assert.equal(a.startsAt.toISOString(), '2025-07-01T14:00:00.000Z');
  assert.equal(a.endsAt.toISOString(), '2025-07-01T14:50:00.000Z');
  assert.equal(b.startsAt.toISOString(), '2025-07-01T15:30:00.000Z');
  assert.equal(b.endsAt.toISOString(), '2025-07-01T16:20:00.000Z');
  // Excel serial 45839 = 2025-07-01; single start time + duration
  assert.equal(c.localDate, '2025-07-01');
  assert.equal(c.startsAt.toISOString(), '2025-07-01T18:00:00.000Z');
  assert.equal(c.endsAt.toISOString(), '2025-07-01T18:30:00.000Z');
});

test('unknown headers are refused with the header list (no guessing)', () => {
  const p = parseValantHistoryCsv('foo,bar,baz\n1,2,3\n');
  assert.equal(p.ok, false);
  if (!p.ok) assert.deepEqual(p.headers, ['foo', 'bar', 'baz']);
});

test('day header rows carry the date; "Notes:" continuation lines attach to the previous visit', () => {
  const csv = ['Time,Provider,Patient,Tx Code', '"Tuesday, July 1, 2025"', '10:00-10:50 AM,A.Tester,"Fake One (TST010)",90834', 'Notes: Tele', '"Wednesday, July 2, 2025"', '09:00-09:30 AM,A.Tester,"Fake One (TST010)",90832'].join('\n');
  const p = parseValantHistoryCsv(csv);
  assert.equal(p.ok, true);
  if (!p.ok) return;
  assert.deepEqual(p.rows.map((r) => r.localDate), ['2025-07-01', '2025-07-02']);
  assert.equal(p.rows[0].notes, 'Tele');
  assert.equal(detectVirtual({ notes: p.rows[0].notes }).isVirtual, true);
});

test('Valant SSRS Biller Appointments layout is read by position', () => {
  const p = parseValantHistoryCsv(BILLER_CSV);
  assert.equal(p.ok, true);
  if (!p.ok) return;
  assert.equal(isValantBillerLayout([BILLER_HEADER, billerRow({})]), true);
  assert.equal(p.layout, 'valant_biller_positional');
  assert.equal(p.nonPatient, 1);
  assert.equal(p.rows.length, 5);
  assert.equal(p.rows[0].chartId, 'TST001');
  assert.equal(p.rows[0].provider, 'A.Tester');
  assert.equal(p.rows[0].startsAt.toISOString(), '2025-07-01T15:30:00.000Z');
  const s = summarizeParse(p);
  assert.deepEqual(s.byStatus, { COMPLETED: 2, NO_SHOW: 1, CANCELLED: 1, 'UNKNOWN (skipped)': 1 });
  assert.equal(s.virtualSignals.codeSuffixT, 1);
  assert.equal(s.virtualSignals.notesTele, 1);
  assert.equal(s.distinctChartIds, 2);
  // Summary never carries names
  assert.doesNotMatch(JSON.stringify(s), /Testy|Fakey|TST0/);
});

// ─── Cell parsers ─────────────────────────────────────────────────────────────

test('dates: long form, M/D/YYYY, two-digit year, ISO, Excel serial with time', () => {
  assert.deepEqual(parseHistoryDate('Tuesday, July 1, 2025'), { y: 2025, m: 7, d: 1, minutes: null });
  assert.deepEqual(parseHistoryDate('Sept 3, 2025'), { y: 2025, m: 9, d: 3, minutes: null });
  assert.deepEqual(parseHistoryDate('10/24/2026'), { y: 2026, m: 10, d: 24, minutes: null });
  assert.deepEqual(parseHistoryDate('7/1/25 2:30 PM'), { y: 2025, m: 7, d: 1, minutes: 870 });
  assert.deepEqual(parseHistoryDate('2026-03-08'), { y: 2026, m: 3, d: 8, minutes: null });
  assert.deepEqual(parseHistoryDate('45839.5'), { y: 2025, m: 7, d: 1, minutes: 720 });
  assert.equal(parseHistoryDate('2/30/2026'), null);
  assert.equal(parseHistoryDate('soon'), null);
});

test('time ranges: single suffix, AM/PM crossing, both suffixes, 24h, duration disambiguation', () => {
  assert.deepEqual(parseClockRange('10:00-10:50 AM'), { start: 600, end: 650 });
  assert.deepEqual(parseClockRange('11:30-12:20 PM'), { start: 690, end: 740 });
  assert.deepEqual(parseClockRange('12:30-01:20 PM'), { start: 750, end: 800 });
  assert.deepEqual(parseClockRange('06:00-05:00 PM'), { start: 360, end: 1020 });
  assert.deepEqual(parseClockRange('11:30 AM - 12:20 PM'), { start: 690, end: 740 });
  assert.deepEqual(parseClockRange('14:00-14:45'), { start: 840, end: 885 });
  // "12:00-10:00 AM" with 600 minutes = midnight to 10 AM
  assert.deepEqual(parseClockRange('12:00-10:00 AM', 600), { start: 0, end: 600 });
  assert.deepEqual(parseClockRange('2:00 PM'), { start: 840, end: 840 });
  assert.equal(parseClock('12:00 AM'), 0);
  assert.equal(parseClock('12:15 pm'), 735);
  assert.equal(parseClock('0.5'), 720);
  assert.equal(parseClock('25:00'), null);
});

test('DST: the same wall-clock time maps to the right UTC instant in winter and summer', () => {
  const csv = ['Date,Time,Patient', '1/15/2026,10:00 AM,"Fake (TST1)"', '7/15/2026,10:00 AM,"Fake (TST1)"'].join('\n');
  const p = parseValantHistoryCsv(csv);
  assert.equal(p.ok, true);
  if (!p.ok) return;
  assert.equal(p.rows[0].startsAt.toISOString(), '2026-01-15T15:00:00.000Z');
  assert.equal(p.rows[1].startsAt.toISOString(), '2026-07-15T14:00:00.000Z');
});

test('chart id extraction and NON-PATIENT', () => {
  assert.deepEqual(extractChartId('Jane Q. Doe (abc123)'), { chartId: 'ABC123', name: 'Jane Q. Doe' });
  assert.deepEqual(extractChartId('Jane (Janie) Doe (XYZ9876)'), { chartId: 'XYZ9876', name: 'Jane (Janie) Doe' });
  assert.equal(extractChartId('No Id Here').chartId, null);
  assert.equal(isNonPatient('NON-PATIENT'), true);
  assert.equal(isNonPatient('Non Patient'), true);
  assert.equal(isNonPatient('Nonna Patient (A1)'), false);
});

test('procedure codes and code-column / status-column status mapping', () => {
  assert.deepEqual(procedureCodes('90837T'), ['90837']);
  assert.deepEqual(procedureCodes('99215-Spravato'), ['99215']);
  assert.deepEqual(procedureCodes('90847C-ITPC'), ['90847']);
  assert.deepEqual(procedureCodes('99214, 90833'), ['99214', '90833']);
  assert.deepEqual(procedureCodes('H0032'), ['H0032']);
  assert.deepEqual(procedureCodes('NSHDOC'), []);
  assert.deepEqual(procedureCodes('RESCHEDULED'), []);
  assert.equal(mapValantStatus('NSH - Thrpy'), 'NO_SHOW');
  assert.equal(mapValantStatus('NSHINJ'), 'NO_SHOW');
  assert.equal(mapValantStatus('No Show'), 'NO_SHOW');
  assert.equal(mapValantStatus('Late Cancel'), 'LATE_CANCEL');
  assert.equal(mapValantStatus('Cancelled < 24 hours'), 'LATE_CANCEL');
  assert.equal(mapValantStatus('Cancelled'), 'CANCELLED');
  assert.equal(mapValantStatus('RESCHEDULED'), 'CANCELLED');
  assert.equal(mapValantStatus('Checked Out'), 'COMPLETED');
  assert.equal(mapValantStatus('Scheduled'), null);
});

test('CPT -> attended; status wins; uncoded is unknown unless the owner flag is set', () => {
  const coded = { statusText: '', codes: ['90837'], codeCells: ['90837T'] };
  assert.deepEqual(resolveHistoryStatus(coded), { status: 'COMPLETED', basis: 'procedure_code' });
  assert.ok((ATTENDED_APPOINTMENT_STATUSES as readonly string[]).includes('COMPLETED'));
  assert.deepEqual(resolveHistoryStatus({ ...coded, statusText: 'No Show' }), { status: 'NO_SHOW', basis: 'status_column' });
  assert.deepEqual(resolveHistoryStatus({ statusText: '', codes: [], codeCells: ['RESCHEDULED'] }), { status: 'CANCELLED', basis: 'code_column_text' });
  const uncoded = { statusText: '', codes: [], codeCells: [] };
  assert.deepEqual(resolveHistoryStatus(uncoded), { status: null, basis: 'unknown_status' });
  assert.deepEqual(resolveHistoryStatus(uncoded, { treatUncodedAsAttended: true }), { status: 'COMPLETED', basis: 'uncoded_flag' });
  // A cancelled / rescheduled / no-show visit never counts as seen
  for (const s of ['CANCELLED', 'NO_SHOW', 'LATE_CANCEL']) assert.ok(!(ATTENDED_APPOINTMENT_STATUSES as readonly string[]).includes(s));
});

test('telehealth detection signals', () => {
  assert.equal(detectVirtual({ codeCell: '99214T' }).signals.codeSuffixT, true);
  assert.equal(detectVirtual({ codeCell: '90847C-ITPC' }).isVirtual, false);
  assert.equal(detectVirtual({ codeCell: '99214S' }).isVirtual, false);
  assert.equal(detectVirtual({ notes: 'Tele' }).signals.notesTele, true);
  assert.equal(detectVirtual({ notes: 'telehealth visit' }).isVirtual, true);
  assert.equal(detectVirtual({ modifiers: ['95'] }).signals.modifier, true);
  assert.equal(detectVirtual({ modifiers: ['GT'] }).isVirtual, true);
  assert.equal(detectVirtual({ pos: '02' }).signals.pos, true);
  assert.equal(detectVirtual({ pos: '10' }).isVirtual, true);
  assert.equal(detectVirtual({ pos: '11' }).isVirtual, false);
  assert.deepEqual(detectVirtual({ modifiers: ['FQ'] }), { isVirtual: true, audioOnly: true, signals: { codeSuffixT: false, notesTele: false, modifier: true, pos: false } });
  assert.equal(detectVirtual({ notes: 'in office' }).isVirtual, false);
});

// ─── External key / merge ─────────────────────────────────────────────────────

test('external key is stable, case/space-insensitive for chart id and provider, and distinct per visit', () => {
  const base = { chartId: 'TST001', localDate: '2025-07-01', startMinutes: 600, provider: 'A.Tester' };
  const k = historyExternalKey(base);
  assert.match(k, /^vh1:[0-9a-f]{40}$/);
  assert.equal(historyExternalKey({ ...base }), k);
  assert.equal(historyExternalKey({ ...base, chartId: 'tst001', provider: ' a.tester ' }), k);
  assert.notEqual(historyExternalKey({ ...base, startMinutes: 630 }), k);
  assert.notEqual(historyExternalKey({ ...base, provider: 'B.Sample' }), k);
  assert.notEqual(historyExternalKey({ ...base, localDate: '2025-07-02' }), k);
  // Same file parsed twice -> same keys (idempotent re-runs)
  const a = parseValantHistoryCsv(CLEAN_CSV);
  const b = parseValantHistoryCsv(CLEAN_CSV);
  assert.ok(a.ok && b.ok);
  if (a.ok && b.ok) assert.deepEqual(mergeVisits(a.rows).map((v) => v.externalKey), mergeVisits(b.rows).map((v) => v.externalKey));
});

test('an E/M + add-on billed as two lines is one visit with the primary code first', () => {
  const csv = ['Date,Time,Provider,Patient,CPT', '7/1/2025,10:00-10:30 AM,A.Tester,"Fake (TST5)",90833', '7/1/2025,10:00-10:30 AM,A.Tester,"Fake (TST5)",99214'].join('\n');
  const p = parseValantHistoryCsv(csv);
  assert.ok(p.ok);
  if (!p.ok) return;
  const v = mergeVisits(p.rows);
  assert.equal(v.length, 1);
  assert.deepEqual(v[0].codes, ['99214', '90833']);
  assert.deepEqual(v[0].lines, [2, 3]);
});

// ─── Planner ──────────────────────────────────────────────────────────────────

function lookups(over: Partial<PlanLookups> = {}): PlanLookups {
  const clientsByChartId = new Map<string, ClientRef>([
    ['TST001', { id: 'c1', name: 'Client One', locationName: 'Bowie' }],
    ['TST002', { id: 'c2', name: 'Client Two', locationName: null }],
    ['TST003', { id: 'c3', name: 'Client Three', locationName: 'Baltimore' }],
  ]);
  return {
    clientsByChartId,
    clientsByNameDob: new Map(),
    providerMap: buildProviderCodeMap([{ codeKey: 'b.sample', userId: 'u2' }]),
    staff: [
      { id: 'u1', name: 'Alice Tester' },
      { id: 'u2', name: 'Bea Sample' },
      { id: 'u3', name: 'Zed Other' },
    ],
    existingKeys: new Set(),
    existingSlots: new Map(),
    ...over,
  };
}
const NOW = new Date('2026-10-24T20:00:00Z');

function cleanVisits() {
  const p = parseValantHistoryCsv(CLEAN_CSV);
  assert.ok(p.ok);
  return p.ok ? mergeVisits(p.rows) : [];
}

test('planner: matched / unmatched buckets, statuses, providers, location, notes text', () => {
  const plan = planValantHistory(cleanVisits(), lookups(), { organizationId: 'org1', now: NOW });
  assert.equal(plan.counts.visits, 5);
  assert.equal(plan.counts.unmatchedVisits, 1);
  assert.equal(plan.counts.unmatchedChartIds, 1);
  assert.deepEqual(plan.unmatched, [{ chartId: 'ZZZ999', localDate: '2025-07-03', suggestedClientId: null }]);
  assert.equal(plan.counts.unknownStatusSkipped, 1);
  assert.equal(plan.counts.wouldCreate, 3);
  assert.deepEqual(plan.byStatus, { COMPLETED: 2, NO_SHOW: 1 });
  assert.equal(plan.counts.matchedClients, 3);

  const [one, two, three] = plan.creates;
  assert.equal(one.clientId, 'c1');
  assert.equal(one.clinicianId, 'u1'); // "A.Tester" -> Alice Tester (initial + last name, unique)
  assert.equal(one.status, 'COMPLETED');
  assert.equal(one.isVirtual, true);
  assert.equal(one.type, 'Individual Therapy');
  assert.equal(one.locationId, 'bowie');
  assert.equal(one.source, VALANT_HISTORY_SOURCE);
  assert.equal(one.createdVia, 'import');
  assert.match(one.notes, /Valant code: 90837/);
  assert.doesNotMatch(one.notes, /Tele/); // free-text notes are not copied
  assert.equal(two.locationId, 'ss');
  assert.equal(two.isVirtual, true); // modifier 95
  assert.equal(three.status, 'NO_SHOW');
  assert.equal(three.clinicianId, 'u2'); // ValantProviderMap
  assert.equal(three.type, 'Valant visit');
  assert.equal(plan.counts.providerByMap, 1);
  assert.equal(plan.counts.providerByName, 2);
  assert.deepEqual(plan.providersMatchedByName, { 'A.Tester': 'Alice Tester' });
});

test('planner: owner flag imports uncoded visits; unmatched provider keeps the label', () => {
  const plan = planValantHistory(cleanVisits(), lookups({ staff: [] }), { organizationId: 'org1', now: NOW, treatUncodedAsAttended: true });
  assert.equal(plan.counts.uncodedImportedAsAttended, 1);
  assert.equal(plan.counts.wouldCreate, 4);
  assert.ok(plan.creates.every((c) => c.clinicianId === null || c.clinicianId === 'u2'));
  assert.equal(plan.creates[0].clinicianName, 'A.Tester');
  assert.equal(plan.unmatchedProviders['A.Tester'], 3);
});

test('planner: re-run skips already-imported keys and same-slot appointments; date window; future', () => {
  const visits = cleanVisits();
  const first = planValantHistory(visits, lookups(), { organizationId: 'org1', now: NOW });
  const rerun = planValantHistory(visits, lookups({ existingKeys: new Set(first.creates.map((c) => c.externalKey)) }), { organizationId: 'org1', now: NOW });
  assert.equal(rerun.counts.wouldCreate, 0);
  assert.equal(rerun.counts.alreadyImported, 3);

  const slot = slotKey('c1', first.creates[0].startsAt);
  const clash = planValantHistory(visits, lookups({ existingSlots: new Map([[slot, [{ clinicianId: 'u1', clinicianName: 'Alice Tester', status: 'SCHEDULED' }]]]) }), { organizationId: 'org1', now: NOW });
  assert.equal(clash.counts.existingAppointmentSkipped, 1);
  assert.equal(clash.counts.existingPastScheduled, 1);
  // A different clinician at the same time is a different visit (med check + therapy)
  const other = planValantHistory(visits, lookups({ existingSlots: new Map([[slot, [{ clinicianId: 'u3', clinicianName: 'Zed Other', status: 'COMPLETED' }]]]) }), { organizationId: 'org1', now: NOW });
  assert.equal(other.counts.existingAppointmentSkipped, 0);

  const windowed = planValantHistory(visits, lookups(), { organizationId: 'org1', now: NOW, since: '2025-07-02' });
  assert.equal(windowed.counts.outsideDateRange, 3);
  const early = planValantHistory(visits, lookups(), { organizationId: 'org1', now: new Date('2025-07-01T15:00:00Z') });
  assert.equal(early.counts.future, 4);
});

test('planner: name + DOB is a suggestion only, never an automatic link', () => {
  const key = nameDobKey('Testy Q. Person', '1980-01-02')!;
  assert.equal(key, 'testy person|1980-01-02');
  assert.equal(nameDobKey('Person, Testy', '1980-01-02'), key);
  const plan = planValantHistory(cleanVisits(), lookups({ clientsByChartId: new Map(), clientsByNameDob: new Map([[key, ['c9']]]) }), { organizationId: 'org1', now: NOW });
  assert.equal(plan.counts.wouldCreate, 0);
  assert.equal(plan.counts.nameDobSuggestions, 1);
  assert.equal(plan.unmatched.find((u) => u.chartId === 'TST001')?.suggestedClientId, 'c9');
});

test('strict provider matching: initial + last name only, unique only', () => {
  const staff = [
    { id: 'u1', name: 'Kofi Daniel' },
    { id: 'u2', name: 'Rita Betts-Walker' },
    { id: 'u3', name: 'Sam Pete, LCPC' },
    { id: 'u4', name: 'Ada Gbadehan' },
    { id: 'u5', name: 'Mackenzie Someone' },
  ];
  assert.equal(matchInitialLastName('K.Daniel', staff)?.id, 'u1');
  assert.equal(matchInitialLastName('R.Betts-Walker', staff)?.id, 'u2');
  assert.equal(matchInitialLastName('S. Pete', staff)?.id, 'u3');
  assert.equal(matchInitialLastName('Dr. A Gbadehan', staff)?.id, 'u4');
  assert.equal(matchInitialLastName('Daniel K', staff), null);
  assert.equal(matchInitialLastName('Mackenzie', staff), null);
  assert.equal(matchInitialLastName('LBarefoot', staff), null);
  assert.equal(matchInitialLastName('K.Daniel', [...staff, { id: 'u6', name: 'Kim Daniel' }]), null);
});

test('location and masking helpers', () => {
  assert.equal(legacyLocationId('Bowie'), 'bowie');
  assert.equal(legacyLocationId('Divine Counseling - Silver Spring'), 'ss');
  assert.equal(legacyLocationId('Baltimore'), 'balt');
  assert.equal(legacyLocationId('Somewhere Else'), null);
  assert.equal(maskChartId('ABC123'), '****23');
  assert.equal(maskChartId('A'), '**');
});

// ─── Side effects ─────────────────────────────────────────────────────────────

test('importer never imports booking, notification, telehealth, billing, note or DrFirst modules', () => {
  for (const rel of ['src/lib/migration/valantAppointmentHistory.ts', 'scripts/import-valant-appointment-history.ts']) {
    const src = read(rel);
    const imports = [...src.matchAll(/(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/g)].map((m) => m[1]);
    assert.ok(imports.length > 0, rel);
    for (const mod of imports) {
      assert.doesNotMatch(mod, /appointments\/manage|scheduling\/manage|sms|reminder|notif|email|push|claim|billing|ledger|charge|patientPayments|drfirst|telehealth|notes\//i, `${rel} imports ${mod}`);
    }
    assert.doesNotMatch(src, /createAppointment\s*\(/, rel);
  }
  const script = read('scripts/import-valant-appointment-history.ts');
  assert.match(script, /createMany\(\{ data: batch, skipDuplicates: true \}\)/);
  // Exactly one audit event per run
  assert.equal((script.match(/writeAuditLog\(\{/g) || []).length, 1);
});

test('imported history is excluded from missing-note queues, documentation rate, unbilled report and AutoPay', () => {
  assert.deepEqual(NOT_IMPORTED_HISTORY, { OR: [{ source: null }, { source: { not: VALANT_HISTORY_SOURCE } }] });
  for (const rel of ['src/lib/notes/worklist.ts', 'src/lib/tasks/manage.ts', 'src/lib/patientPayments/server.ts', 'src/lib/analytics/visitDocumentationServer.ts', 'src/lib/reports/library/runners/billing.ts']) {
    assert.match(read(rel), /\.\.\.NOT_IMPORTED_HISTORY/, rel);
  }
  assert.equal((read('src/lib/tasks/manage.ts').match(/\.\.\.NOT_IMPORTED_HISTORY/g) || []).length, 2);
});

test('schema and migration carry source + externalKey with a per-org unique index', () => {
  const schema = read('prisma/schema.prisma');
  const model = schema.slice(schema.indexOf('model Appointment {'), schema.indexOf('/// Recurring appointment series'));
  assert.match(model, /\n\s+source\s+String\?/);
  assert.match(model, /\n\s+externalKey\s+String\?/);
  assert.match(model, /@@unique\(\[organizationId, externalKey\]\)/);
  const sql = read('prisma/migrations/20261025_valant_appointment_history.sql');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "source"/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "externalKey"/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS "Appointment_organizationId_externalKey_key"/);
});

test('planner: a past SCHEDULED appointment at the same slot is planned for close-out with the Valant outcome', () => {
  const visits = cleanVisits();
  const first = planValantHistory(visits, lookups(), { organizationId: 'org1', now: NOW });
  const target = first.creates[0];
  const slot = slotKey('c1', target.startsAt);
  const plan = planValantHistory(visits, lookups({ existingSlots: new Map([[slot, [{ id: 'appt-old', clinicianId: 'u1', clinicianName: 'Alice Tester', status: 'SCHEDULED' }]]]) }), { organizationId: 'org1', now: NOW });
  assert.equal(plan.closeOuts.length, 1);
  assert.equal(plan.closeOuts[0].id, 'appt-old');
  assert.equal(plan.closeOuts[0].status, target.status);
  assert.equal(plan.closeOuts[0].externalKey, target.externalKey);
  // A slot that is already closed out (COMPLETED) is left alone
  const done = planValantHistory(visits, lookups({ existingSlots: new Map([[slot, [{ id: 'appt-done', clinicianId: 'u1', clinicianName: 'Alice Tester', status: 'COMPLETED' }]]]) }), { organizationId: 'org1', now: NOW });
  assert.equal(done.closeOuts.length, 0);
});

test('importer: close-out stamps imported history (no billing / AutoPay) and fills providers once mapped', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts/import-valant-appointment-history.ts'), 'utf8');
  assert.match(src, /flag\('close-out-scheduled'\)/);
  assert.match(src, /status: 'SCHEDULED', startsAt: \{ lt: new Date\(\) \}/, 'only still-SCHEDULED past rows are touched');
  assert.match(src, /source: VALANT_HISTORY_SOURCE, externalKey: c\.externalKey/, 'closed-out rows are stamped so NOT_IMPORTED_HISTORY guards apply');
  assert.match(src, /clinicianId: null, clinicianName: \{ equals: m\.providerCode, mode: 'insensitive' \}/);
});
