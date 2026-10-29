import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  CHART_DX_LABEL,
  addSuggestedGoals,
  chartDiagnosesForPlan,
  importedPlanWorklist,
  isTreatmentPlanDocument,
  planDateView,
  rewriteDiagnoses,
  rewriteHref,
  splitDiagnosisText,
  suggestPlanGoalsFromText,
} from '../src/lib/ehr/importedPlans';
import {
  VALANT_PLAN_TITLE,
  buildPlanSource,
  parsePlanSource,
  parseValantTreatmentPlanRow,
  reimportStatus,
  type ImportedPlanSource,
  type ValantTreatmentPlan,
} from '../src/lib/migration/valantTreatmentPlans';
import {
  DEFAULT_THERAPY_WORKFLOW_SETTINGS,
  planActivity,
  treatmentPlanGate,
  type PlanSignatureState,
} from '../src/lib/ehr/therapy/rules';
import { emptyTpGoal } from '../src/lib/ehr/therapy/widgets';

const TODAY = '2026-10-18';
const IMPORTED_AT = new Date('2026-10-17T15:00:00Z');

// The owner's case: Valant Last Update Jan 20, 2025, Next Review 4/14/2025, imported Oct 17, 2026
const gridRow = (over: Record<string, string> = {}): Record<string, string> => ({
  'Patient ID': 'ABCDEF',
  'First Name': 'Test',
  'Last Name': 'Patient',
  'Treatment Plan Type': 'Valant Treatment Plan',
  Status: 'Active',
  'Last Update': '01/20/2025, 10:15 AM',
  'Next Review': '4/14/2025',
  Owner: 'Pat Clinician, LCPC-S',
  Supervisor: '',
  'Other Providers': '',
  'Active/Inactive Patient': 'Active',
  ...over,
});

function plan(over: Record<string, string> = {}): ValantTreatmentPlan {
  const r = parseValantTreatmentPlanRow(gridRow(over));
  assert.equal(r.kind, 'plan');
  return (r as { kind: 'plan'; plan: ValantTreatmentPlan }).plan;
}
const source = (over: Record<string, string> = {}): ImportedPlanSource => buildPlanSource(plan(over), IMPORTED_AT);

// ─── Dates ──────────────────────────────────────────────────────────────────

test('imported plan dates: Valant dates only; no start in the export says so; past review is OVERDUE', () => {
  const src = source();
  assert.equal(src.planStartDate, null, 'the plan grid has no start date column');
  const v = planDateView({ source: src, createdAt: IMPORTED_AT.toISOString(), reviewDueAt: plan().reviewDueAt!.toISOString(), status: 'ACTIVE', today: TODAY });
  assert.equal(v.startLabel, 'Start: not in Valant export');
  assert.equal(v.startDay, null, 'the import date is never used as the start');
  assert.equal(v.lastUpdatedLabel, 'Last updated in Valant Jan 20, 2025');
  assert.equal(v.reviewLabel, 'Review due Apr 14, 2025 — OVERDUE');
  assert.equal(v.overdue, true);
  assert.equal(v.daysOverdue, 552);
  assert.doesNotMatch(v.line, /2026-10-17|Oct 17, 2026/, 'import date not shown');
  assert.doesNotMatch(v.line, / to /, 'never a start-to-end range');
  assert.equal(v.line, 'Start: not in Valant export · Last updated in Valant Jan 20, 2025 · Review due Apr 14, 2025 — OVERDUE');
});

test('review date rules: future is not overdue, due today is not overdue, closed is never overdue, missing says not in export', () => {
  const src = source();
  const view = (reviewDueAt: string | null, status = 'ACTIVE') => planDateView({ source: src, createdAt: null, reviewDueAt, status, today: TODAY });
  assert.equal(view('2026-12-01T12:00:00.000Z').reviewLabel, 'Review due Dec 1, 2026');
  assert.equal(view('2026-12-01T12:00:00.000Z').overdue, false);
  assert.equal(view(`${TODAY}T12:00:00.000Z`).overdue, false);
  assert.equal(view('2025-04-14T12:00:00.000Z', 'CLOSED').overdue, false);
  assert.equal(view('2025-04-14T12:00:00.000Z', 'CLOSED').reviewLabel, 'Review due Apr 14, 2025');
  assert.equal(view(null).reviewLabel, 'Next review: not in Valant export');
});

test('a Valant start date is used when an export has one; a bad one is an error, not a guess', () => {
  const withStart = plan({ 'Start Date': '1/6/2025' });
  assert.equal(withStart.planStartDate?.toISOString().slice(0, 10), '2025-01-06');
  const src = buildPlanSource(withStart, IMPORTED_AT);
  assert.equal(parsePlanSource({ source: src })?.planStartDate, '2025-01-06');
  const v = planDateView({ source: src, createdAt: null, reviewDueAt: '2025-04-14T12:00:00.000Z', status: 'ACTIVE', today: TODAY });
  assert.equal(v.startLabel, 'Start Jan 6, 2025');
  const bad = parseValantTreatmentPlanRow(gridRow({ 'Effective Date': 'soon' }));
  assert.equal(bad.kind, 'error');
  // Older import records (no planStartDate key) read as unknown
  const legacy: Record<string, unknown> = { ...src };
  delete legacy.planStartDate;
  assert.equal(parsePlanSource({ source: legacy })?.planStartDate, null);
});

test('Altrixs plans: start is when the plan was written; review shown on its own', () => {
  const v = planDateView({ source: null, createdAt: '2026-10-01T14:00:00.000Z', reviewDueAt: '2027-04-01T12:00:00.000Z', status: 'ACTIVE', today: TODAY });
  assert.equal(v.line, 'Start Oct 1, 2026 · Review due Apr 1, 2027');
  assert.equal(planDateView({ source: null, createdAt: '2026-10-01', reviewDueAt: null, status: 'DRAFT', today: TODAY }).reviewLabel, 'Review date: not set');
});

test('treatment plan list never serializes the import date as an imported plan start', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'ehr', 'treatmentPlans.ts'), 'utf8');
  assert.match(src, /startDate: goals\.source \? goals\.source\.planStartDate \?\? '' : row\.createdAt/);
  const page = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'dashboard', 'ehr', 'treatment-plans', 'page.tsx'), 'utf8');
  assert.doesNotMatch(page, /\{selectedPlan\.startDate\} to \{selectedPlan\.reviewDate/, 'old "start to review" header is gone');
});

// ─── Diagnoses ──────────────────────────────────────────────────────────────

test('chart diagnoses: client record primary + secondaries and active problems, labeled as chart data', () => {
  const dx = chartDiagnosesForPlan(
    { primaryDiagnosis: 'Major depressive disorder, recurrent, moderate', primaryDiagnosisCode: 'f33.1', secondaryDiagnoses: 'F41.1 - Generalized anxiety disorder; F43.10 Post-traumatic stress disorder\nInsomnia' },
    [
      { icd10Code: 'E11.9', name: 'Type 2 diabetes', status: 'Active' },
      { icd10Code: 'J45.909', name: 'Asthma', status: 'Resolved' },
      { icd10Code: 'F41.1', name: 'GAD (duplicate)', status: 'active' },
      { icd10Code: null, name: 'Chronic back pain', status: 'Active' },
    ]
  );
  assert.deepEqual(dx, [
    { code: 'F33.1', description: 'Major depressive disorder, recurrent, moderate', isPrimary: true, from: 'Client record' },
    { code: 'F41.1', description: 'Generalized anxiety disorder', isPrimary: false, from: 'Client record' },
    { code: 'F43.10', description: 'Post-traumatic stress disorder', isPrimary: false, from: 'Client record' },
    { code: null, description: 'Insomnia', isPrimary: false, from: 'Client record' },
    { code: 'E11.9', description: 'Type 2 diabetes', isPrimary: false, from: 'Problem list' },
    { code: null, description: 'Chronic back pain', isPrimary: false, from: 'Problem list' },
  ]);
  assert.equal(CHART_DX_LABEL, 'From chart (not part of the Valant plan)');
  assert.ok(!dx.some((d) => d.description === VALANT_PLAN_TITLE), 'the plan title is never a diagnosis');
  assert.deepEqual(chartDiagnosesForPlan({ primaryDiagnosis: null, primaryDiagnosisCode: null, secondaryDiagnoses: null }, []), []);
  assert.deepEqual(splitDiagnosisText(''), []);
});

test('rewrite diagnoses: signed intake first, then coded chart diagnoses; uncoded entries are not added', () => {
  const chart = chartDiagnosesForPlan({ primaryDiagnosis: 'MDD', primaryDiagnosisCode: 'F33.1', secondaryDiagnoses: 'F41.1 GAD; Insomnia' }, []);
  assert.deepEqual(rewriteDiagnoses([], chart), [
    { code: 'F33.1', description: 'MDD', isPrimary: true },
    { code: 'F41.1', description: 'GAD', isPrimary: false },
  ]);
  assert.deepEqual(rewriteDiagnoses([{ code: 'F41.1', description: 'GAD (intake)', isPrimary: true }], chart), [
    { code: 'F41.1', description: 'GAD (intake)', isPrimary: true },
    { code: 'F33.1', description: 'MDD', isPrimary: false },
  ]);
});

// ─── Plan-required gate ─────────────────────────────────────────────────────

const settings = DEFAULT_THERAPY_WORKFLOW_SETTINGS;
function gatePlan(over: Partial<PlanSignatureState> = {}): PlanSignatureState {
  return {
    id: 'valant-1',
    title: VALANT_PLAN_TITLE,
    status: 'ACTIVE',
    reviewDueAt: '2025-04-14T12:00:00.000Z',
    clinicianSignedAt: null,
    supervisorRequired: false,
    supervisorSignedAt: null,
    patientSignatureStatus: 'NOT_SENT',
    imported: true,
    ...over,
  };
}
const gate = (plans: PlanSignatureState[]) => treatmentPlanGate({ noteType: 'Therapy Progress', cptCode: '90837', plans, today: TODAY, settings });

test('gate: an overdue imported plan does not count as active and points to the rewrite', () => {
  const g = gate([gatePlan()]);
  assert.equal(g.ok, false);
  assert.equal(g.planId, 'valant-1');
  assert.match(g.message, /imported from Valant passed its review date \(2025-04-14\)/);
  assert.match(g.message, /Rewrite in Altrixs/);
  assert.equal(planActivity(gatePlan(), { today: TODAY, requirePatientSignature: false }).state, 'expired');
});

test('gate: an imported plan with no review date in the export does not count as active', () => {
  const g = gate([gatePlan({ reviewDueAt: null })]);
  assert.equal(g.ok, false);
  assert.match(g.message, /no next review date in the Valant export/);
});

test('gate: a current imported Active plan still counts (signed in Valant); a Valant draft does not', () => {
  assert.equal(gate([gatePlan({ reviewDueAt: '2026-12-01T12:00:00.000Z' })]).ok, true);
  assert.equal(gate([gatePlan({ reviewDueAt: `${TODAY}T12:00:00.000Z` })]).ok, true, 'due today is still current');
  assert.equal(gate([gatePlan({ reviewDueAt: '2026-12-01T12:00:00.000Z', status: 'DRAFT' })]).ok, false);
});

test('gate: once the Altrixs rewrite is signed it is the active plan; crisis and intake notes are never blocked', () => {
  const rewrite: PlanSignatureState = {
    ...gatePlan(),
    id: 'altrixs-1',
    title: 'Treatment Plan — 2026-10-18',
    reviewDueAt: '2027-04-18',
    clinicianSignedAt: '2026-10-18T15:00:00Z',
    imported: false,
  };
  const g = gate([rewrite, gatePlan()]);
  assert.equal(g.ok, true);
  assert.equal(g.planId, 'altrixs-1');
  for (const cptCode of ['90839', '90791']) {
    assert.equal(treatmentPlanGate({ noteType: 'Therapy Progress', cptCode, plans: [gatePlan()], today: TODAY, settings }).ok, true);
  }
  // Plans written here keep their own wording
  assert.match(gate([{ ...rewrite, reviewDueAt: '2026-10-01' }]).message, /Complete a Treatment Plan Review/);
});

test('re-import never reopens a Valant plan that was closed in Altrixs', () => {
  assert.equal(reimportStatus('CLOSED', 'ACTIVE'), 'CLOSED');
  assert.equal(reimportStatus('ACTIVE', 'DRAFT'), 'DRAFT');
  assert.equal(reimportStatus(undefined, 'ACTIVE'), 'ACTIVE');
  const route = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'api', 'migration', 'treatment-plans', 'route.ts'), 'utf8');
  assert.match(route, /status: reimportStatus\(prior\?\.status, p\.status\)/);
});

test('rewrite closes the Valant plan only when the new plan becomes active (existing supersedes path)', () => {
  const store = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'ehr', 'therapy', 'planStore.ts'), 'utf8');
  assert.match(store, /supersedesId: rewrite\.importedPlanId/);
  assert.match(store, /if \(activates\) await closeSuperseded\(tx, plan\)/);
});

// ─── Worklist + documents ───────────────────────────────────────────────────

test('worklist: open imported plans need a rewrite; overdue / missing review flagged; a started rewrite is reused', () => {
  const src = source();
  const w = importedPlanWorklist(
    [
      { id: 'v1', status: 'ACTIVE', reviewDueAt: '2025-04-14', source: src },
      { id: 'v2', status: 'DRAFT', reviewDueAt: null, source: src },
      { id: 'v3', status: 'ACTIVE', reviewDueAt: '2027-01-01', source: src },
      { id: 'v4', status: 'CLOSED', reviewDueAt: '2025-01-01', source: src },
      { id: 'a1', status: 'DRAFT', reviewDueAt: '2027-04-18', source: null, supersedesId: 'v1' },
      { id: 'a2', status: 'ACTIVE', reviewDueAt: '2025-01-01', source: null },
    ],
    TODAY
  );
  assert.deepEqual([...w.keys()], ['v1', 'v2', 'v3']);
  assert.deepEqual(w.get('v1'), { planId: 'v1', needsRewrite: true, overdue: true, noReviewDate: false, rewriteDraftId: 'a1' });
  assert.equal(w.get('v2')?.noReviewDate, true);
  assert.equal(w.get('v3')?.overdue, false);
  assert.equal(rewriteHref('c 1', 'v1'), '/dashboard/ehr/treatment-plans/therapy?clientId=c%201&rewriteOf=v1');
  assert.equal(rewriteHref('c1', 'v1', 'a1'), '/dashboard/ehr/treatment-plans/therapy?clientId=c1&planId=a1');
});

test('Valant plan documents: classified Treatment Plan, or ITP / IRP / "treatment plan" in the title or file name', () => {
  assert.equal(isTreatmentPlanDocument({ documentType: 'Treatment Plan' }), true);
  assert.equal(isTreatmentPlanDocument({ documentType: 'Unclassified', fileName: 'ITP_2025.pdf' }), true);
  assert.equal(isTreatmentPlanDocument({ documentType: 'Progress Note', title: 'Individual Rehabilitation Plan (IRP)' }), true);
  assert.equal(isTreatmentPlanDocument({ documentType: 'Unclassified', fileName: 'valant_treatment_plan.pdf' }), true);
  assert.equal(isTreatmentPlanDocument({ documentType: 'Lab Report', fileName: 'split.pdf', title: 'Lipid panel' }), false);
  assert.equal(isTreatmentPlanDocument({ documentType: 'Correspondence', title: 'Planning meeting notes' }), false);
});

// ─── Goal suggestions from document text ────────────────────────────────────

const FIXTURE = [
  'Valant Treatment Plan',
  'Page 1 of 2',
  'Problem #1: Depressed mood',
  'Goal 1: Client will report improved mood and',
  'return to work part time.',
  'Objective 1.1: Client will identify 3 coping skills (Target Date: 03/01/2025)',
  'Objective 1.2 - PHQ-9 score below 10 Target date 04/14/2025',
  'Interventions:',
  '• CBT weekly with therapist',
  '- Behavioral activation homework',
  '',
  'Goal #2 - Reduce panic attacks to fewer than 1 per week',
  'Short-term objective: Practice paced breathing daily',
  'Intervention: Psychoeducation on panic cycle',
  'Status: In progress',
  'Goals are reviewed every 90 days with the client.',
  'Signature: ____________',
].join('\n');

test('goal suggestions: labeled lines only, quoted, target dates quoted not applied', () => {
  const s = suggestPlanGoalsFromText(FIXTURE);
  assert.equal(s.goals.length, 2);
  const [g1, g2] = s.goals;
  assert.equal(g1.problem, 'Depressed mood');
  assert.equal(g1.text, 'Client will report improved mood and return to work part time.');
  assert.deepEqual(g1.sourceLines, ['Goal 1: Client will report improved mood and', 'return to work part time.']);
  assert.deepEqual(
    g1.objectives.map((o) => [o.text, o.targetDateInSource]),
    [
      ['Client will identify 3 coping skills', '03/01/2025'],
      ['PHQ-9 score below 10', '04/14/2025'],
    ]
  );
  assert.deepEqual(g1.interventions.map((i) => i.text), ['CBT weekly with therapist', 'Behavioral activation homework']);
  assert.equal(g2.text, 'Reduce panic attacks to fewer than 1 per week');
  assert.deepEqual(g2.objectives.map((o) => o.text), ['Practice paced breathing daily']);
  assert.deepEqual(g2.interventions.map((i) => i.text), ['Psychoeducation on panic cycle'], 'status line is not appended');
  assert.deepEqual(s.unattached, []);
});

test('goal suggestions never invent: every word comes from the quoted source lines', () => {
  const s = suggestPlanGoalsFromText(FIXTURE);
  const items = s.goals.flatMap((g) => [g, ...g.objectives, ...g.interventions]);
  for (const item of items) {
    const quoted = item.sourceLines.join(' ');
    for (const word of item.text.split(' ')) assert.ok(quoted.includes(word), `"${word}" is in the source lines`);
    for (const line of item.sourceLines) assert.ok(FIXTURE.includes(line), 'quoted line is verbatim from the document');
  }
});

test('goal suggestions: no labels -> nothing; prose mentioning goals is not a goal; items before a goal are unattached', () => {
  assert.deepEqual(suggestPlanGoalsFromText('Client seen for follow-up. Mood stable. Goals are reviewed monthly.'), { goals: [], unattached: [] });
  assert.deepEqual(suggestPlanGoalsFromText(''), { goals: [], unattached: [] });
  assert.deepEqual(suggestPlanGoalsFromText(null), { goals: [], unattached: [] });
  const s = suggestPlanGoalsFromText('Intervention: DBT skills group\nObjective: Attend 4 of 4 sessions');
  assert.deepEqual(s.goals, []);
  assert.deepEqual(s.unattached.map((u) => [u.kind, u.item.text]), [
    ['intervention', 'DBT skills group'],
    ['objective', 'Attend 4 of 4 sessions'],
  ]);
});

test('adding suggestions: exact text, blank target dates and intervention fields, starting blank goal replaced', () => {
  const s = suggestPlanGoalsFromText(FIXTURE);
  const typed = { ...emptyTpGoal('G9', 'Typed by clinician') };
  const next = addSuggestedGoals([emptyTpGoal('G1'), typed], [s.goals[0]], (i) => `S${i}`);
  assert.deepEqual(next.map((g) => g.id), ['G9', 'S0']);
  const added = next[1];
  assert.equal(added.goal, s.goals[0].text);
  assert.deepEqual(added.objectives, [
    { text: 'Client will identify 3 coping skills', targetDate: '' },
    { text: 'PHQ-9 score below 10', targetDate: '' },
  ]);
  assert.deepEqual(added.interventions[0], { type: '', detail: 'CBT weekly with therapist', frequency: '', responsible: '' });
  assert.equal(added.progress, '');
});
