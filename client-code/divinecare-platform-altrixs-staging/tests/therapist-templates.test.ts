import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { NOTE_LABELS, NOTE_SECTIONS, NOTE_TYPES, isSudNote, normalizeNoteType } from '../src/lib/ehr/noteTemplates';
import { asStructuredNoteType, isTherapyTemplate, structuredSignBlockers, TEMPLATE_CONFIG } from '../src/lib/ehr/structuredNotes';
import {
  SUD_INTAKE,
  THERAPY_INTAKE,
  THERAPY_NOTE_ALIASES,
  THERAPY_NOTE_LABELS,
  THERAPY_PROGRESS,
  THERAPY_SECTIONS,
  TREATMENT_PLAN_SECTIONS,
  TS,
} from '../src/lib/ehr/therapy/sections';
import { THERAPY_TEMPLATES, TREATMENT_PLAN_TEMPLATE, templateHeadings } from '../src/lib/ehr/therapy/templates';
import {
  DEFAULT_THERAPY_WORKFLOW_SETTINGS,
  defaultReviewDays,
  licenseLevelFromCredentials,
  minutesBetween,
  noteRequiresTreatmentPlan,
  parseTherapyWorkflowSettings,
  patientSignatureTransition,
  planActivity,
  resolveLicenseLevel,
  suggestTherapyCpt,
  supervisorSignatureRequired,
  treatmentPlanGate,
  type PlanSignatureState,
} from '../src/lib/ehr/therapy/rules';
import { cosignRequiredFor } from '../src/lib/notes/transitions';
import { fieldIndex, missingFields, renderSection, restoreValues, type Values } from '../src/lib/ehr/therapy/engine';
import { codeBlockers, riskBlockers, therapySignBlockers } from '../src/lib/ehr/therapy/blockers';
import { renderPlanGoals, renderSessionBlock, renderTpGoals, emptyTpGoal, asamSuggestion } from '../src/lib/ehr/therapy/widgets';
import { problemsFromLegacyGoals, type PlanProblem } from '../src/lib/ehr/therapy/planHierarchy';
import {
  initialPlanValues,
  planFieldsFromValues,
  planGoals,
  prefillFromIntakeBody,
  renderTreatmentPlanText,
  sanitizePlanValues,
  treatmentPlanBlockers,
} from '../src/lib/ehr/therapy/planTemplate';
import { renderDiagnoses, renderMse, renderSafetyPlan, EMPTY_SAFETY_PLAN, SI_POSITIVE_LINE } from '../src/lib/ehr/psychMedMgmt';
import { EMPTY_MSE_VALUE } from '../src/components/clinical/MentalStatusExamWidget';
import { planCareSchema } from '../src/lib/ehr/planCareSchema';

// Synthetic ids and names only; no real patient data.
const TODAY = '2026-10-17';
const settings = DEFAULT_THERAPY_WORKFLOW_SETTINGS;

function plan(over: Partial<PlanSignatureState> = {}): PlanSignatureState {
  return {
    id: 'plan-1',
    title: 'Treatment Plan — 2026-10-01',
    status: 'ACTIVE',
    reviewDueAt: '2027-01-01',
    clinicianSignedAt: '2026-10-01T15:00:00Z',
    supervisorRequired: false,
    supervisorSignedAt: null,
    patientSignatureStatus: 'AWAITING',
    imported: false,
    ...over,
  };
}

// ─── CPT by session time ────────────────────────────────────────────────────

test('CPT is picked from session time: 16–37 = 90832, 38–52 = 90834, 53+ = 90837', () => {
  assert.equal(suggestTherapyCpt(15).code, null);
  assert.equal(suggestTherapyCpt(16).code, '90832');
  assert.equal(suggestTherapyCpt(37).code, '90832');
  assert.equal(suggestTherapyCpt(38).code, '90834');
  assert.equal(suggestTherapyCpt(52).code, '90834');
  assert.equal(suggestTherapyCpt(53).code, '90837');
  assert.equal(suggestTherapyCpt(90).code, '90837');
  assert.equal(suggestTherapyCpt(null).code, null);
  assert.match(suggestTherapyCpt(45).rule, /90834 \(38–52 min\)/);
});

test('family psychotherapy codes need 26+ minutes; with / without the patient', () => {
  assert.equal(suggestTherapyCpt(25, 'family-with-patient').code, null);
  assert.equal(suggestTherapyCpt(26, 'family-with-patient').code, '90847');
  assert.equal(suggestTherapyCpt(50, 'family-without-patient').code, '90846');
});

test('session minutes come from start and end time', () => {
  assert.equal(minutesBetween('10:00', '10:53'), 53);
  assert.equal(minutesBetween('9:05', '9:43'), 38);
  assert.equal(minutesBetween('10:00', '09:00'), null);
  assert.equal(minutesBetween('', '10:00'), null);
});

test('a code that differs from the time rule needs an override reason', () => {
  const session = 'Session type: Individual psychotherapy\nStart time: 10:00\nEnd time: 10:45';
  const blocked = codeBlockers({ type: THERAPY_PROGRESS, cptCode: '90837', durationMinutes: 45, sessionText: session });
  assert.equal(blocked.length, 1);
  assert.match(blocked[0].message, /does not match the time rule/);
  const ok = codeBlockers({ type: THERAPY_PROGRESS, cptCode: '90837', durationMinutes: 45, sessionText: `${session}\nCode override reason: interactive session ran over, time documented in chart` });
  assert.deepEqual(ok, []);
  assert.deepEqual(codeBlockers({ type: THERAPY_PROGRESS, cptCode: '90834', durationMinutes: 45, sessionText: session }), []);
  // Missing times block a time-based code
  assert.ok(codeBlockers({ type: THERAPY_PROGRESS, cptCode: '90834', durationMinutes: 45, sessionText: 'Session type: Individual psychotherapy' }).some((b) => /start and end time/.test(b.message)));
  // Intake templates only take 90791
  assert.ok(codeBlockers({ type: THERAPY_INTAKE, cptCode: '90837', durationMinutes: 60, sessionText: '' }).some((b) => /not used with this template/.test(b.message)));
  assert.deepEqual(codeBlockers({ type: THERAPY_INTAKE, cptCode: '90791', durationMinutes: 60, sessionText: '' }), []);
});

// ─── Treatment plan gate ────────────────────────────────────────────────────

test('signing a therapy progress note needs an active, signed treatment plan', () => {
  const none = treatmentPlanGate({ noteType: THERAPY_PROGRESS, cptCode: '90837', plans: [], today: TODAY, settings });
  assert.equal(none.ok, false);
  assert.match(none.message, /No treatment plan is on file/);
  assert.match(none.message, /draft/);
  const active = treatmentPlanGate({ noteType: THERAPY_PROGRESS, cptCode: '90834', plans: [plan()], today: TODAY, settings });
  assert.equal(active.ok, true);
  assert.equal(active.planId, 'plan-1');
});

test('the gate applies to psychotherapy codes on any note type, but never to intake or crisis', () => {
  assert.equal(noteRequiresTreatmentPlan({ noteType: 'SOAP', cptCode: '90837' }), true);
  assert.equal(noteRequiresTreatmentPlan({ noteType: 'DAP', cptCode: '90847' }), true);
  assert.equal(noteRequiresTreatmentPlan({ noteType: 'SOAP', cptCode: '90839' }), false);
  assert.equal(noteRequiresTreatmentPlan({ noteType: THERAPY_PROGRESS, cptCode: '90840' }), false);
  assert.equal(noteRequiresTreatmentPlan({ noteType: THERAPY_INTAKE, cptCode: '90791' }), false);
  assert.equal(noteRequiresTreatmentPlan({ noteType: 'Psych Med Mgmt', cptCode: '99214' }), false);
  assert.equal(noteRequiresTreatmentPlan({ noteType: THERAPY_PROGRESS, cptCode: null }), true);
  assert.equal(noteRequiresTreatmentPlan({ noteType: 'SOAP', cptCode: '90837-95' }), true);
  const crisis = treatmentPlanGate({ noteType: 'SOAP', cptCode: '90839', plans: [], today: TODAY, settings });
  assert.equal(crisis.ok, true);
  assert.equal(crisis.required, false);
  const intake = treatmentPlanGate({ noteType: THERAPY_INTAKE, cptCode: '90791', plans: [], today: TODAY, settings });
  assert.equal(intake.ok, true);
});

test('unsigned, draft, expired and closed plans do not count; imported Valant plans do', () => {
  const gate = (p: PlanSignatureState) => treatmentPlanGate({ noteType: THERAPY_PROGRESS, cptCode: '90837', plans: [p], today: TODAY, settings });
  assert.equal(gate(plan({ clinicianSignedAt: null })).ok, false);
  assert.match(gate(plan({ clinicianSignedAt: null })).message, /not been signed/);
  assert.equal(gate(plan({ status: 'DRAFT' })).ok, false);
  assert.equal(gate(plan({ status: 'CLOSED' })).ok, false);
  const expired = gate(plan({ reviewDueAt: '2026-10-16' }));
  assert.equal(expired.ok, false);
  assert.match(expired.message, /review date/);
  assert.equal(gate(plan({ reviewDueAt: TODAY })).ok, true, 'due today is still active');
  assert.equal(gate(plan({ clinicianSignedAt: null, imported: true })).ok, true);
});

test('a pre-licensed author’s plan is not active until the supervisor signs', () => {
  const pending = plan({ supervisorRequired: true, supervisorSignedAt: null });
  assert.equal(planActivity(pending, { today: TODAY, requirePatientSignature: false }).state, 'awaiting-supervisor');
  const gate = treatmentPlanGate({ noteType: THERAPY_PROGRESS, cptCode: '90837', plans: [pending], today: TODAY, settings });
  assert.equal(gate.ok, false);
  assert.match(gate.message, /supervisor/);
  assert.equal(planActivity({ ...pending, supervisorSignedAt: '2026-10-02T12:00:00Z' }, { today: TODAY, requirePatientSignature: false }).active, true);
});

test('patient signature is tracked but only required when the practice turns it on', () => {
  const awaiting = plan({ patientSignatureStatus: 'AWAITING' });
  assert.equal(planActivity(awaiting, { today: TODAY, requirePatientSignature: false }).active, true);
  assert.equal(planActivity(awaiting, { today: TODAY, requirePatientSignature: true }).state, 'awaiting-patient');
  assert.equal(planActivity(plan({ patientSignatureStatus: 'SIGNED' }), { today: TODAY, requirePatientSignature: true }).active, true);
  assert.equal(planActivity(plan({ patientSignatureStatus: 'VERBAL' }), { today: TODAY, requirePatientSignature: true }).active, true);
});

test('the gate can be switched off; settings default to gate on, patient signature off', () => {
  const off = treatmentPlanGate({ noteType: THERAPY_PROGRESS, cptCode: '90837', plans: [], today: TODAY, settings: { ...settings, requirePlanForProgressNotes: false } });
  assert.equal(off.ok, true);
  // + Valant template configuration: library editing allowed before / after active, owner reminder 7 days, no supervisor reminder
  const golive = { goLiveDate: '2026-11-01', transitionUntil: null, libraryEditBeforeActive: true, libraryEditAfterActive: true, reviewReminderDays: 7, supervisorReminderDays: null };
  assert.deepEqual(parseTherapyWorkflowSettings(null), { requirePlanForProgressNotes: true, requirePatientSignature: false, ...golive });
  assert.deepEqual(parseTherapyWorkflowSettings({ requirePlanForProgressNotes: false, junk: 1 }), { requirePlanForProgressNotes: false, requirePatientSignature: false, ...golive });
});

test('the server enforces the gate when signing, not when saving a draft', () => {
  const root = path.join(__dirname, '..', 'src');
  const store = fs.readFileSync(path.join(root, 'lib/notes/workflow-store.ts'), 'utf8');
  const signIdx = store.indexOf('From here on a new signature is applied');
  const gateIdx = store.indexOf('if (!planGate.ok)');
  assert.ok(signIdx > 0 && gateIdx > signIdx, 'plan gate runs only on the new-signature path');
  for (const draftRoute of ['app/api/notes/[id]/route.ts', 'app/api/notes/route.ts', 'app/api/clients/[id]/notes/route.ts']) {
    const src = fs.readFileSync(path.join(root, draftRoute), 'utf8');
    assert.ok(!/checkTreatmentPlanGate|treatmentPlanGate/.test(src), `${draftRoute} must not block drafts`);
  }
});

// ─── Pre-licensed co-signature ──────────────────────────────────────────────

test('license level: Maryland pre-licensure credentials vs independent licenses', () => {
  assert.equal(licenseLevelFromCredentials(['LGPC']), 'PRE_LICENSED');
  assert.equal(licenseLevelFromCredentials(['LMSW — Maryland']), 'PRE_LICENSED');
  assert.equal(licenseLevelFromCredentials(['LGMFT']), 'PRE_LICENSED');
  assert.equal(licenseLevelFromCredentials(['LGADC']), 'PRE_LICENSED');
  assert.equal(licenseLevelFromCredentials(['LCPC']), 'LICENSED');
  assert.equal(licenseLevelFromCredentials(['LCSW-C']), 'LICENSED');
  assert.equal(licenseLevelFromCredentials(['LGPC', 'LCPC']), 'LICENSED', 'graduate license left on file after full licensure');
  assert.equal(licenseLevelFromCredentials(['LGPC — supervised by an LCPC']), 'PRE_LICENSED');
  assert.equal(licenseLevelFromCredentials(['MD Board of Professional Counselors LGPC']), 'PRE_LICENSED', '"MD" (Maryland) is not read as a physician license');
  assert.equal(licenseLevelFromCredentials(['CPR certification']), null);
  assert.equal(licenseLevelFromCredentials([]), null);
});

test('resolved level: HR setting wins, then supervision track, then credentials', () => {
  assert.deepEqual(resolveLicenseLevel({ explicit: 'LICENSED', credentialTitles: ['LGPC'], onSupervisionTrack: true }), { level: 'LICENSED', source: 'hr-setting' });
  assert.equal(resolveLicenseLevel({ explicit: null, credentialTitles: ['LCPC'], onSupervisionTrack: true }).level, 'PRE_LICENSED');
  assert.equal(resolveLicenseLevel({ explicit: null, credentialTitles: ['LGPC'], onSupervisionTrack: false }).level, 'PRE_LICENSED');
  assert.deepEqual(resolveLicenseLevel({ explicit: null, credentialTitles: [], onSupervisionTrack: false }), { level: 'LICENSED', source: 'default' });
});

test('supervisor signs plans and co-signs notes only for pre-licensed authors', () => {
  assert.equal(supervisorSignatureRequired('PRE_LICENSED'), true);
  assert.equal(supervisorSignatureRequired('LICENSED'), false);
  assert.equal(cosignRequiredFor('THERAPIST', false, true), true);
  assert.equal(cosignRequiredFor('THERAPIST', false, false), false);
  assert.equal(cosignRequiredFor('THERAPIST', true), true, 'licensure track still requires co-sign');
  assert.equal(cosignRequiredFor('CASE_MANAGER', false, false), true, 'role-based policy kept');
});

// ─── Portal signature ───────────────────────────────────────────────────────

test('patient signature status transitions', () => {
  const signed = { clinicianSigned: true };
  assert.equal(patientSignatureTransition('NOT_SENT', { type: 'send' }, { clinicianSigned: false }).ok, false, 'not sent before the clinician signs');
  const sent = patientSignatureTransition('NOT_SENT', { type: 'send' }, signed);
  assert.deepEqual(sent, { ok: true, next: 'AWAITING' });
  assert.deepEqual(patientSignatureTransition('AWAITING', { type: 'sign', typedName: 'Pat Example' }, signed), { ok: true, next: 'SIGNED' });
  assert.equal(patientSignatureTransition('AWAITING', { type: 'sign', typedName: ' ' }, signed).ok, false, 'typed name required');
  assert.equal(patientSignatureTransition('SIGNED', { type: 'sign', typedName: 'Pat Example' }, signed).ok, false);
  assert.equal(patientSignatureTransition('AWAITING', { type: 'decline', reason: '' }, signed).ok, false, 'decline needs a reason');
  assert.deepEqual(patientSignatureTransition('AWAITING', { type: 'decline', reason: 'Goal 2 is not mine' }, signed), { ok: true, next: 'DECLINED' });
  assert.equal(patientSignatureTransition('DECLINED', { type: 'sign', typedName: 'Pat Example' }, signed).ok, false, 'declined plan must be re-sent first');
  assert.deepEqual(patientSignatureTransition('DECLINED', { type: 'send' }, signed), { ok: true, next: 'AWAITING' });
  assert.equal(patientSignatureTransition('SIGNED', { type: 'send' }, signed).ok, false);
  assert.deepEqual(patientSignatureTransition('AWAITING', { type: 'verbal', obtainedBy: 'Clinician A' }, signed), { ok: true, next: 'VERBAL' });
  assert.equal(patientSignatureTransition('NOT_SENT', { type: 'verbal', obtainedBy: 'Clinician A' }, { clinicianSigned: false }).ok, false);
  assert.deepEqual(patientSignatureTransition('SIGNED', { type: 'void' }, signed), { ok: true, next: 'NOT_SENT' });
});

// ─── Template integrity ─────────────────────────────────────────────────────

test('templates are registered with the clinic’s names and Valant aliases', () => {
  for (const type of [THERAPY_INTAKE, SUD_INTAKE, THERAPY_PROGRESS]) {
    assert.ok((NOTE_TYPES as readonly string[]).includes(type));
    assert.equal(asStructuredNoteType(type), type);
    assert.ok(isTherapyTemplate(type));
    assert.deepEqual([...NOTE_SECTIONS[type]], templateHeadings(type), `${type}: sections.ts and template definition agree`);
    for (const alias of THERAPY_NOTE_ALIASES[type]) assert.equal(normalizeNoteType(alias), type, alias);
  }
  assert.equal(NOTE_LABELS[THERAPY_INTAKE], 'MD Therapy Adult & Child Intake');
  assert.equal(NOTE_LABELS[SUD_INTAKE], 'Substance Abuse Intake');
  assert.equal(NOTE_LABELS[THERAPY_PROGRESS], 'Therapy Progress Adult & Child');
  assert.deepEqual(THERAPY_NOTE_LABELS[THERAPY_INTAKE], NOTE_LABELS[THERAPY_INTAKE]);
  assert.equal(normalizeNoteType('Substance Abuse'), 'SUD', 'existing SUD alias unchanged');
  assert.ok(isSudNote(SUD_INTAKE), 'Substance Abuse Intake is Part 2');
  assert.ok(!isSudNote(THERAPY_INTAKE));
  assert.deepEqual(TEMPLATE_CONFIG[THERAPY_PROGRESS].codeOptions.map((o) => o.code).sort(), ['90832', '90834', '90837', '90846', '90847']);
  assert.deepEqual(TEMPLATE_CONFIG[THERAPY_INTAKE].codeOptions.map((o) => o.code), ['90791']);
  assert.deepEqual(TREATMENT_PLAN_TEMPLATE.map((s) => s.heading), [...TREATMENT_PLAN_SECTIONS]);
});

test('field ids are unique per template and labels unique per section', () => {
  for (const tpl of [...Object.values(THERAPY_TEMPLATES).map((t) => t.sections), TREATMENT_PLAN_TEMPLATE]) {
    const ids = tpl.flatMap((s) => s.fields.map((f) => f.id));
    // Shared sections (e.g. psychiatric history) appear once per template
    assert.equal(new Set(ids).size, ids.length, `duplicate field id: ${ids.filter((x, i) => ids.indexOf(x) !== i)}`);
    for (const s of tpl) {
      const labels = s.fields.map((f) => f.label);
      assert.equal(new Set(labels).size, labels.length, `${s.heading}: duplicate label`);
      for (const f of s.fields) {
        if (f.when?.field) assert.ok(fieldIndex(tpl).has(f.when.field), `${f.id}: condition on unknown field ${f.when.field}`);
      }
    }
  }
});

test('only billing / compliance items are required', () => {
  const required = (type: keyof typeof THERAPY_TEMPLATES) =>
    THERAPY_TEMPLATES[type].sections.flatMap((s) => s.fields.filter((f) => f.required).map((f) => f.id)).sort();
  assert.deepEqual(required(THERAPY_PROGRESS), ['cssrs', 'hi', 'interval', 'modalitiesUsed', 'nextSession', 'patientLocation', 'planGoals', 'responseText', 'riskLevel', 'si', 'telehealthConsent'].sort());
  assert.ok(required(SUD_INTAKE).includes('part2Consent'));
  assert.ok(required(SUD_INTAKE).includes('substanceTable'));
  assert.ok(required(SUD_INTAKE).includes('asam'));
  assert.ok(required(THERAPY_INTAKE).includes('diagnoses'));
  assert.ok(required(THERAPY_INTAKE).includes('consentBy'), 'minor consent is required (shown only under 18)');
});

const noteBody = (type: keyof typeof THERAPY_TEMPLATES, texts: Record<string, string>) =>
  THERAPY_SECTIONS[type].map((h) => `${h}\n${texts[h] || ''}`).join('\n\n');

function sessionText(opts: { telehealth?: boolean; age?: number; start?: string; end?: string; progress?: boolean; code: string; minutes: number }) {
  return renderSessionBlock({
    patientName: 'Test Client',
    dateOfBirth: opts.age != null ? `${2026 - opts.age - 1}-01-01T00:00:00.000Z` : null,
    mrn: 'MRN-1',
    dateOfService: TODAY,
    providerName: 'Test Clinician',
    providerRole: 'Therapist',
    providerCredentials: ['LCPC'],
    providerNpi: null,
    location: 'Bowie',
    visitChosen: true,
    telehealth: Boolean(opts.telehealth),
    placeOfService: '10',
    startTime: opts.start ?? '10:00',
    endTime: opts.end ?? '10:53',
    durationMinutes: opts.minutes,
    sessionType: opts.progress ? 'individual' : null,
    cptCode: opts.code,
    timeRule: Boolean(opts.progress),
  });
}

function completeProgressTexts(over: Record<string, string> = {}, telehealth = false): Record<string, string> {
  const tpl = THERAPY_TEMPLATES[THERAPY_PROGRESS];
  const ctx = { minor: false, telehealth };
  const values: Values = {
    personsPresent: 'client',
    ...(telehealth ? { patientLocation: 'home, Bowie MD', telehealthConsent: 'Verbal consent obtained' } : {}),
    symptomStatus: 'Improved',
    interval: 'Client reports fewer panic episodes this week.',
    modalitiesUsed: ['CBT'],
    si: 'Denies',
    hi: 'Denies',
    riskLevel: 'Low',
    engagement: 'Engaged',
    responseText: 'Practiced cognitive restructuring; identified two thoughts.',
    nextSession: '1 week',
  };
  const widgets = {
    session: sessionText({ progress: true, code: '90837', minutes: 53, telehealth }),
    planGoals: renderPlanGoals(
      { id: 'plan-1', title: 'Treatment Plan', signedAt: '2026-10-01T15:00:00Z', reviewDueAt: '2027-01-01', goals: [{ id: 'G1', text: 'Fewer panic attacks', objectives: [] }] },
      { G1: { status: 'Progress made', note: 'two episodes vs five' } },
      { planLoaded: true }
    ),
    mse: renderMse(EMPTY_MSE_VALUE),
  };
  const texts: Record<string, string> = {};
  for (const s of tpl.sections) texts[s.heading] = renderSection(s, values, ctx, widgets);
  return { ...texts, ...over };
}

test('a complete progress note signs; an empty one lists what is missing', () => {
  const ok = structuredSignBlockers({ noteType: THERAPY_PROGRESS, body: noteBody(THERAPY_PROGRESS, completeProgressTexts()), cptCode: '90837', durationMinutes: 53 });
  assert.deepEqual(ok, []);
  const empty = structuredSignBlockers({ noteType: THERAPY_PROGRESS, body: noteBody(THERAPY_PROGRESS, {}), cptCode: '', durationMinutes: null });
  const messages = empty.map((b) => b.message).join('\n');
  assert.match(messages, /Choose the Service code/);
  assert.match(messages, /Goal progress is required/);
  assert.match(messages, /Interventions used is required/);
  assert.match(messages, /Suicidal ideation is required/);
  assert.match(messages, /Response to interventions is required/);
});

test('telehealth progress notes need patient location and consent', () => {
  const texts = completeProgressTexts({}, true);
  assert.deepEqual(structuredSignBlockers({ noteType: THERAPY_PROGRESS, body: noteBody(THERAPY_PROGRESS, texts), cptCode: '90837', durationMinutes: 53 }), []);
  const session = texts[TS.session].split('\n').filter((l) => !l.startsWith('Patient location during telehealth')).join('\n');
  const blocked = therapySignBlockers({ type: THERAPY_PROGRESS, body: noteBody(THERAPY_PROGRESS, { ...texts, [TS.session]: session }), cptCode: '90837', durationMinutes: 53 });
  assert.ok(blocked.some((b) => /Patient location during telehealth/.test(b.message)));
});

test('SI endorsed needs the C-SSRS; positive C-SSRS or High risk needs a safety plan', () => {
  const texts = completeProgressTexts();
  const withSi = { ...texts, [TS.riskCheck]: 'Suicidal ideation: Endorses — passive\nHomicidal ideation: Denies\nOverall risk level: Moderate' };
  assert.ok(therapySignBlockers({ type: THERAPY_PROGRESS, body: noteBody(THERAPY_PROGRESS, withSi), cptCode: '90837', durationMinutes: 53 }).some((b) => /C-SSRS screener is required/.test(b.message)));
  const positive = `${SI_POSITIVE_LINE} — high risk by the C-SSRS algorithm.\nOverall risk level: High`;
  assert.equal(riskBlockers(positive, TS.riskCheck).length, 1);
  const plan = renderSafetyPlan({ fields: { ...EMPTY_SAFETY_PLAN, warningSigns: 'isolating', professionals: '988' }, notIndicated: false, sourceNote: '' });
  assert.deepEqual(riskBlockers(`${positive}\n${plan}`, TS.riskCheck), []);
  assert.deepEqual(riskBlockers('Overall risk level: Low', TS.riskCheck), []);
});

test('child-only fields are required only for minors (age read from the note)', () => {
  const tpl = THERAPY_TEMPLATES[THERAPY_INTAKE];
  const adult = missingFields(tpl.sections, (h) => (h === TS.session ? sessionText({ code: '90791', minutes: 60, age: 30 }) : ''), TS.session);
  assert.ok(!adult.required.some((i) => /Consent for treatment given by/.test(i.message)));
  const child = missingFields(tpl.sections, (h) => (h === TS.session ? sessionText({ code: '90791', minutes: 60, age: 12 }) : ''), TS.session);
  assert.ok(child.required.some((i) => /Consent for treatment given by/.test(i.message)));
});

test('a reopened draft gets its chips back without duplicating text', () => {
  const tpl = THERAPY_TEMPLATES[THERAPY_PROGRESS];
  const texts = completeProgressTexts();
  texts[TS.interventions] = `${texts[TS.interventions]}\n\nWorked on breathing.`;
  const { values, leftover } = restoreValues(tpl.sections, texts);
  assert.deepEqual(values.modalitiesUsed, ['CBT']);
  assert.equal(values.si, 'Denies');
  assert.equal(values.nextSession, '1 week');
  assert.equal(values.responseText, 'Practiced cognitive restructuring; identified two thoughts.');
  assert.equal(leftover[TS.interventions], 'Worked on breathing.');
  // Re-rendering the restored values reproduces the field lines
  assert.equal(renderSection(tpl.sections.find((s) => s.heading === TS.planNext)!, values, { minor: false, telehealth: false }, {}), texts[TS.planNext]);
});

test('ASAM ratings give a labeled suggestion only when all six are rated', () => {
  assert.equal(asamSuggestion({ 1: { rating: '1', note: '' } }), null);
  const all = Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [n, { rating: '1', note: '' }]));
  assert.equal(asamSuggestion(all), 'Level 1 Outpatient');
  assert.match(asamSuggestion({ ...all, 1: { rating: '3', note: '' } })!, /withdrawal management/);
});

// ─── Carry-forward: intake → treatment plan ─────────────────────────────────

test('a signed intake pre-fills the treatment plan (diagnoses, goals, frequency, strengths)', () => {
  const tpl = THERAPY_TEMPLATES[THERAPY_INTAKE];
  const values: Values = {
    presentingProblem: 'I can’t stop worrying.',
    strengths: ['Insight', 'Family support'],
    levelOfCare: 'Outpatient therapy',
    frequency: 'Weekly',
    initialGoals: { none: false, rows: [{ goal: 'Worry less at work', target: '90 days' }, { goal: 'Sleep through the night', target: '' }] },
  };
  const widgets = { diagnoses: renderDiagnoses([{ code: 'F41.1', description: 'Generalized anxiety disorder', isPrimary: true, fromChart: true }]) };
  const texts: Record<string, string> = {};
  for (const s of tpl.sections) texts[s.heading] = renderSection(s, values, { minor: false, telehealth: false }, widgets);
  const prefill = prefillFromIntakeBody({ noteId: 'n1', noteType: THERAPY_INTAKE, date: TODAY, body: noteBody(THERAPY_INTAKE, texts) });
  assert.deepEqual(prefill.diagnoses, [{ code: 'F41.1', description: 'Generalized anxiety disorder', isPrimary: true }]);
  assert.deepEqual(prefill.goals, ['Worry less at work', 'Sleep through the night']);
  assert.equal(prefill.frequency, 'Weekly');
  assert.equal(prefill.strengths, 'Insight, Family support');
  assert.equal(prefill.presentingProblem, 'I can’t stop worrying.');
  const planValues = initialPlanValues({ kind: 'Initial', intake: prefill, priorValues: null, reviewDate: '2027-04-15' });
  assert.equal(planValues.tpFrequency, 'Weekly');
  assert.equal(planGoals(planValues)[0].goal, 'Worry less at work');
  assert.equal(planFieldsFromValues(planValues).clinicalDetails.serviceFrequency, 'Weekly', 'feeds session-frequency tracking');
  assert.ok(planCareSchema.safeParse(planFieldsFromValues(planValues).clinicalDetails).success, 'session-frequency engine accepts the plan care block');
  assert.equal(planFieldsFromValues({ diagnoses: [{ code: 'F10.20', description: 'Alcohol use disorder', isPrimary: true }] }).clinicalDetails.planType, 'Substance Use Disorder (SUD)');
});

function completePlanValues(): Values {
  const goal = emptyTpGoal('G1', 'Worry less at work');
  goal.objectives = [{ text: 'Use a coping skill 3 times per week', targetDate: '2027-01-15' }];
  goal.interventions = [{ type: 'CBT', detail: 'worry exposure', frequency: 'Weekly', responsible: 'Therapist' }];
  return {
    planKind: 'Initial',
    serviceSetting: 'In person — on site',
    startDate: '2026-10-17',
    diagnoses: [{ code: 'F41.1', description: 'Generalized anxiety disorder', isPrimary: true }],
    presentingNeeds: 'Daily worry affecting work.',
    tpStrengths: 'Motivated; supportive partner.',
    // Goals saved flat before the Problem level are read into one problem; the problem is named here
    tpProblems: problemsFromLegacyGoals([goal]).map((p) => ({ ...p, text: 'Anxiety' })),
    tpFrequency: 'Weekly',
    dischargeGoals: ['Improvement in symptoms'],
    reviewDate: '2027-04-15',
    clientParticipated: 'Yes',
  };
}

test('treatment plan sign rules: measurable objectives with target dates, interventions, blanks', () => {
  const ctx = { minor: false, telehealth: false };
  assert.deepEqual(treatmentPlanBlockers(completePlanValues(), ctx), []);
  const noDate = completePlanValues();
  (noDate.tpProblems as PlanProblem[])[0].goals[0].objectives[0].targetDate = '';
  assert.ok(treatmentPlanBlockers(noDate, ctx).some((b) => /target date/.test(b.message)));
  const blank = completePlanValues();
  (blank.tpProblems as PlanProblem[])[0].goals[0].objectives[0].text = 'Reduce [___] score';
  assert.ok(treatmentPlanBlockers(blank, ctx).some((b) => /\[___\]/.test(b.message)));
  assert.ok(treatmentPlanBlockers(completePlanValues(), { minor: true, telehealth: false }).some((b) => /Caregiver participated/.test(b.message)));
  const review = { ...completePlanValues(), planKind: 'Review' };
  assert.ok(treatmentPlanBlockers(review, ctx).some((b) => /rate progress/.test(b.message)));
});

test('review copies goals forward with progress reset; sanitize drops unknown keys', () => {
  const prior = completePlanValues();
  (prior.tpProblems as PlanProblem[])[0].goals[0].progress = 'Moderate';
  const review = initialPlanValues({ kind: 'Review', intake: null, priorValues: prior, reviewDate: '2027-07-01' });
  assert.equal(review.planKind, 'Review');
  assert.equal(planGoals(review)[0].goal, 'Worry less at work');
  assert.equal(planGoals(review)[0].progress, '');
  const clean = sanitizePlanValues({ ...completePlanValues(), evil: '<script>', serviceSetting: 'In person — on site' });
  assert.equal('evil' in clean, false);
  assert.equal(clean.serviceSetting, 'In person — on site');
});

test('the signed plan text shows goals, objectives with dates and interventions', () => {
  const text = renderTreatmentPlanText(completePlanValues(), { minor: false, telehealth: false }, { clientName: 'Test Client', dateOfBirth: null, age: null, planDate: TODAY, clinicianName: 'Test Clinician' });
  assert.match(text, /^Treatment Plan\nPatient: Test Client/);
  assert.match(text, /Problem 1: Anxiety/);
  assert.match(text, /Goal 1: Worry less at work/);
  assert.match(text, /Objective 1\.1: Use a coping skill 3 times per week \(target 2027-01-15\)/);
  assert.match(text, /Intervention: CBT: worry exposure — Frequency: Weekly — by Therapist/);
  assert.match(renderTpGoals([], { review: false }), /^$/);
});

test('review interval defaults: child 90 days, adult from Practice Settings (180 default)', () => {
  assert.equal(defaultReviewDays(12, 180), 90);
  assert.equal(defaultReviewDays(40, 180), 180);
  assert.equal(defaultReviewDays(40, null), 180);
  assert.equal(defaultReviewDays(40, 60), 60);
  assert.equal(defaultReviewDays(12, 60), 60);
  assert.equal(defaultReviewDays(null, 999), 180, 'out-of-range setting ignored');
});
