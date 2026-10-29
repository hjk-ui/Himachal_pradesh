import { readFileSync } from 'node:fs';
/**
 * Enriched pre-visit brief: diagnoses, medications, visits by type (incl. imported Valant
 * history), labs (results + trend, pending, monitoring rules, document fallback), previous
 * progress notes (cited extracts, psychotherapy / Part 2 exclusion, Valant fallback), care team,
 * open items, changes since the last visit, wording fixes and the chart history empty state.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildPreVisitFacts, factLines, factLinks, modelFacts, type PreVisitInputs } from '../src/lib/ai/previsit/facts';
import { NO_THERAPY_TEXT, noteKindOf, sessionFrequencyDetail, visitKindOf } from '../src/lib/ai/previsit/enrich';
import { ruleBasedBullets } from '../src/lib/ai/previsit/rules';
import { checkBullet, groundedBullets, groundingSets } from '../src/lib/ai/previsit/validate';
import { previsitUserPrompt, PREVISIT_SYSTEM_PROMPT } from '../src/lib/ai/previsit/prompt';
import { audienceFor } from '../src/lib/ai/previsit/service';
import { cadenceFromFacts, resolveTherapyRecommendation } from '../src/lib/clinical/sessionFrequency';
import { CHART_HISTORY_NOT_GENERATED_TEXT, CHART_HISTORY_PREP_TEXT, chartHistoryEmptyState, isNightlyPrepEnabled } from '../src/lib/ai/chartDigest/emptyState';

const ROOT = path.join(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const TZ = 'America/New_York';
const NOW = new Date('2026-10-25T14:00:00Z');
const d = (iso: string) => new Date(`${iso}T15:00:00Z`);
const NAMES = ['Jordan Rivers', 'Jordan', 'Rivers'];

const OWNER_SF = { bucket: 'no_sessions' as never, status: 'no_sessions', recommendation: 'Weekly', statusDetail: 'No attended session on record and nothing scheduled' };

function base(over: Partial<PreVisitInputs> = {}): PreVisitInputs {
  return {
    client: { riskLevel: 'LOW', names: NAMES },
    appointments: [{ id: 'a1', startsAt: d('2026-10-13'), type: 'Medication Management', status: 'COMPLETED', clinicianName: 'Ada Stone', clinicianRole: 'PSYCHIATRIST' }],
    medications: [],
    problems: [],
    riskAlerts: [],
    crisisEpisodes: [],
    assessments: [],
    measurements: [],
    treatmentPlan: null,
    sessionFrequency: OWNER_SF,
    draftNoteCount: 0,
    pendingConsentCount: 0,
    sdohReferrals: [],
    standingLabs: [],
    labResultsAwaitingReview: 0,
    recentNotes: [],
    ...over,
  };
}

const lab = (id: string, testName: string, testKey: string | null, value: string, flag: string, at: string, unit = 'mmol/L', refRange = '0.6-1.2') => ({
  id,
  testName,
  testKey,
  value,
  unit,
  refRange,
  flag,
  collectedAt: d(at),
  createdAt: d(at),
});

function rich(over: Partial<PreVisitInputs> = {}): PreVisitInputs {
  return base({
    appointments: [
      { id: 'a0', startsAt: d('2026-08-04'), type: 'Appointment', status: 'COMPLETED', notes: 'Valant code: 90837', source: 'valant_history' },
      { id: 'a1', startsAt: d('2026-10-13'), type: 'Medication Management', status: 'COMPLETED', clinicianName: 'Ada Stone', clinicianRole: 'PSYCHIATRIST' },
      { id: 'a2', startsAt: d('2026-10-20'), type: 'Individual Therapy', status: 'NO_SHOW' },
    ],
    upcomingAppointments: [{ id: 'u1', startsAt: d('2026-10-28'), type: 'Medication Management', status: 'SCHEDULED', clinicianName: 'Ada Stone', clinicianRole: 'PSYCHIATRIST' }],
    medications: [
      { id: 'm1', medicationName: 'Lithium carbonate', dosage: '300 mg', route: 'oral', frequency: 'twice daily', startDate: d('2026-09-01'), createdAt: d('2026-09-01'), active: true, status: 'active', rcopiaMedId: 'RX9' },
      { id: 'm2', medicationName: 'Sertraline', dosage: '100 mg', frequency: 'daily', startDate: d('2025-01-10'), createdAt: d('2025-01-10'), active: true, status: 'active' },
      { id: 'm3', medicationName: 'Trazodone', dosage: '50 mg', startDate: d('2026-03-01'), createdAt: d('2026-03-01'), stopDate: d('2026-10-15'), active: false, status: 'stopped' },
    ],
    diagnoses: [
      { id: 'dx2', code: 'F41.1', description: 'Generalized anxiety disorder', rank: 2, isPrimary: false, status: 'ACTIVE', createdAt: d('2026-10-16') },
      { id: 'dx1', code: 'F31.81', description: 'Bipolar II disorder', dsmName: 'Bipolar II disorder', rank: 1, isPrimary: true, status: 'ACTIVE', createdAt: d('2025-02-01') },
      { id: 'dx3', code: 'F10.20', description: 'Alcohol use disorder, moderate', rank: 3, isPrimary: false, status: 'ACTIVE', createdAt: d('2025-02-01') },
      { id: 'dx4', code: 'F32.9', description: 'Depression, unspecified', rank: 4, isPrimary: false, status: 'RESOLVED', createdAt: d('2024-02-01') },
    ],
    assessments: [
      { id: 's1', instrumentId: 'phq-9', instrumentName: 'PHQ-9', totalScore: 12, severity: 'Moderate', safetyFlagged: false, createdAt: d('2026-10-20') },
      { id: 's2', instrumentId: 'phq-9', instrumentName: 'PHQ-9', totalScore: 15, severity: 'Mod-severe', safetyFlagged: false, createdAt: d('2026-09-20') },
      { id: 's3', instrumentId: 'phq-9', instrumentName: 'PHQ-9', totalScore: 18, severity: 'Severe', safetyFlagged: false, createdAt: d('2026-08-20') },
      { id: 's4', instrumentId: 'phq-9', instrumentName: 'PHQ-9', totalScore: 21, severity: 'Severe', safetyFlagged: false, createdAt: d('2026-07-20') },
      { id: 's5', instrumentId: 'pcl-5', instrumentName: 'PCL-5', totalScore: 38, severity: null, safetyFlagged: false, createdAt: d('2026-10-20') },
    ],
    labOrders: [
      {
        id: 'o1',
        status: 'resulted',
        orderedAt: d('2026-10-01'),
        collectedAt: d('2026-10-02'),
        resultedAt: d('2026-10-03'),
        panels: ['Lithium level'],
        results: [lab('r1', 'Lithium', 'lithium', '1.3', 'H', '2026-10-02')],
      },
      { id: 'o2', status: 'resulted', orderedAt: d('2026-07-01'), collectedAt: null, resultedAt: d('2026-07-03'), panels: ['Lithium level'], results: [lab('r2', 'Lithium', 'lithium', '0.9', 'N', '2026-07-02')] },
      { id: 'o3', status: 'resulted', orderedAt: d('2026-04-01'), collectedAt: null, resultedAt: d('2026-04-03'), panels: ['Lithium level'], results: [lab('r3', 'Lithium', 'lithium', '0.7', 'N', '2026-04-02')] },
      { id: 'o0', status: 'resulted', orderedAt: d('2025-12-01'), collectedAt: null, resultedAt: d('2025-12-03'), panels: ['Lithium level'], results: [lab('r0', 'Lithium', 'lithium', '0.5', 'L', '2025-12-02')] },
      { id: 'o4', status: 'ordered', orderedAt: d('2026-10-21'), collectedAt: null, resultedAt: null, panels: ['TSH', 'BMP'], results: [] },
      { id: 'o5', status: 'resulted', orderedAt: d('2026-05-01'), collectedAt: null, resultedAt: d('2026-05-02'), panels: ['Vitamin D'], results: [lab('r5', 'Vitamin D, 25-OH', 'vitd', '31', 'N', '2026-05-02', 'ng/mL', '30-100')] },
    ],
    recentNotes: [
      {
        id: 'n-mm',
        noteType: 'Med Mgmt',
        cptCode: '99214',
        authorRole: 'PSYCHIATRIST',
        body: 'Interval History\nJordan reports better sleep.\nCurrent Medications\nLithium 300 mg BID; sertraline 100 mg.\nMental Status\nCalm.\nAssessment\nMood stable on lithium; level high 2026-10-02.\nPlan\nRecheck lithium level; continue sertraline. Follow up in 4 weeks.\n',
        dateOfService: d('2026-10-13'),
        createdAt: d('2026-10-13'),
        part2: false,
      },
      {
        id: 'n-pt',
        noteType: 'Psychotherapy Note',
        body: 'Plan:\nPROCESS CONTENT SHOULD NEVER APPEAR',
        dateOfService: d('2026-10-12'),
        createdAt: d('2026-10-12'),
        part2: false,
      },
      { id: 'n-p2', noteType: 'SUD', body: 'Plan:\nRelapse prevention group', dateOfService: d('2026-10-11'), createdAt: d('2026-10-11'), part2: true },
      {
        id: 'n-t1',
        noteType: 'SOAP',
        cptCode: '90837',
        authorRole: 'THERAPIST',
        body: 'Subjective:\nJordan Rivers discussed work stress.\nObjective:\nEngaged.\nAssessment:\nProgress toward goal 1: fewer panic episodes.\nPlan:\nHomework: thought record daily. Next session in 1 week.\n',
        dateOfService: d('2026-08-04'),
        createdAt: d('2026-08-04'),
        part2: false,
      },
      { id: 'n-t2', noteType: 'SOAP', cptCode: '90834', body: 'Plan:\nContinue CBT.', dateOfService: d('2026-07-28'), createdAt: d('2026-07-28'), part2: false },
      { id: 'n-t3', noteType: 'SOAP', cptCode: '90834', body: 'Plan:\nBreathing practice.', dateOfService: d('2026-07-21'), createdAt: d('2026-07-21'), part2: false },
      { id: 'n-t4', noteType: 'SOAP', cptCode: '90834', body: 'Plan:\nOLDEST NOTE.', dateOfService: d('2026-07-14'), createdAt: d('2026-07-14'), part2: false },
    ],
    noteDocuments: [
      { id: 'doc3', date: d('2026-06-01'), label: 'Progress Note', href: '/api/files/intake-docs/k3' },
      { id: 'doc2', date: d('2026-05-01'), label: 'Progress Note', href: null },
      { id: 'doc1', date: d('2026-04-01'), label: 'Progress Note', href: '/api/files/intake-docs/k1' },
      { id: 'doc0', date: d('2026-03-01'), label: 'Progress Note', href: '/api/files/intake-docs/k0' },
    ],
    filedDocuments: [{ id: 'f1', label: 'Hospital Records', filedAt: d('2026-10-18') }],
    careTeam: { primary: { name: 'Sam Lee', label: 'Therapist' }, members: [{ name: 'Ada Stone', label: 'Prescriber' }] },
    overdueNoteCount: 1,
    measureAssignments: [{ instrumentId: 'gad-7', schedule: 'interval', everyDays: 30, startDate: d('2026-08-01'), endDate: null, status: 'active' }],
    referrals: [{ kind: 'internal_bh', status: 'sent', sentAt: d('2026-10-10') }],
    drFirstPendingCount: 2,
    ...over,
  });
}

const prescriber = (i = rich()) => buildPreVisitFacts(i, { now: NOW, timeZone: TZ, audience: 'prescriber' });
const therapist = (i = rich()) => buildPreVisitFacts(i, { now: NOW, timeZone: TZ, audience: 'therapist' });

// ─── 1. Wording: the owner's "no attended sessions" brief ────────────────────

test('wording: session frequency says it counts therapy and shows both visit types (owner scenario)', () => {
  const f = buildPreVisitFacts(base(), { now: NOW, timeZone: TZ, audience: 'prescriber' });
  assert.equal(f.sessionFrequency?.counts, 'therapy sessions');
  assert.match(f.sessionFrequency!.detail, /^No therapy sessions on record \(medication management visits are tracked separately\)/);
  assert.equal(f.sessionFrequency?.status, 'no therapy sessions', 'status is words, not "no_sessions"');
  assert.equal(f.visits.last.medManagement?.date, '2026-10-13');
  assert.equal(f.visits.last.therapy, null);
  const bullets = ruleBasedBullets(f);
  const all = bullets.join(' ');
  assert.match(all, /Last therapy session: none on record \/ Last med management: 2026-10-13/);
  assert.doesNotMatch(all, /No attended session|no attended sessions/i);
  assert.match(all, /No active treatment plan on file/);
  assert.doesNotMatch(all, /not documented/i);
  const lines = factLines(f);
  assert.ok(lines.some((l) => l.section === 'Visits' && /Last therapy session: none on record \/ Last med management: 2026-10-13/.test(l.text)));
  assert.ok(!lines.some((l) => /\(no_sessions\)/.test(l.text)));
  assert.match(PREVISIT_SYSTEM_PROMPT, /counts THERAPY sessions only/);
  assert.match(PREVISIT_SYSTEM_PROMPT, /No active treatment plan on file/);
});

test('wording: the cadence itself names the service type; detail rewrite keeps the next scheduled date', () => {
  const rec = resolveTherapyRecommendation([], [], NOW);
  const c = cadenceFromFacts(rec, { lastAttended: null, sessionsLast8Weeks: 0, next: null }, NOW);
  assert.equal(c.statusDetail, 'No attended therapy session on record and nothing scheduled');
  assert.equal(sessionFrequencyDetail('No attended session on record yet; next scheduled 2026-10-30', null), `${NO_THERAPY_TEXT}; next therapy session scheduled 2026-10-30`);
  assert.equal(sessionFrequencyDetail('Last session 2026-10-20; next due 2026-10-27', { date: '2026-10-20', type: 'x', imported: false }), 'Last session 2026-10-20; next due 2026-10-27');
});

test('visits: therapy vs med management vs primary care, imported Valant history, next appointment', () => {
  assert.equal(visitKindOf({ type: 'Appointment', notes: 'Valant code: 90837' }), 'therapy');
  assert.equal(visitKindOf({ type: 'Appointment', notes: 'Valant code: 99214' }), 'med_management');
  assert.equal(visitKindOf({ type: 'Telehealth', clinicianRole: 'PHYSICIAN' }), 'primary_care');
  assert.equal(visitKindOf({ type: 'Annual Physical' }), 'primary_care');
  const f = prescriber(
    rich({
      medicalVisits: [{ id: 'mv1', visitDate: d('2026-09-15'), visitType: 'Follow-up', signedAt: d('2026-09-15'), assessment: 'HTN controlled', plan: 'Recheck BP 3 months' }],
    })
  );
  assert.deepEqual(f.visits.last.therapy, { date: '2026-08-04', type: 'Appointment', imported: true }, 'imported Valant visit counts as therapy');
  assert.equal(f.visits.last.medManagement?.date, '2026-10-13');
  assert.equal(f.visits.last.primaryCare?.date, '2026-09-15');
  assert.equal(f.visits.next?.date, '2026-10-28');
  assert.equal(f.visits.next?.kind, 'med_management');
  assert.equal(f.visits.nextWithin7Days, true);
  const b = ruleBasedBullets(f).join(' ');
  assert.match(b, /Last therapy session: 2026-08-04 \(Appointment, Valant\) \/ Last med management: 2026-10-13/);
  assert.match(b, /Last primary care: 2026-09-15/);
  assert.match(b, /next: 2026-10-28 Medication Management/);
});

// ─── 2. Diagnoses, medications, care team, open items, changes ──────────────

test('facts: diagnosis list (primary first, active only), current meds with sig, 90-day changes', () => {
  const f = prescriber();
  assert.deepEqual(f.diagnoses.map((x) => [x.code, x.primary]), [['F31.81', true], ['F41.1', false], ['F10.20', false]]);
  assert.equal(f.currentMedications.length, 2);
  const li = f.currentMedications.find((m) => m.name.startsWith('Lithium'))!;
  assert.deepEqual([li.dose, li.sig, li.fromDrFirst], ['300 mg', 'oral twice daily', true]);
  assert.equal(f.medChangeWindowDays, 90);
  assert.deepEqual(f.recentMedChanges.map((m) => [m.change, m.name, m.date]), [['stopped', 'Trazodone', '2026-10-15'], ['started', 'Lithium carbonate', '2026-09-01']]);
  // Primary care (no BH chart notes): no SUD codes on the list
  const pc = buildPreVisitFacts(rich(), { now: NOW, timeZone: TZ, audience: 'primary_care', bhChartNotes: false });
  assert.ok(!pc.diagnoses.some((x) => /^F1\d/.test(x.code ?? '')));
});

test('facts: changes since the last completed visit (new diagnosis, scores, documents, missed visit)', () => {
  const f = prescriber();
  assert.equal(f.since, '2026-10-13');
  assert.deepEqual(f.changes.newDiagnoses.map((x) => [x.code, x.date]), [['F41.1', '2026-10-16']]);
  assert.deepEqual(f.changes.newScores.map((s) => [s.instrument, s.score, s.date]).sort(), [['PCL-5', 38, '2026-10-20'], ['PHQ-9', 12, '2026-10-20']]);
  assert.deepEqual(f.changes.newDocuments, [{ label: 'Hospital Records', date: '2026-10-18' }]);
  assert.deepEqual(f.changes.missedVisits.map((v) => v.date), ['2026-10-20']);
  const b = ruleBasedBullets(f).join(' ');
  assert.match(b, /Since the last visit on 2026-10-13: .*new diagnosis F41\.1/);
  assert.match(b, /new documents Hospital Records 2026-10-18/);
});

test('facts: scores keep the last 3 values with dates and trend (PHQ-9, PCL-5)', () => {
  const f = therapist();
  const phq = f.scores.find((s) => s.instrument === 'PHQ-9')!;
  assert.deepEqual(phq.history, [{ score: 18, date: '2026-08-20' }, { score: 15, date: '2026-09-20' }, { score: 12, date: '2026-10-20' }]);
  assert.equal(phq.trend, 'down');
  assert.ok(f.scores.some((s) => s.instrument === 'PCL-5'));
  assert.match(ruleBasedBullets(f).join(' '), /PHQ-9 12 \(Moderate\) on 2026-10-20, down 3 from 15 on 2026-09-20 \(earlier 18 on 2026-08-20\)/);
});

test('facts: care team and open items (overdue notes, overdue measures, referrals, DrFirst)', () => {
  const f = prescriber();
  assert.deepEqual(f.careTeam?.primary, { role: 'Therapist', name: 'Sam Lee' });
  assert.equal(f.openItems.overdueNotes, 1);
  assert.deepEqual(f.openItems.overdueMeasures.map((m) => [m.instrument, m.lastDate]), [['GAD-7', null]]);
  assert.deepEqual(f.openItems.referrals, [{ kind: 'internal bh', status: 'sent', since: '2026-10-10' }]);
  assert.equal(f.openItems.drFirstPending, 2);
  assert.equal(therapist().openItems.drFirstPending, 0, 'DrFirst items are for prescribers');
});

// ─── 3. Labs ─────────────────────────────────────────────────────────────────

test('labs: latest result + last 3 values with flags, trend, psychiatry-relevant first for prescribers', () => {
  const f = prescriber();
  const li = f.labs!.results![0];
  assert.equal(li.test, 'Lithium');
  assert.deepEqual(li.latest, { value: '1.3', unit: 'mmol/L', flag: 'H', refRange: '0.6-1.2', date: '2026-10-02' });
  assert.deepEqual(li.history.map((h) => [h.value, h.flag, h.date]), [['1.3', 'H', '2026-10-02'], ['0.9', null, '2026-07-02'], ['0.7', null, '2026-04-02']]);
  assert.equal(li.trend, 'up');
  assert.ok(!f.labs!.results!.some((r) => r.test.startsWith('Vitamin D')), 'normal non-psychiatric results are left out for prescribers');
  const pc = buildPreVisitFacts(rich(), { now: NOW, timeZone: TZ, audience: 'primary_care', bhChartNotes: false });
  assert.ok(pc.labs!.results!.some((r) => r.test.startsWith('Vitamin D')), 'primary care gets the full panel set');
  assert.equal(therapist().labs, null, 'therapists: no labs section');
});

test('labs: pending orders and overdue monitoring from the order-set rules only (never invented)', () => {
  const f = prescriber();
  assert.deepEqual(f.labs!.pending, [{ tests: 'TSH, BMP', orderedDate: '2026-10-21', status: 'ordered' }]);
  const mon = f.labs!.monitoring!;
  // Lithium set: level every 3 months (last 2026-10-02: not due), BMP + TSH every 6 months: no result on file
  assert.ok(!mon.some((m) => m.test === 'lithium'));
  assert.deepEqual(mon.filter((m) => m.medication === 'Lithium').map((m) => [m.test, m.state]).sort(), [['bmp', 'none_on_file'], ['tsh', 'none_on_file']]);
  const old = prescriber(rich({ labOrders: [{ id: 'o3', status: 'resulted', orderedAt: d('2026-04-01'), collectedAt: null, resultedAt: d('2026-04-03'), panels: ['Lithium level'], results: [lab('r3', 'Lithium', 'lithium', '0.7', 'N', '2026-04-02')] }] }));
  assert.deepEqual(old.labs!.monitoring!.find((m) => m.test === 'lithium'), { test: 'lithium', medication: 'Lithium', rule: 'Lithium level every 3 months', lastDate: '2026-04-02', state: 'overdue' });
  // No lithium / clozapine / etc. on the med list: no monitoring rows
  const none = prescriber(rich({ medications: [] }));
  assert.deepEqual(none.labs!.monitoring, []);
  const lines = factLines(f);
  assert.ok(lines.some((l) => l.section === 'Lab result' && l.source === 'Lab results (2026-10-02)'));
  assert.ok(lines.some((l) => l.section === 'Lab monitoring' && /^Monitoring rule: /.test(l.source ?? '')));
});

test('labs: no structured results → cited lab facts from chart documents, labelled with their source', () => {
  const f = prescriber(rich({ labOrders: [], documentLabs: [{ text: 'A1c 6.1% (Jordan)', date: '2025-11-02', source: 'Lab Report 2025-11-02' }] }));
  assert.deepEqual(f.labs!.fromDocuments, [{ text: 'A1c 6.1% (the client)', date: '2025-11-02', source: 'Lab Report 2025-11-02' }]);
  assert.ok(factLines(f).some((l) => l.section === 'Lab (document)' && l.source === 'Chart history: Lab Report 2025-11-02'));
  assert.match(ruleBasedBullets(f).join(' '), /Labs from chart documents: A1c 6\.1%/);
  // With structured results the document facts are not used
  assert.deepEqual(prescriber(rich({ documentLabs: [{ text: 'A1c 6.1%', date: null, source: 'x' }] })).labs!.fromDocuments, []);
  const empty = prescriber(rich({ labOrders: [] }));
  assert.match(ruleBasedBullets(empty).join(' '), /No structured lab results on file/);
});

// ─── 4. Previous progress notes ──────────────────────────────────────────────

test('notes: psychotherapy notes and Part 2 notes are never included', () => {
  const f = prescriber();
  const json = JSON.stringify(f.notes);
  assert.doesNotMatch(json, /PROCESS CONTENT|Relapse prevention/);
  assert.ok(![...f.notes.therapy, ...f.notes.medManagement].some((n) => n.ref === 'n-pt' || n.ref === 'n-p2'));
});

test('notes: last 3 per type, med management vs therapy, audience-first order', () => {
  const f = prescriber();
  assert.deepEqual(f.notes.order.slice(0, 2), ['med_management', 'therapy']);
  assert.deepEqual(therapist().notes.order.slice(0, 2), ['therapy', 'med_management']);
  assert.deepEqual(f.notes.medManagement.map((n) => n.ref), ['n-mm']);
  assert.deepEqual(f.notes.therapy.map((n) => n.ref), ['n-t1', 'n-t2', 'n-t3'], 'newest 3 therapy notes; the oldest is left out');
  assert.equal(noteKindOf({ noteType: 'SOAP', cptCode: '99214' }), 'med_management');
  assert.equal(noteKindOf({ noteType: 'Psychiatric Evaluation', cptCode: null }), 'med_management');
  assert.equal(noteKindOf({ noteType: 'DAP', cptCode: null }), 'therapy');
  assert.equal(f.notes.medManagement[0].authorRole, 'psychiatrist');
});

test('notes: section extracts are copied from the note headings, clipped, redacted and cited', () => {
  const f = prescriber();
  const mm = f.notes.medManagement[0];
  assert.deepEqual(
    mm.sections.map((s) => s.label),
    ['Medications', 'Assessment / progress', 'Plan / follow-up']
  );
  assert.equal(mm.sections.find((s) => s.label === 'Plan / follow-up')!.text, 'Recheck lithium level; continue sertraline. Follow up in 4 weeks.');
  const t1 = f.notes.therapy[0];
  assert.ok(!t1.sections.some((s) => /work stress/.test(s.text)), 'Subjective is not an extracted section');
  assert.ok(t1.sections.every((s) => !/Jordan|Rivers/.test(s.text)));
  const lines = factLines(f).filter((l) => l.section === 'Med management note');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].source, 'Signed note 2026-10-13');
  assert.match(ruleBasedBullets(f).join(' '), /Last med management note 2026-10-13 \(Med Mgmt, psychiatrist\): Plan \/ follow-up: Recheck lithium level/);
  const links = factLinks(f, 'c1');
  assert.ok(links.some((l) => /openNote=n-mm/.test(l.href)));
});

test('notes: imported Valant notes listed (last 3, links) only while no chart history digest exists', () => {
  const f = therapist();
  assert.deepEqual(f.notes.documents.map((x) => [x.date, x.href]), [['2026-06-01', '/api/files/intake-docs/k3'], ['2026-05-01', null], ['2026-04-01', '/api/files/intake-docs/k1']]);
  assert.equal(f.notes.documentsSummarized, false);
  assert.ok(factLines(f).some((l) => l.section === 'Imported note' && /not summarized yet/.test(l.text)));
  assert.ok(factLinks(f, 'c1').some((l) => l.href === '/api/files/intake-docs/k3'));
  const digest = { digest: { diagnoses: [], hospitalizations: [], riskHistory: [], substanceUse: [], trauma: [], socialFunctional: [], therapy: [], openItems: [], medical: [], medicationTrials: [], lastRiskAssessment: null, safetyPlan: null, sources: {}, hasPart2: false } as never, generatedAt: d('2026-10-20'), stale: false };
  const withDigest = therapist(rich({ chartDigest: digest }));
  assert.deepEqual(withDigest.notes.documents, []);
  assert.equal(withDigest.notes.documentsSummarized, true);
  // Primary care (no BH chart notes): no BH notes, no imported BH notes
  const pc = buildPreVisitFacts(rich(), { now: NOW, timeZone: TZ, audience: 'primary_care', bhChartNotes: false });
  assert.deepEqual([pc.notes.therapy.length, pc.notes.medManagement.length, pc.notes.documents.length], [0, 0, 0]);
});

// ─── 5. Name-free model facts + grounding ────────────────────────────────────

test('model facts: no client or staff names, no note ids, no links', () => {
  const f = prescriber();
  const json = JSON.stringify(modelFacts(f));
  assert.doesNotMatch(json, /Jordan|Rivers|Ada Stone|Sam Lee/);
  assert.doesNotMatch(json, /n-mm|n-t1|intake-docs|RX9/);
  assert.match(json, /"role":"Therapist"/);
  assert.doesNotMatch(previsitUserPrompt(f), /Jordan|Ada Stone|work stress/);
  // The clinician view keeps staff names
  assert.ok(factLines(f).some((l) => /Ada Stone/.test(l.text)));
});

test('validation: grounded new facts kept; invented labs / diagnoses / dates dropped', () => {
  const f = prescriber();
  const { kept, dropped } = groundedBullets(
    [
      'Lithium 1.3 mmol/L [H] on 2026-10-02, up from 0.9 on 2026-07-02.',
      'Primary diagnosis F31.81 Bipolar II disorder.',
      'Lithium 1.8 on 2026-10-02.', // invented value
      'TSH 4.2 on 2026-10-21.', // invented value
      'New diagnosis F20.9 added.', // invented code
      'Clozapine started 2026-10-22.', // invented date
    ],
    f,
    NAMES
  );
  assert.equal(kept.length, 2);
  assert.deepEqual(dropped, ['ungrounded_number', 'ungrounded_number', 'ungrounded_code', 'ungrounded_date']);
});

test('validation: the enriched rule-based brief is itself fully grounded for every audience', () => {
  for (const [audience, bh] of [['therapist', true], ['prescriber', true], ['primary_care', false]] as const) {
    const f = buildPreVisitFacts(rich(), { now: NOW, timeZone: TZ, audience, bhChartNotes: bh });
    const sets = groundingSets(f);
    const bullets = ruleBasedBullets(f);
    assert.ok(bullets.length >= 5 && bullets.length <= 9, `${audience}: ${bullets.length}`);
    for (const b of bullets) assert.equal(checkBullet(b, sets, NAMES), null, `${audience} rule bullet failed grounding: ${b}`);
  }
});

test('audience: prescribers lead with meds + labs, therapists with changes + scores; primary-care roles get their own view', () => {
  const p = ruleBasedBullets(prescriber());
  assert.match(p[2], /^Current medications:/);
  assert.match(p[3], /^Labs:/);
  const t = ruleBasedBullets(therapist());
  assert.match(t[2], /^Since the last visit/);
  assert.equal(audienceFor('PHYSICIAN'), 'primary_care');
  assert.equal(audienceFor('MEDICAL_NP'), 'primary_care');
  assert.equal(audienceFor('PSYCHIATRIST'), 'prescriber');
  assert.equal(audienceFor('THERAPIST'), 'therapist');
});

// ─── 6. Chart history empty state ────────────────────────────────────────────

test('empty state: visit within 7 days + nightly job → "prepared before the next visit"; else "Not generated yet"', () => {
  assert.deepEqual(chartHistoryEmptyState({ upcomingVisitWithin7Days: true, nightlyPrepEnabled: true, canGenerate: false }), { text: CHART_HISTORY_PREP_TEXT, showGenerate: false });
  assert.deepEqual(chartHistoryEmptyState({ upcomingVisitWithin7Days: true, nightlyPrepEnabled: false, canGenerate: true }), { text: CHART_HISTORY_NOT_GENERATED_TEXT, showGenerate: true });
  assert.deepEqual(chartHistoryEmptyState({ upcomingVisitWithin7Days: false, nightlyPrepEnabled: true, canGenerate: true }), { text: CHART_HISTORY_NOT_GENERATED_TEXT, showGenerate: true });
  assert.equal(CHART_HISTORY_PREP_TEXT, 'Chart history will be prepared before the next visit.');
  assert.equal(isNightlyPrepEnabled({ CHART_DIGEST_NIGHTLY_PREP: 'on' }), true);
  assert.equal(isNightlyPrepEnabled({}), false);

  const on = therapist(rich({ nightlyPrepEnabled: true }));
  assert.deepEqual(on.chartHistoryStatus, { state: 'not_generated', message: CHART_HISTORY_PREP_TEXT });
  const off = therapist(rich({ nightlyPrepEnabled: false }));
  assert.equal(off.chartHistoryStatus?.message, CHART_HISTORY_NOT_GENERATED_TEXT);
  const farVisit = therapist(rich({ nightlyPrepEnabled: true, upcomingAppointments: [{ id: 'u9', startsAt: d('2026-11-20'), type: 'Individual Therapy', status: 'SCHEDULED' }] }));
  assert.equal(farVisit.chartHistoryStatus?.message, CHART_HISTORY_NOT_GENERATED_TEXT);
  assert.ok(factLines(on).some((l) => l.section === 'Chart history' && l.text === CHART_HISTORY_PREP_TEXT));
  assert.doesNotMatch(factLines(on).map((l) => l.text).join(' '), /No chart history yet/);
});

test('wiring: loader batches the new reads; route and card use the empty state; UI shows sources and note links', () => {
  const ps = read('src/lib/ai/previsit/prismaSource.ts');
  for (const m of ['clientDiagnosis.findMany', 'medicalVisit.findMany', 'labOrder.findMany', 'documentIntake.findMany', 'measureAssignment.findMany', 'medicalReferral.findMany', 'rcopiaRxchangeRequest.count']) assert.ok(ps.includes(m), m);
  assert.doesNotMatch(ps, /progressNotePsychotherapyNote/, 'psychotherapy notes are never read');
  assert.match(ps, /isPart2Classification\(sensitive\?\.noteClassification\) \|\| Boolean\(part2Note\)/);
  const route = read('src/app/api/clients/[id]/chart-digest/route.ts');
  assert.match(route, /emptyStateInputs\(/);
  assert.match(route, /isNightlyPrepEnabled\(\)/);
  const card = read('src/components/ai/ChartHistoryCard.tsx');
  assert.match(card, /chartHistoryEmptyState\(/);
  assert.doesNotMatch(card, /No chart history yet/);
  const ui = read('src/components/ai/PreVisitBrief.tsx');
  assert.match(ui, /f\.source/);
  assert.match(ui, /Notes cited:/);
  assert.doesNotMatch(ui, /[\u{1F300}-\u{1FAFF}]/u, 'no emoji');
});

test('lab monitoring uses the STRICTEST interval in an order set (safety reminder, e.g. clozapine ANC weekly early on)', () => {
  const src = readFileSync(new URL('../src/lib/ai/previsit/enrich.ts', import.meta.url), 'utf8');
  assert.match(src, /SHORTEST interval the set lists/);
  assert.match(src, /addInterval\(new Date\(0\), p\.unit, p\.count\)\.getTime\(\) - addInterval\(new Date\(0\), q\.unit, q\.count\)\.getTime\(\)/);
});
