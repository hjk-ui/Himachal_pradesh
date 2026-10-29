import test from 'node:test';
import assert from 'node:assert/strict';
import { valantPatientName } from '../src/lib/clients/legalName';
import {
  PATIENT_SIGNER_ATTESTATION,
  PROVIDER_SIGNER_ATTESTATION,
  attestationFor,
  buildPlanDocument,
  buildSignatureBlocks,
  planInsurances,
  renderPlanDocumentText,
} from '../src/lib/ehr/therapy/planDocument';
import {
  asPlanProgress,
  emptyGoal,
  emptyIntervention,
  emptyObjective,
  emptyProblem,
  goalProgressHistory,
  hierarchyBlockers,
  libraryEditViolation,
  libraryTextEditable,
  nodeFromLibrary,
  planProblems,
  problemsFromLegacyGoals,
  sanitizeLibraryItem,
  type LibraryItem,
  type PlanProblem,
} from '../src/lib/ehr/therapy/planHierarchy';
import { planGoals, sanitizePlanValues, treatmentPlanBlockers } from '../src/lib/ehr/therapy/planTemplate';
import { planReviewReminder, DEFAULT_THERAPY_WORKFLOW_SETTINGS } from '../src/lib/ehr/therapy/rules';
import { renderPlanGoals } from '../src/lib/ehr/therapy/widgets';
import { planReviewInboxDraft } from '../src/lib/inbox/core';

// ─── Name format ────────────────────────────────────────────────────────────

test('Valant name format with a preferred name', () => {
  assert.equal(
    valantPatientName({ preferredName: 'Liz', legalFirstName: 'Elizabeth', middleInitial: 'a', legalLastName: 'Jones', nameSuffix: 'Jr.', patientId: 'ALT-1' }),
    'Liz [Elizabeth] A. Jones, Jr. (ALT-1)'
  );
});

test('Valant name format without a preferred name, middle initial or suffix', () => {
  assert.equal(valantPatientName({ legalFirstName: 'Elizabeth', middleInitial: 'A.', legalLastName: 'Jones', nameSuffix: 'III', patientId: 'ALT-1' }), 'Elizabeth A. Jones, III (ALT-1)');
  assert.equal(valantPatientName({ legalFirstName: 'Elizabeth', legalLastName: 'Jones', patientId: 'ALT-1' }), 'Elizabeth Jones (ALT-1)');
  assert.equal(valantPatientName({ legalFirstName: 'Elizabeth', legalLastName: 'Jones' }), 'Elizabeth Jones');
  // Preferred equal to first name is the no-preferred form
  assert.equal(valantPatientName({ preferredName: 'elizabeth', legalFirstName: 'Elizabeth', legalLastName: 'Jones' }), 'Elizabeth Jones');
  // No legal parts: Client.name is split
  assert.equal(valantPatientName({ name: 'Mary K. Smith', preferredName: 'Kay', patientId: 'X9' }), 'Kay [Mary] K. Smith (X9)');
});

// ─── Plan fields / hierarchy validation ─────────────────────────────────────

function hierarchy(): PlanProblem[] {
  const iv = { ...emptyIntervention('I1'), type: 'CBT', text: 'thought records', frequency: 'Weekly', length: '50 min', duration: '12 weeks' };
  const obj = { ...emptyObjective('O1'), text: 'Use a coping skill 3x/week', targetDate: '2027-01-15', targetSessions: 12, interventions: [iv] };
  const goal = { ...emptyGoal('G1', 'Worry less at work'), responsibleParty: 'Client and therapist', objectives: [obj] };
  return [{ ...emptyProblem('P1', [goal]), text: 'Anxiety', behavioralDescription: 'Daily worry' }];
}

function values(extra: Record<string, unknown> = {}) {
  return {
    planKind: 'Initial',
    serviceSetting: 'In person — on site',
    startDate: '2026-10-19',
    diagnoses: [{ code: 'F41.1', description: 'Generalized anxiety disorder', isPrimary: true }],
    presentingNeeds: 'Worry',
    tpStrengths: 'Motivated',
    tpProblems: hierarchy(),
    tpFrequency: 'Weekly',
    dischargeGoals: ['Improvement in symptoms'],
    reviewDate: '2027-04-15',
    clientParticipated: 'Yes',
    ...extra,
  };
}

const ctx = { minor: false, telehealth: false };

test('Start Date is required; Effective Until cannot precede it', () => {
  assert.deepEqual(treatmentPlanBlockers(values(), ctx), []);
  assert.ok(treatmentPlanBlockers(values({ startDate: '' }), ctx).some((b) => /Start Date is required/.test(b.message)));
  assert.ok(treatmentPlanBlockers(values({ effectiveUntil: '2026-01-01' }), ctx).some((b) => /Effective Until/.test(b.message)));
});

test('hierarchy validation: problem needs a goal, goal needs objective + intervention, no half-entered nodes, dates after start', () => {
  const noGoal: PlanProblem[] = [{ ...emptyProblem('P1', []), text: 'Anxiety' }];
  assert.ok(hierarchyBlockers(noGoal, { review: false, startDate: null }).some((m) => /Problem 1: add at least one goal/.test(m)));
  const unnamed = hierarchy();
  unnamed[0].text = '';
  assert.ok(hierarchyBlockers(unnamed, { review: false, startDate: null }).some((m) => /Problem 1: enter the problem/.test(m)));
  const noIv = hierarchy();
  noIv[0].goals[0].objectives[0].interventions = [];
  assert.ok(hierarchyBlockers(noIv, { review: false, startDate: null }).some((m) => /add at least one intervention/.test(m)));
  const orphan = hierarchy();
  orphan[0].goals[0].objectives.push({ ...emptyObjective('O2'), interventions: [{ ...emptyIntervention('I2'), text: 'x' }] });
  assert.ok(hierarchyBlockers(orphan, { review: false, startDate: null }).some((m) => /Objective 1\.2: enter the objective/.test(m)));
  assert.ok(hierarchyBlockers(hierarchy(), { review: false, startDate: '2027-02-01' }).some((m) => /before the plan start date/.test(m)));
  assert.ok(hierarchyBlockers(hierarchy(), { review: true, startDate: null }).some((m) => /rate progress/.test(m)));
});

test('plans saved with flat goals are read forward into one problem (interventions under the first objective)', () => {
  const problems = problemsFromLegacyGoals([
    { id: 'G1', goal: 'Sleep', objectives: [{ text: 'Sleep 7h', targetDate: '2027-01-01' }], interventions: [{ type: 'CBT', detail: 'sleep hygiene', frequency: 'Weekly', responsible: 'Therapist' }], progress: 'None' },
  ]);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].text, '');
  assert.equal(problems[0].goals[0].objectives[0].interventions[0].text, 'sleep hygiene');
  assert.equal(problems[0].goals[0].progress, 'Not started');
  assert.equal(planGoals({ tpGoals: [{ id: 'G1', goal: 'Sleep', objectives: [], interventions: [] }] })[0].goal, 'Sleep');
  assert.equal(asPlanProgress('Satisfactory'), 'Moderate');
  const clean = sanitizePlanValues({ tpGoals: [{ id: 'G1', goal: 'Sleep' }], startDate: 'soon' });
  assert.equal('tpGoals' in clean, false);
  assert.equal((clean.tpProblems as PlanProblem[])[0].goals[0].text, 'Sleep');
  assert.equal('startDate' in clean, false, 'invalid date dropped');
});

// ─── Document + attestations ────────────────────────────────────────────────

test('attestation texts are exactly the Valant template text', () => {
  assert.equal(PATIENT_SIGNER_ATTESTATION, 'I participated in the development of this treatment plan and I agree to its content.');
  assert.equal(
    PROVIDER_SIGNER_ATTESTATION,
    "I have reviewed this client's individualized treatment plan and agree that the goals, objectives, and/or interventions listed in this treatment plan are clinically indicated."
  );
  for (const r of ['Owner', 'Supervisor', 'Other provider'] as const) assert.equal(attestationFor(r), PROVIDER_SIGNER_ATTESTATION);
  for (const r of ['Patient', 'Guardian', 'Guarantor', 'Other signer'] as const) assert.equal(attestationFor(r), PATIENT_SIGNER_ATTESTATION);
  const blocks = buildSignatureBlocks(
    {
      clinicianSignedAt: '2026-10-19T12:00:00Z',
      clinicianSignedByName: 'Dr. A',
      supervisorRequired: true,
      supervisorSignedAt: null,
      supervisorSignedByName: null,
      patientSignatureStatus: 'SIGNED',
      patientSentAt: null,
      patientSignedAt: '2026-10-19T13:00:00Z',
      patientSignedName: 'Liz Jones',
      patientDeclinedAt: null,
      patientDeclineReason: null,
      patientVerbalBy: null,
    },
    [{ id: 'S1', role: 'Guarantor', name: 'Pat Jones', relationship: 'Guarantor', method: 'portal', signedAt: '2026-10-19T14:00:00Z', recordedBy: null, attestation: PATIENT_SIGNER_ATTESTATION }]
  );
  assert.deepEqual(blocks.map((b) => b.role), ['Owner', 'Supervisor', 'Patient', 'Guarantor']);
  assert.equal(blocks[1].status, 'pending');
  assert.equal(blocks[3].attestation, PATIENT_SIGNER_ATTESTATION);
});

test('plan document header: name format, Patient ID, insurances 1–3, diagnosis, Documentation ID', () => {
  const doc = buildPlanDocument({
    planId: 'plan_123',
    values: values({ patientInstructions: 'Practice breathing', tpParticipation: ['Patient participated in the development of this treatment plan'] }),
    ctx,
    client: {
      legalFirstName: 'Elizabeth', middleInitial: 'A', legalLastName: 'Jones', preferredName: 'Liz', nameSuffix: null, name: 'Elizabeth Jones',
      mrn: 'ALT-1', dateOfBirth: '1990-05-01', addressLine1: '1 Main St', addressLine2: null, city: 'Bowie', state: 'MD', postalCode: '20715', phone: '3015550100',
    },
    providerName: 'Dr. A',
    practice: { name: 'Divine Counseling', logoUrl: 'https://example.org/logo.png' },
    insurances: planInsurances(
      [
        { rank: 'S', payerName: 'Medicare', memberId: 'M2', groupNumber: null },
        { rank: 'P', payerName: 'Medicaid', memberId: 'M1', groupNumber: 'G1' },
      ],
      null
    ),
    today: '2026-10-19',
  });
  assert.equal(doc.header.primaryHeader, 'Treatment Plan');
  assert.equal(doc.header.patientName, 'Liz [Elizabeth] A. Jones (ALT-1)');
  assert.equal(doc.header.documentationId, 'plan_123');
  assert.equal(doc.header.age, 36);
  assert.deepEqual(doc.header.insurances.map((i) => [i.rank, i.payerName]), [[1, 'Medicaid'], [2, 'Medicare']]);
  assert.deepEqual(doc.header.address, ['1 Main St', 'Bowie, MD 20715']);
  assert.equal(doc.plan.startDate, '2026-10-19');
  assert.equal(doc.part2, false);
  const text = renderPlanDocumentText(doc);
  assert.match(text, /^Treatment Plan\nDivine Counseling\nPatient: Liz \[Elizabeth\] A\. Jones \(ALT-1\)/);
  assert.match(text, /Insurance 1: Medicaid — ID # M1 — Group # G1/);
  assert.match(text, /Problem 1: Anxiety\n {2}Behavioral description: Daily worry\nGoal 1: Worry less at work/);
  assert.match(text, /Intervention: CBT: thought records — Frequency: Weekly — Length: 50 min — Duration: 12 weeks/);
  assert.ok(text.includes(PATIENT_SIGNER_ATTESTATION) && text.includes(PROVIDER_SIGNER_ATTESTATION));
  const sud = buildPlanDocument({ ...{ planId: 'p', ctx, providerName: null, practice: { name: null, logoUrl: null }, insurances: [], today: '2026-10-19' }, values: values({ diagnoses: [{ code: 'F10.20', description: 'AUD', isPrimary: true }] }), client: { mrn: null, dateOfBirth: null, addressLine1: null, addressLine2: null, city: null, state: null, postalCode: null, phone: null, name: 'A B' } });
  assert.equal(sud.part2, true);
  assert.match(renderPlanDocumentText(sud), /42 CFR part 2 prohibits unauthorized use or disclosure of these records\./);
});

// ─── Review reminder ────────────────────────────────────────────────────────

test('review reminder: owner 7 days before the due date, kept while overdue; supervisor blank = none', () => {
  assert.equal(DEFAULT_THERAPY_WORKFLOW_SETTINGS.reviewReminderDays, 7);
  assert.equal(DEFAULT_THERAPY_WORKFLOW_SETTINGS.supervisorReminderDays, null);
  assert.equal(planReviewReminder('2026-11-10', '2026-11-02', 7), null);
  assert.deepEqual(planReviewReminder('2026-11-10', '2026-11-03', 7), { due: '2026-11-10', remindFrom: '2026-11-03', daysLeft: 7, overdue: false });
  assert.equal(planReviewReminder('2026-11-10', '2026-11-12', 7)?.overdue, true);
  assert.equal(planReviewReminder('2026-11-10', '2026-11-09', null), null);
  assert.equal(planReviewReminder(null, '2026-11-09', 7), null);
  const d = planReviewInboxDraft({ planId: 'p1', clientId: 'c1', clientName: 'A', title: 'Treatment Plan', audience: 'owner', reminder: planReviewReminder('2026-11-10', '2026-11-09', 7)! });
  assert.equal(d.entityKey, 'plan-review:p1');
  assert.equal(d.priority, 'high');
  assert.match(d.href, /kind=Review/);
});

// ─── Libraries ──────────────────────────────────────────────────────────────

test('library items: use on a plan, and the edit-before/after-active rules', () => {
  const item = sanitizeLibraryItem({ id: 'lib-1', kind: 'intervention', text: 'Exposure hierarchy', frequency: 'Weekly', length: '50 min' }) as LibraryItem;
  assert.ok(item);
  assert.equal(sanitizeLibraryItem({ id: 'x', kind: 'nope', text: 'a' }), null);
  const node = nodeFromLibrary(item, 'practice') as ReturnType<typeof emptyIntervention>;
  assert.equal(node.text, 'Exposure hierarchy');
  assert.equal(node.source, 'practice');
  assert.equal(node.libraryId, 'lib-1');
  assert.equal(node.frequency, 'Weekly');
  const locked = { libraryEditBeforeActive: false, libraryEditAfterActive: true };
  assert.equal(libraryTextEditable(node, locked), false);
  assert.equal(libraryTextEditable({ ...node, carried: true }, locked), true);
  assert.equal(libraryTextEditable(emptyIntervention(), locked), true, 'custom items always editable');
  const problems = hierarchy();
  problems[0].goals[0].objectives[0].interventions = [{ ...node, text: 'Edited text' }];
  const lookup = { library: () => 'Exposure hierarchy', prior: () => null };
  assert.match(libraryEditViolation(problems, locked, lookup) || '', /Practice Library/);
  assert.equal(libraryEditViolation(problems, { libraryEditBeforeActive: true, libraryEditAfterActive: true }, lookup), null);
  assert.equal(planProblems({ tpProblems: problems })[0].goals[0].objectives[0].interventions[0].libraryId, 'lib-1');
});

test('progress notes record a goal level and the history is read back by goal text', () => {
  const text = renderPlanGoals(
    { id: 'p', title: 'Plan', signedAt: null, reviewDueAt: null, goals: [{ id: 'G1', text: 'Worry less at work', objectives: [] }] },
    { G1: { status: 'Progress made', note: 'used breathing', level: 'Moderate' } },
    { planLoaded: true }
  );
  assert.match(text, /^Goal 1: Worry less at work — Progress made \(Moderate\) — used breathing$/m);
  const history = goalProgressHistory([{ id: 'G1', text: 'Worry less at work' }], [
    { noteId: 'n1', date: '2026-10-01', goalsText: 'Goal 1: Worry less at work — No change' },
    { noteId: 'n2', date: '2026-10-08', goalsText: text },
  ]);
  assert.deepEqual(history.G1.map((h) => [h.date, h.status, h.level]), [['2026-10-08', 'Progress made', 'Moderate'], ['2026-10-01', 'No change', '']]);
});
