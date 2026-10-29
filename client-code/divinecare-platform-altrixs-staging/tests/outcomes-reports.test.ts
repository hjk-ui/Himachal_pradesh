import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  GAD7,
  NO_PAYER,
  PHQ9,
  REPORTS_PATH,
  buildReportCsv,
  clinicianProductivity,
  computeFollowUp,
  computeInstrumentOutcomes,
  coverageRate,
  drugClassOf,
  firstPayer,
  foldClaimsByPayer,
  foldValantByKey,
  outcomeSummary,
  parseReportFilters,
  reportClientWhere,
  summarizeAppointmentStatuses,
  summarizeClaims,
  summarizeCssrs,
  summarizeMedications,
  valantReportWhere,
  zonedStartOfDay,
  type OutcomesReport,
  type ReportScope,
  type ScorePoint,
} from '../src/lib/reports/outcomesReports';
import { canAccessPath } from '../src/lib/auth/roleAccess';

const DAY = 86_400_000;
const T0 = new Date('2026-05-01T15:00:00Z');
const at = (days: number) => new Date(T0.getTime() + days * DAY);
const range = { from: new Date('2026-04-01T04:00:00Z'), toExclusive: new Date('2026-10-01T04:00:00Z') };
const pt = (clientId: string, score: number, days: number): ScorePoint => ({ clientId, score, at: at(days) });

// ─── Filters ─────────────────────────────────────────────────────────────────

test('filters default to the last 90 days in clinic time and validate input', () => {
  const now = new Date('2026-10-17T02:00:00Z'); // Oct 16 evening in New York
  const p = parseReportFilters(new URLSearchParams(), now);
  assert.ok(p.ok && 'filters' in p);
  if (!('filters' in p)) return;
  assert.equal(p.filters.toDate, '2026-10-16');
  assert.equal(p.filters.fromDate, '2026-07-19');
  assert.equal(p.filters.tab, 'clinical');
  assert.equal(p.filters.format, 'json');
  // Midnight Eastern (EDT, UTC-4)
  assert.equal(p.filters.from.toISOString(), '2026-07-19T04:00:00.000Z');
  assert.equal(p.filters.toExclusive.toISOString(), '2026-10-17T04:00:00.000Z');

  const custom = parseReportFilters(new URLSearchParams('from=2026-01-01&to=2026-01-31&tab=financial&format=csv&location=loc_1&clinician=u1'), now);
  assert.ok('filters' in custom);
  if ('filters' in custom) {
    assert.equal(custom.filters.from.toISOString(), '2026-01-01T05:00:00.000Z'); // EST, UTC-5
    assert.equal(custom.filters.toExclusive.toISOString(), '2026-02-01T05:00:00.000Z');
    assert.equal(custom.filters.format, 'csv');
    assert.equal(custom.filters.locationId, 'loc_1');
    assert.equal(custom.filters.clinicianId, 'u1');
  }

  for (const bad of ['from=2026-02-30', 'to=yesterday', 'from=2026-03-01&to=2026-02-01', 'tab=hedis', 'format=pdf', 'from=2020-01-01&to=2026-01-01', "location=x';drop"]) {
    const r = parseReportFilters(new URLSearchParams(bad), now);
    assert.ok('error' in r, `expected error for ${bad}`);
  }
});

test('zonedStartOfDay handles DST boundaries', () => {
  assert.equal(zonedStartOfDay('2026-03-08').toISOString(), '2026-03-08T05:00:00.000Z');
  assert.equal(zonedStartOfDay('2026-03-09').toISOString(), '2026-03-09T04:00:00.000Z');
});

// ─── Scope ───────────────────────────────────────────────────────────────────

const scope = (over: Partial<ReportScope> = {}): ReportScope => ({
  organizationId: 'org1', userId: 'me', role: 'ADMIN', locationId: null, clinicianId: null, lockedClientIds: [], facilityTerm: null, ...over,
});

test('client scope: org always, caseload roles only their own clients, filters and locked clients applied', () => {
  const lead = JSON.stringify(reportClientWhere(scope(), { byAssignee: true }));
  assert.match(lead, /"organizationId":"org1"/);
  assert.doesNotMatch(lead, /assignedToId/);

  const therapist = JSON.stringify(reportClientWhere(scope({ role: 'THERAPIST' }), { byAssignee: false }));
  assert.match(therapist, /"assignedToId":"me"/);

  const filtered = JSON.stringify(reportClientWhere(scope({ locationId: 'L1', clinicianId: 'c9', lockedClientIds: ['s1'] }), { byAssignee: true }));
  assert.match(filtered, /"locationId":"L1"/);
  assert.match(filtered, /"assignedToId":"c9"/);
  assert.match(filtered, /"notIn":\["s1"\]/);

  // Event-centric metrics apply the clinician filter on the event, not the assignee
  assert.doesNotMatch(JSON.stringify(reportClientWhere(scope({ clinicianId: 'c9' }), { byAssignee: false })), /c9/);
});

test('Valant scope: leadership keeps unmatched rows, caseload only own clients, locked clients dropped', () => {
  const r = { from: new Date('2026-01-01'), toExclusive: new Date('2026-02-01') };
  const lead = JSON.stringify(valantReportWhere(scope(), r));
  assert.doesNotMatch(lead, /"client":/);
  const cl = JSON.stringify(valantReportWhere(scope({ role: 'NP' }), r));
  assert.match(cl, /"client":\{.*"assignedToId":"me"/);
  const locked = JSON.stringify(valantReportWhere(scope({ lockedClientIds: ['s1'], clinicianId: 'u2', facilityTerm: 'Bowie' }), r));
  assert.match(locked, /\{"clientId":null\},\{"clientId":\{"notIn":\["s1"\]\}\}/);
  assert.match(locked, /"providerUserId":"u2"/);
  assert.match(locked, /"contains":"Bowie","mode":"insensitive"/);
  assert.match(lead, /"serviceDate":\{"gte":"2026-01-01T00:00:00.000Z","lt":"2026-02-01T00:00:00.000Z"\}/);
});

test('reports page and API share the same role gate', () => {
  for (const role of ['ADMIN', 'PRACTICE_DIRECTOR', 'DIRECTOR']) {
    assert.equal(canAccessPath(role, REPORTS_PATH), true, role);
  }
  // Office Manager removed 2026-10-22: every tab carries practice revenue KPIs
  for (const role of ['OFFICE_MANAGER', 'BILLING', 'FRONT_DESK', 'HR', 'PEER_SUPPORT', 'THERAPIST', 'PSYCHIATRIST', 'NP', 'CLINICIAN']) assert.equal(canAccessPath(role, REPORTS_PATH), false, role);
});

test('route is audited and uses the caseload / sensitive helpers', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'api', 'reports', 'outcomes', 'route.ts'), 'utf8');
  assert.match(src, /auditPhiAccess/);
  assert.match(src, /'EXPORT' : 'READ'/);
  const q = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'reports', 'outcomesReportsQueries.ts'), 'utf8');
  assert.match(q, /lockedSensitiveClientIds/);
  const page = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'dashboard', 'reports', 'outcomes', 'page.tsx'), 'utf8');
  assert.doesNotMatch(page, /'PDF'|'Excel'/);
  assert.match(page, /format=csv/);
});

// ─── Outcomes math ───────────────────────────────────────────────────────────

test('baseline is the first score ever, latest the last before period end', () => {
  const pts = [pt('a', 18, -60), pt('a', 12, 10), pt('a', 6, 40), pt('a', 2, 200)]; // last one after period end
  const o = computeInstrumentOutcomes(pts, PHQ9, range);
  const a = o.clients[0];
  assert.equal(a.baseline, 18); // before the period (Mar 2) still counts as baseline
  assert.equal(a.latest, 6);
  assert.equal(a.change, -12);
  assert.equal(a.scores, 3);
  assert.equal(a.response, true); // 6 <= 9
  assert.equal(a.remission, false); // 6 is not < 5
  assert.equal(a.status, 'Response');
});

test('response (>= 50% drop) and remission (< 5) need baseline >= 10 and >= 4 weeks', () => {
  const pts = [
    pt('rem', 20, 0), pt('rem', 4, 30), // remission
    pt('resp', 16, 0), pt('resp', 8, 28), // exactly 50% and exactly 28 days -> response
    pt('none', 16, 0), pt('none', 9, 35), // 43.75% drop -> improving only
    pt('early', 22, 0), pt('early', 3, 27), // 27 days -> too early, not counted
    pt('low', 6, 0), pt('low', 2, 60), // baseline < 10 -> excluded from rates
    pt('single', 15, 5),
    pt('worse', 11, 0), pt('worse', 14, 40),
  ];
  const o = computeInstrumentOutcomes(pts, PHQ9, range);
  const by = new Map(o.clients.map((c) => [c.clientId, c]));
  assert.equal(by.get('rem')?.status, 'Remission');
  assert.equal(by.get('resp')?.status, 'Response');
  assert.equal(by.get('none')?.status, 'Improving');
  assert.equal(by.get('early')?.status, 'Under 4 weeks');
  assert.equal(by.get('early')?.response, null);
  assert.equal(by.get('low')?.status, 'Improving');
  assert.equal(by.get('low')?.remission, null);
  assert.equal(by.get('single')?.status, 'Baseline only');
  assert.equal(by.get('worse')?.status, 'Worsening');

  assert.equal(o.clientsMeasured, 7);
  assert.equal(o.clientsWithFollowUp, 5); // rem, resp, none, low, worse
  assert.equal(o.clientsElevatedBaseline, 4); // rem, resp, none, worse
  assert.deepEqual(o.response, { numerator: 2, denominator: 4, pct: 50 }); // rem (20->4) + resp
  assert.deepEqual(o.remission, { numerator: 1, denominator: 4, pct: 25 });
});

test('only clients with a score inside the period are reported; invalid scores dropped', () => {
  const pts = [pt('old', 20, -100), pt('old', 10, -40), pt('in', 30, 1), pt('in', 12, 2)];
  const o = computeInstrumentOutcomes(pts, PHQ9, range);
  assert.equal(o.clientsMeasured, 1);
  assert.equal(o.invalidScoresDropped, 1); // 30 > 27
  assert.equal(o.clients[0].clientId, 'in');
  assert.equal(o.clients[0].status, 'Baseline only');
});

test('empty input gives null rates, not zeros', () => {
  const o = computeInstrumentOutcomes([], GAD7, range);
  assert.equal(o.clientsMeasured, 0);
  assert.equal(o.response.pct, null);
  assert.equal(o.remission.pct, null);
  assert.equal(o.avgBaseline, null);
  assert.deepEqual(o.monthlyTrend, []);
  assert.ok(o.severity.every((s) => s.clients === 0));
});

test('monthly trend averages scores in the period; severity uses latest score', () => {
  const pts = [pt('a', 10, 0), pt('b', 20, 1), pt('a', 4, 35), pt('c', 16, 36)];
  const o = computeInstrumentOutcomes(pts, GAD7, range);
  assert.deepEqual(o.monthlyTrend, [{ month: '2026-05', avg: 15, n: 2 }, { month: '2026-06', avg: 10, n: 2 }]);
  const sev = Object.fromEntries(o.severity.map((s) => [s.label, s.clients]));
  assert.equal(sev['Minimal (0–4)'], 1); // a latest 4
  assert.equal(sev['Severe (15–21)'], 2); // b 20, c 16
});

test('C-SSRS positive = any yes or safety flag', () => {
  const s = summarizeCssrs([
    { clientId: 'a', totalScore: 0, safetyFlagged: false },
    { clientId: 'a', totalScore: 1, safetyFlagged: false },
    { clientId: 'b', totalScore: 0, safetyFlagged: true },
    { clientId: 'c', totalScore: null, safetyFlagged: false },
  ]);
  assert.deepEqual(s, { screens: 4, clientsScreened: 3, positiveScreens: 2, clientsPositive: 2 });
});

// ─── Quality ─────────────────────────────────────────────────────────────────

test('follow-up within 7 / 30 days after risk events, open windows excluded, repeats merged', () => {
  const now = at(60);
  const events = [
    { clientId: 'a', at: at(0), kind: 'risk_alert' as const },
    { clientId: 'a', at: at(3), kind: 'crisis_episode' as const }, // merged into a@0
    { clientId: 'b', at: at(0), kind: 'crisis_episode' as const },
    { clientId: 'c', at: at(0), kind: 'risk_alert' as const },
    { clientId: 'd', at: at(55), kind: 'risk_alert' as const }, // 7- and 30-day windows still open
    { clientId: 'e', at: at(40), kind: 'risk_alert' as const }, // 7 closed, 30 open
  ];
  const visits = [
    { clientId: 'a', at: at(5) }, // within 7
    { clientId: 'b', at: at(20) }, // within 30 only
    { clientId: 'c', at: at(-1) }, // before the event: does not count
    { clientId: 'e', at: at(45) },
  ];
  const r = computeFollowUp(events, visits, now);
  assert.equal(r.events, 6);
  assert.equal(r.indexEvents, 5);
  assert.deepEqual(r.byKind, { risk_alert: 4, crisis_episode: 1 });
  assert.deepEqual(r.within7, { numerator: 2, denominator: 4, pct: 50 }); // a, e of a,b,c,e
  assert.equal(r.windowOpen7, 1);
  assert.deepEqual(r.within30, { numerator: 2, denominator: 3, pct: 66.7 }); // a, b of a,b,c
  assert.equal(r.windowOpen30, 2);
});

test('coverage rate counts denominator clients that are in the numerator set', () => {
  assert.deepEqual(coverageRate(['a', 'b', 'c', 'c'], ['a', 'x']), { numerator: 1, denominator: 3, pct: 33.3 });
  assert.equal(coverageRate([], ['a']).pct, null);
});

// ─── Overview / financial ────────────────────────────────────────────────────

test('appointment summary and no-show rate', () => {
  const s = summarizeAppointmentStatuses([
    { status: 'COMPLETED', count: 90 }, { status: 'NO_SHOW', count: 10 }, { status: 'CANCELLED', count: 5 },
    { status: 'LATE_CANCEL', count: 2 }, { status: 'SCHEDULED', count: 7 },
  ]);
  assert.equal(s.total, 114);
  assert.equal(s.scheduled, 7);
  assert.deepEqual(s.noShowRate, { numerator: 10, denominator: 100, pct: 10 });
  assert.equal(summarizeAppointmentStatuses([]).noShowRate.pct, null);
});

test('claims: billed excludes drafts, paid uses remittance dollars', () => {
  const s = summarizeClaims([
    { status: 'DRAFT', count: 3, amountCents: 30000, paidAmount: null },
    { status: 'SUBMITTED', count: 2, amountCents: 20000, paidAmount: null },
    { status: 'PAID', count: 1, amountCents: 15000, paidAmount: 98.5 },
    { status: 'DENIED', count: 1, amountCents: 10000, paidAmount: null },
  ]);
  assert.deepEqual(s, { total: 7, draft: 3, billed: 4, billedCents: 45000, paid: 1, paidCents: 9850, denied: 1 });
  const byPayer = foldClaimsByPayer([
    { payer: 'Aetna', status: 'PAID', count: 1, amountCents: 100, paidAmount: 1 },
    { payer: null, status: 'SUBMITTED', count: 1, amountCents: 50, paidAmount: null },
  ]);
  assert.deepEqual(byPayer.map((p) => p.payer), ['Aetna', 'No payer on claim']);
});

test('Valant folding: first listed payer, payments/adjustments shown positive', () => {
  assert.equal(firstPayer('NOVITAS SOLUTIONS PART B, Maryland Public Behavioral Health System'), 'NOVITAS SOLUTIONS PART B');
  assert.equal(firstPayer(null), NO_PAYER);
  assert.equal(firstPayer('  '), NO_PAYER);
  const rows = foldValantByKey(
    [
      { key: 'Aetna, Medicaid', category: 'charge', cents: 20000, count: 2 },
      { key: 'Aetna', category: 'insurance_payment', cents: -12000, count: 1 },
      { key: 'Aetna', category: 'insurance_adjustment', cents: -3000, count: 1 },
      { key: 'Aetna', category: 'patient_payment', cents: -2500, count: 1 },
      { key: null, category: 'charge', cents: 5000, count: 1 },
      { key: null, category: 'fee', cents: 2500, count: 1 },
    ],
    firstPayer
  );
  assert.equal(rows[0].key, 'Aetna');
  assert.equal(rows[0].chargesCents, 20000);
  assert.equal(rows[0].chargeCount, 2);
  assert.equal(rows[0].insurancePaymentsCents, 12000);
  assert.equal(rows[0].adjustmentsCents, 3000);
  assert.equal(rows[0].patientPaymentsCents, 2500);
  assert.equal(rows[1].key, NO_PAYER);
  assert.equal(rows[1].feesCents, 2500);
});

// ─── Utilization / medications ───────────────────────────────────────────────

test('clinician productivity: counts, hours, hours to sign, no-show rate', () => {
  const start = new Date('2026-05-01T14:00:00Z');
  const rows = clinicianProductivity({
    statusGroups: [
      { clinicianId: 'u1', status: 'COMPLETED', count: 3 },
      { clinicianId: 'u1', status: 'NO_SHOW', count: 1 },
      { clinicianId: null, status: 'COMPLETED', count: 1 },
    ],
    visits: [
      { type: 'Therapy', startsAt: start, endsAt: new Date(start.getTime() + 3_600_000), clinicianId: 'u1', clientId: 'a' },
      { type: 'Therapy', startsAt: start, endsAt: new Date(start.getTime() + 1_800_000), clinicianId: 'u1', clientId: 'b' },
      { type: 'Therapy', startsAt: start, endsAt: new Date(start.getTime() + 20 * 3_600_000), clinicianId: 'u1', clientId: 'c' }, // bogus, 0 h
    ],
    signedNotes: [
      { clinicianId: 'u1', createdAt: start, signedAt: new Date(start.getTime() + 2 * 3_600_000) },
      { clinicianId: 'u1', createdAt: start, signedAt: new Date(start.getTime() + 4 * 3_600_000) },
    ],
    unsignedGroups: [{ clinicianId: 'u1', count: 2 }],
    names: new Map([['u1', 'Dr. One']]),
  });
  const u1 = rows.find((r) => r.clinicianId === 'u1');
  assert.ok(u1);
  assert.equal(u1?.name, 'Dr. One');
  assert.equal(u1?.completed, 3);
  assert.equal(u1?.hours, 1.5);
  assert.equal(u1?.notesSigned, 2);
  assert.equal(u1?.avgHoursToSign, 3);
  assert.equal(u1?.unsignedNotes, 2);
  assert.deepEqual(u1?.noShowRate, { numerator: 1, denominator: 4, pct: 25 });
  assert.equal(rows.find((r) => r.clinicianId === 'unassigned')?.name, 'No clinician on record');
});

test('medication classes by name, antipsychotic / lithium / clozapine client counts', () => {
  assert.equal(drugClassOf('Sertraline HCl 50 mg tablet').id, 'ssri');
  assert.equal(drugClassOf('Escitalopram oxalate').id, 'ssri');
  assert.equal(drugClassOf('Lithium carbonate ER').id, 'mood_stabilizer');
  assert.equal(drugClassOf('Seroquel XR').id, 'antipsychotic');
  assert.equal(drugClassOf('Lisinopril').id, 'other');
  const s = summarizeMedications([
    { clientId: 'a', medicationName: 'Sertraline 50 mg', drugName: null, genericName: 'sertraline', isAntipsychotic: false },
    { clientId: 'b', medicationName: 'Zoloft', drugName: 'Zoloft 100 mg', genericName: 'sertraline', isAntipsychotic: false },
    { clientId: 'a', medicationName: 'Clozapine 100 mg', drugName: null, genericName: null, isAntipsychotic: false },
    { clientId: 'c', medicationName: 'Lithium carbonate 300 mg', drugName: null, genericName: null, isAntipsychotic: false },
    { clientId: 'd', medicationName: 'Custom compound', drugName: null, genericName: null, isAntipsychotic: true },
  ]);
  assert.equal(s.activeMedications, 5);
  assert.equal(s.clientsOnMedications, 4);
  assert.equal(s.clientsOnAntipsychotics, 2); // a (clozapine) + d (flag)
  assert.equal(s.clientsOnLithium, 1);
  assert.equal(s.clientsOnClozapine, 1);
  assert.deepEqual(s.topDrugs[0], { drug: 'Sertraline', drugClass: 'SSRIs', medications: 2, clients: 2 });
  assert.equal(s.byClass.find((c) => c.id === 'ssri')?.clients, 2);
  assert.deepEqual(summarizeMedications([]).byClass, []);
});

// ─── CSV ─────────────────────────────────────────────────────────────────────

test('CSV export: header block, overview and tab tables, "no data" for empty rates', () => {
  const report: OutcomesReport = {
    generatedAt: '2026-10-17T12:00:00.000Z',
    filters: { from: '2026-07-19', to: '2026-10-16', locationId: null, clinicianId: null, tab: 'clinical', timeZone: 'America/New_York' },
    scope: 'organization',
    hiddenSensitiveClients: 2,
    facilityTerm: null,
    options: { locations: [], clinicians: [] },
    overview: {
      activeClients: 10, newClients: 1, importedClients: 0,
      appointments: summarizeAppointmentStatuses([{ status: 'COMPLETED', count: 4 }]),
      notes: { inPeriod: 4, signed: 3, unsigned: 1, unsignedOver24h: 1, unsignedOver48h: 0 },
      claims: summarizeClaims([]),
      valant: { rows: 0, chargeCount: 0, chargesCents: 0, feesCents: 0, insurancePaymentsCents: 0, patientPaymentsCents: 0, adjustmentsCents: 0, otherCents: 0, undatedRows: 0 },
    },
  };
  const phq = computeInstrumentOutcomes([pt('a', 15, 0), pt('a', 5, 30)], PHQ9, range);
  const gad = computeInstrumentOutcomes([], GAD7, range);
  report.clinical = {
    phq9: outcomeSummary(phq), gad7: outcomeSummary(gad), cssrs: summarizeCssrs([]),
    clients: [{ clientId: 'a', name: 'Doe, "Jane"', mrn: 'M1', phq9: phq.clients[0], gad7: null }],
    clientsTruncated: false,
  };
  const csv = buildReportCsv(report, 'Divine Counseling');
  assert.match(csv, /^Altrixs Outcomes & Reports,Divine Counseling/);
  assert.match(csv, /Sensitive clients excluded,2/);
  assert.match(csv, /No-show rate,0%/);
  assert.match(csv, /PHQ-9 summary/);
  assert.match(csv, /Response rate \(>= 50% reduction\),100%/);
  assert.match(csv, /GAD-7 summary[\s\S]*Response rate \(>= 50% reduction\),no data/);
  assert.match(csv, /"Doe, ""Jane""",M1,15,5,-10,Response/);
});
