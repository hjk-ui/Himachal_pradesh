import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBlankPlan, normalizePlan } from '../src/features/ehr/safetyPlansData';
import { NOTE_LABELS, NOTE_SECTIONS, NOTE_TYPES, normalizeNoteType, noteTypeBadge, structuredNoteSections } from '../src/lib/ehr/noteTemplates';
import { EMPTY_MSE_VALUE } from '../src/components/clinical/MentalStatusExamWidget';
import {
  PMM,
  PSYCH_MED_MGMT,
  EMPTY_SAFETY_PLAN,
  SI_QUESTIONS,
  isControlledSubstance,
  parseChartDiagnoses,
  renderHeader,
  renderLabs,
  renderMedChanges,
  renderMse,
  renderSafetyPlan,
  renderSideEffects,
  renderSiScreen,
  safetyPlanToFields,
  siScreenStatus,
  summarizeMeasures,
  type MedChangeRow,
} from '../src/lib/ehr/psychMedMgmt';
import {
  CHILD_PSYCH_INITIAL_INTAKE,
  CHILD_PSYCH_INTAKE,
  CPI,
  CPI_CARRY_FORWARD,
  addOnAllowed,
  mensesApplies,
  renderFamilyGrid,
  renderHistoryItem,
  renderOverallRisk,
  renderRos,
  renderRows,
  INPATIENT_FIELDS,
  parseIntakeHeader,
  childHeaderLines,
} from '../src/lib/ehr/childPsychIntake';
import {
  ADULT_PSYCH_INTAKE,
  API,
  ADULT_DEFAULT_INFORMANTS,
  EMPTY_ADULT_DEV,
  EMPTY_ADULT_MENSES,
  adultHeaderLines,
  pregnancyCaution,
  renderAdultDevelopmental,
  renderAdultMenses,
} from '../src/lib/ehr/adultPsychIntake';
import {
  ADULT_PSYCH_REEVAL,
  APR,
  APR_BRING_FORWARD_ALL,
  INTERVAL_DOMAINS,
  REEVAL_SOURCE_TYPES,
  priorEvalHeaderLine,
  priorEvalReference,
  renderIntervalChanges,
  renderMeasuresSinceEval,
  summarizeMeasuresSinceEval,
} from '../src/lib/ehr/adultPsychReEval';
import { CHILD_INTERVAL_DOMAINS, CHILD_PSYCH_REEVAL, CHILD_REEVAL_SOURCE_TYPES, CPR_BRING_FORWARD_ALL } from '../src/lib/ehr/childPsychReEval';
import {
  TEMPLATE_CONFIG,
  asStructuredNoteType,
  priorEvalSourceTypesFor,
  bringForwardAll,
  broughtForwardBlock,
  countPendingCarryForward,
  markReviewedNoChanges,
  structuredSignBlockers,
} from '../src/lib/ehr/structuredNotes';
import { AI_DRAFT_MARKER } from '../src/lib/ai/noteDraftFormats';

const compose = (type: string, texts: Record<string, string>) =>
  NOTE_SECTIONS[type as keyof typeof NOTE_SECTIONS].map((h) => `${h}\n${texts[h] || ''}`).join('\n\n');

test('Psych Med Mgmt sections follow Valant template 21774 order', () => {
  assert.ok(NOTE_TYPES.includes(PSYCH_MED_MGMT));
  assert.ok(NOTE_TYPES.includes('Med Mgmt'), 'existing Med Mgmt type kept');
  assert.deepEqual([...NOTE_SECTIONS[PSYCH_MED_MGMT]], [
    'Header',
    'History of Present Illness/Interval History',
    'Free Form Content',
    'Exam',
    'Measure Review',
    'Suicidal Ideation',
    'Suicide Prevention Plan',
    'Assessment - Diagnoses',
    'Meds & Allergies',
    'Side Effects',
    'Lab Results',
    'Plan - Labs Ordered',
    'Plan',
    'Plan - Med Changes',
    'Plan - Next Appointment',
    'Review',
  ]);
  assert.equal(normalizeNoteType('Psychiatric Med Management'), PSYCH_MED_MGMT);
});

test('Child Psych Intake sections follow Valant template 46444 order', () => {
  const s = NOTE_SECTIONS[CHILD_PSYCH_INTAKE];
  assert.equal(s[0], 'Header');
  assert.equal(s[s.length - 1], 'Review');
  assert.ok(s.indexOf('Patient Allergies') + 1 === s.indexOf('Substance Use Hx'), 'no placeholder between allergies and substance use');
  assert.ok(s.indexOf('Trauma/Stressors') + 1 === s.indexOf('Stressors'));
  assert.ok(s.indexOf('Review of Systems') < s.indexOf('Exam'));
  assert.equal(new Set(s).size, s.length, 'headings are unique');
  assert.equal(normalizeNoteType('Child Psychiatry Intake / Re-Eval'), CHILD_PSYCH_INTAKE);
  assert.equal(asStructuredNoteType('Child Psych Intake'), CHILD_PSYCH_INTAKE);
  assert.equal(asStructuredNoteType('SOAP'), null);
});

test('composed body round-trips through structuredNoteSections for both templates', () => {
  for (const type of [PSYCH_MED_MGMT, CHILD_PSYCH_INITIAL_INTAKE, CHILD_PSYCH_INTAKE, ADULT_PSYCH_INTAKE, ADULT_PSYCH_REEVAL]) {
    const texts = Object.fromEntries(NOTE_SECTIONS[type].map((h, i) => [h, `content ${i}\n- line two`]));
    const parsed = structuredNoteSections(type, compose(type, texts));
    assert.equal(parsed.length, NOTE_SECTIONS[type].length);
    for (const p of parsed) assert.equal(p.text, texts[p.title]);
  }
});

test('header never defaults visit type, code or missing demographics', () => {
  const h = renderHeader({
    patientName: 'Test Patient',
    dateOfBirth: null,
    mrn: null,
    dateOfService: '2026-10-16',
    providerName: 'Dr. A',
    providerRole: 'Psychiatrist',
    providerCredentials: [],
    providerNpi: null,
    location: '',
    visitType: '',
    placeOfService: null,
    durationMinutes: null,
    emCode: '',
    addOnCode: '',
  });
  assert.match(h, /DOB: None on file/);
  assert.match(h, /MRN: None on file/);
  assert.match(h, /Visit type: Not selected/);
  assert.match(h, /E\/M code: Not selected/);
  assert.match(h, /Source:/);
});

test('empty MSE renders nothing (no normal findings by default)', () => {
  assert.equal(renderMse(EMPTY_MSE_VALUE), '');
  assert.match(renderMse({ ...EMPTY_MSE_VALUE, mood: 'Anxious' }), /Mood: Anxious/);
});

test('SI screen: positive on any yes, negative only when all answered no', () => {
  assert.equal(siScreenStatus({}), 'not-started');
  assert.equal(siScreenStatus({ q1: 'no' }), 'incomplete');
  assert.equal(siScreenStatus({ q2: 'yes' }), 'positive');
  const allNo = Object.fromEntries(SI_QUESTIONS.map((q) => [q.id, 'no' as const]));
  assert.equal(siScreenStatus(allNo), 'negative');
  assert.match(renderSiScreen({ answers: { q2: 'yes' }, timeframe: 'since last visit', crisisResourcesReviewed: false }), /C-SSRS screen result: POSITIVE/);
  assert.equal(renderSiScreen({ answers: {}, timeframe: 'x', crisisResourcesReviewed: false }), '');
});

test('sign blockers: CPT required, positive SI needs a safety plan', () => {
  const si = renderSiScreen({ answers: { q1: 'yes' }, timeframe: 'since last visit', crisisResourcesReviewed: true });
  const noPlan = compose(PSYCH_MED_MGMT, { [PMM.si]: si });
  const b1 = structuredSignBlockers({ noteType: PSYCH_MED_MGMT, body: noPlan, cptCode: '' });
  assert.ok(b1.some((b) => /E\/M code/.test(b.message) && b.heading === 'Header'));
  assert.ok(b1.some((b) => b.heading === PMM.safetyPlan));

  const notIndicated = compose(PSYCH_MED_MGMT, {
    [PMM.si]: si,
    [PMM.safetyPlan]: renderSafetyPlan({ fields: EMPTY_SAFETY_PLAN, notIndicated: true, sourceNote: '' }),
  });
  assert.ok(structuredSignBlockers({ noteType: PSYCH_MED_MGMT, body: notIndicated, cptCode: '99214' }).some((b) => b.heading === PMM.safetyPlan));

  const withPlan = compose(PSYCH_MED_MGMT, {
    [PMM.si]: si,
    [PMM.safetyPlan]: renderSafetyPlan({ fields: { ...EMPTY_SAFETY_PLAN, warningSigns: 'isolating' }, notIndicated: false, sourceNote: '' }),
  });
  assert.deepEqual(structuredSignBlockers({ noteType: PSYCH_MED_MGMT, body: withPlan, cptCode: '99214' }), []);
});

test('sign blockers: blanks, AI markers and unreviewed brought-forward text', () => {
  const body = compose(PSYCH_MED_MGMT, { [PMM.hpi]: `${AI_DRAFT_MARKER}\nmood [___]`, [PMM.plan]: broughtForwardBlock('2026-09-01', 'continue therapy') });
  const msgs = structuredSignBlockers({ noteType: PSYCH_MED_MGMT, body, cptCode: '99213' });
  assert.ok(msgs.some((b) => /blank/.test(b.message) && b.heading === PMM.hpi));
  assert.ok(msgs.some((b) => /AI DRAFT/.test(b.message)));
  assert.ok(msgs.some((b) => b.heading === PMM.plan && /review/.test(b.message)));
  assert.deepEqual(structuredSignBlockers({ noteType: 'SOAP', body, cptCode: '' }), [], 'non-structured types untouched');
});

test('carry-forward: bring forward then "Reviewed, no changes" clears the pending marker', () => {
  const prior = '(from 2026-01-02 — reviewed, no changes)\nHospitalized 2024 at Sheppard Pratt';
  const brought = broughtForwardBlock('2026-09-01', prior);
  assert.equal(brought, '(from 2026-09-01 — review)\nHospitalized 2024 at Sheppard Pratt', 'old markers stripped');
  assert.equal(countPendingCarryForward(brought), 1);
  const reviewed = markReviewedNoChanges(brought, '2026-09-01', prior);
  assert.equal(countPendingCarryForward(reviewed), 0);
  assert.match(reviewed, /reviewed, no changes/);
  const direct = markReviewedNoChanges('', '2026-09-01', prior);
  assert.match(direct, /^\(from 2026-09-01 — reviewed, no changes\)\nHospitalized/);
});

test('child intake: high overall risk requires a safety plan or reference', () => {
  const high = renderOverallRisk({ level: 'High', rationale: 'recent attempt', safetyPlanBlock: '', safetyPlanReference: '' });
  const body = compose(CHILD_PSYCH_INTAKE, { [CPI.protectiveFactors]: high });
  assert.ok(structuredSignBlockers({ noteType: CHILD_PSYCH_INTAKE, body, cptCode: '90792' }).some((b) => b.heading === CPI.protectiveFactors));
  const withRef = renderOverallRisk({ level: 'High', rationale: 'recent attempt', safetyPlanBlock: '', safetyPlanReference: 'Updated in Safety Plans today' });
  assert.deepEqual(structuredSignBlockers({ noteType: CHILD_PSYCH_INTAKE, body: compose(CHILD_PSYCH_INTAKE, { [CPI.protectiveFactors]: withRef }), cptCode: '90792' }), []);
  const low = renderOverallRisk({ level: 'Low', rationale: '', safetyPlanBlock: '', safetyPlanReference: '' });
  assert.deepEqual(structuredSignBlockers({ noteType: CHILD_PSYCH_INTAKE, body: compose(CHILD_PSYCH_INTAKE, { [CPI.protectiveFactors]: low }), cptCode: '90792' }), []);
  assert.equal(addOnAllowed('90792'), false);
  assert.equal(addOnAllowed('99214'), true);
});

test('child intake renderers write only what was chosen', () => {
  assert.equal(renderHistoryItem('Abuse history', { answer: '', types: [], details: '' }), '');
  assert.equal(renderHistoryItem('Abuse history', { answer: 'Denies', types: [], details: 'ignored' }), 'Abuse history: Denies.');
  assert.match(renderHistoryItem('Abuse history', { answer: 'Endorses', types: ['Physical'], details: 'age 8' }), /Endorses — Physical\.\nDetails: age 8/);
  assert.equal(renderRows(INPATIENT_FIELDS, { none: false, rows: [{}] }), '');
  assert.equal(renderRows(INPATIENT_FIELDS, { none: true, rows: [] }), 'None reported.');
  assert.match(renderRows(INPATIENT_FIELDS, { none: false, rows: [{ facility: 'X', _source: 'chart' }] }), /- Facility: X \[chart\]/);
  assert.equal(renderFamilyGrid({ cells: {}, none: false, unknown: false, otherCondition: '' }), '');
  assert.match(renderFamilyGrid({ cells: { ADHD: ['Father'] }, none: false, unknown: false, otherCondition: '' }), /ADHD: Father/);
  assert.equal(renderRos({}), '');
  assert.match(renderRos({ Skin: { value: 'Positive', comment: 'acne' }, Eyes: { value: 'Negative', comment: '' } }), /Positive: Skin \(acne\)\nNegative: Eyes/);
  assert.equal(mensesApplies('Male'), false);
  assert.equal(mensesApplies('female'), true);
  assert.equal(mensesApplies(null), true);
});

test('measure summary: latest vs previous with change', () => {
  const rows = summarizeMeasures([
    { instrument: 'PHQ-9', score: 18, severity: 'Moderately Severe', date: '2026-08-01', source: 'a' },
    { instrument: 'PHQ-9', score: 11, severity: 'Moderate', date: '2026-10-01', source: 'a' },
    { instrument: 'GAD-7', score: 9, severity: 'Mild', date: '2026-09-15', source: 'a' },
  ]);
  assert.equal(rows[0].instrument, 'PHQ-9');
  assert.equal(rows[0].latest.score, 11);
  assert.equal(rows[0].change, -7);
  assert.equal(rows[1].previous, null);
});

test('chart helpers: diagnoses parse, controlled detection, labs, side effects', () => {
  const dx = parseChartDiagnoses({ primaryCode: 'f33.1', primaryName: 'MDD, recurrent, moderate', secondary: 'F41.1 - GAD, F90.2' });
  assert.deepEqual(dx.map((d) => d.code), ['F33.1', 'F41.1', 'F90.2']);
  assert.ok(dx.every((d) => d.fromChart));
  assert.equal(isControlledSubstance('Adderall XR 20 mg'), true);
  assert.equal(isControlledSubstance('sertraline'), false);
  assert.equal(isControlledSubstance('Unknown', 'IV'), true);
  assert.equal(renderLabs([], true), 'Lab results: None on file');
  assert.equal(renderSideEffects({ state: {}, otherLabel: '', noneReported: false }), '');
  assert.equal(renderSideEffects({ state: { Sedation: { rating: 'None', comment: '' } }, otherLabel: '', noneReported: true }), 'No side effects reported by patient.');
});

test('med changes: PDMP reminder never claims a review unless attested', () => {
  const row: MedChangeRow = { key: 'a', medId: null, name: 'lorazepam', currentDose: '', action: 'Start', newDose: '0.5 mg', sig: 'BID PRN', reason: 'panic', controlled: true };
  const text = renderMedChanges({ rows: [row], pdmpReviewed: false });
  assert.match(text, /Start lorazepam 0\.5 mg; sig: BID PRN; reason: panic/);
  assert.match(text, /not documented in this note/);
  assert.match(renderMedChanges({ rows: [row], pdmpReviewed: true }), /Prescriber attests/);
  assert.equal(renderMedChanges({ rows: [{ ...row, action: '' }], pdmpReviewed: false }), '');
});

test('saved safety plan maps onto Stanley-Brown fields', () => {
  const f = safetyPlanToFields({
    steps: [{ id: 1, content: 'Isolating' }, { id: 6, content: 'Lock meds' }],
    helpContacts: [{ name: 'Aunt May', relationship: 'aunt', phone: '555' }],
    meansItems: [{ label: 'Firearms removed', done: true }, { label: 'x', done: false }],
  });
  assert.equal(f.warningSigns, 'Isolating');
  assert.equal(f.helpContacts, 'Aunt May (aunt) 555');
  assert.equal(f.meansRestriction, 'Lock meds; Completed: Firearms removed');
  assert.equal(f.internalCoping, '');
});

test('safety plans: missing PHQ-9 / GAD-7 / risk / dates stay missing (never defaulted or derived)', () => {
  const legacy = normalizePlan({ id: 'sp-1', clientName: 'Pat Doe' });
  assert.equal(legacy.phq9, null);
  assert.equal(legacy.gad7, null);
  assert.equal(legacy.risk, null);
  assert.equal(legacy.createdAt, '');
  assert.equal(legacy.lastUpdated, '');
  assert.equal(legacy.lastReviewed, '');

  // Real stored values are kept; GAD-7 is never derived from PHQ-9.
  const stored = normalizePlan({ id: 'sp-2', clientName: 'Pat Doe', phq9: 0, risk: 'High', lastUpdated: '2026-09-01' });
  assert.equal(stored.phq9, 0);
  assert.equal(stored.gad7, null);
  assert.equal(stored.risk, 'High');
  assert.equal(stored.lastUpdated, '2026-09-01');

  const blank = createBlankPlan({ id: 'sp-3', clientName: 'Pat Doe', clinician: '' });
  assert.equal(blank.phq9, null);
  assert.equal(blank.gad7, null);
  assert.equal(blank.risk, null);
  assert.ok(!blank.crisisResources.some((r) => r.label === 'My Clinician'), 'no empty clinician contact line');
});

test('Adult Psych Intake sections follow Valant template 18771 order', () => {
  assert.ok(NOTE_TYPES.includes(ADULT_PSYCH_INTAKE));
  assert.deepEqual([...NOTE_SECTIONS[ADULT_PSYCH_INTAKE]], [
    'Header',
    'Identifying Information',
    'Chief Complaint',
    'HPI',
    'Inpatient Hx',
    'Outpatient Hx',
    'Suicide/Self-Harm Hx',
    'Psychiatric Med Hx',
    'Abuse',
    'Past Medical Hx',
    'Menstruation and Pregnancy Hx',
    'Patient Allergies',
    'Substance Use Hx',
    'Substance Use Consequences',
    'Substance Treatment Hx',
    'Family Hx',
    'Family Relationships',
    'Developmental and Educational Hx',
    'General Social Hx',
    'Legal History',
    'Violence Hx',
    'Stressors',
    'Review of Systems',
    'Exam',
    'Assessment - Sources of Risk',
    'Suicide Risk Factors',
    'Suicide Protective Factors',
    'Assessment - Diagnoses',
    'Meds & Allergies',
    'Plan',
    'Plan - Med Changes',
    'Plan - Next Appointment',
    'Review',
  ]);
  const s = NOTE_SECTIONS[ADULT_PSYCH_INTAKE];
  assert.ok(!s.includes(CPI.interval), 'no interval-history section (HPI only)');
  assert.ok(!s.includes(CPI.trauma), 'no Trauma/Stressors section (trauma lives in Stressors)');
  for (const h of Object.values(API)) assert.ok(s.includes(h), `API heading ${h} is a section`);
  assert.equal(normalizeNoteType('Adult Psychiatry Intake'), ADULT_PSYCH_INTAKE);
  assert.equal(normalizeNoteType('MD Health - Adult Psychiatry Intake Note'), ADULT_PSYCH_INTAKE);
  assert.equal(asStructuredNoteType('Adult Psychiatry Intake'), ADULT_PSYCH_INTAKE);

  const cfg = TEMPLATE_CONFIG[ADULT_PSYCH_INTAKE];
  assert.deepEqual([...cfg.aiSections], [API.hpi], 'AI only for HPI');
  assert.ok(cfg.carryForward.includes(API.stressors) && !cfg.carryForward.includes(API.hpi));
  assert.ok(cfg.codeOptions.length > 0);
  for (const o of cfg.codeOptions) assert.ok(['90792', '99204', '99205', '99214', '99215'].includes(o.code));
});

test('adult intake header: patient is the default history source, collateral optional, no guardian line', () => {
  assert.deepEqual(ADULT_DEFAULT_INFORMANTS, ['Patient']);
  const h = adultHeaderLines({ informants: ['Patient'], informantOther: '', collateralName: '', collateralRelationship: '' });
  assert.deepEqual(h, ['History obtained from: Patient']);
  const withCollateral = adultHeaderLines({ informants: ['Patient', 'Other'], informantOther: 'PCP letter', collateralName: 'Jane Roe', collateralRelationship: 'Spouse' });
  assert.deepEqual(withCollateral, ['History obtained from: Patient, Other (PCP letter)', 'Collateral contact: Jane Roe (Spouse)']);
  assert.ok(!withCollateral.some((l) => /Guardian|Evaluation type/.test(l)));
  // Reopening a draft restores what was saved (not the default)
  const parsed = parseIntakeHeader(['Patient: X', ...withCollateral].join('\n'));
  assert.deepEqual(parsed, { evalKind: '', informants: ['Patient', 'Other'], informantOther: 'PCP letter', contactName: 'Jane Roe', contactRelationship: 'Spouse' });
  assert.deepEqual(parseIntakeHeader('History obtained from: Not documented')?.informants, [], 'a draft with no source stays empty');
  const child = parseIntakeHeader(
    childHeaderLines({ evalKind: 'Re-evaluation', informants: ['Parent/guardian'], informantOther: '', guardianName: 'Ann Lee', guardianRelationship: 'Mother' }).join('\n')
  );
  assert.equal(child?.evalKind, 'Re-evaluation');
  assert.equal(child?.contactName, 'Ann Lee');
  assert.equal(child?.contactRelationship, 'Mother');
  assert.equal(parseIntakeHeader('Patient: X'), null);
});

test('adult intake renderers: developmental/educational and menstruation write only what was chosen', () => {
  assert.equal(renderAdultDevelopmental(EMPTY_ADULT_DEV), '');
  const dev = renderAdultDevelopmental({
    ...EMPTY_ADULT_DEV,
    childhood: 'Unknown / not reported',
    education: 'High school / GED',
    learning: 'Endorses',
    learningDetails: 'IEP for dyslexia',
    military: 'Yes',
    branch: 'Army',
    discharge: 'Honorable',
    combat: 'Yes',
    employment: 'Unemployed',
    occupation: 'Electrician',
  });
  assert.equal(
    dev,
    [
      'Childhood development: Unknown / not reported',
      'Highest education: High school / GED',
      'Learning disability / special education: Yes — IEP for dyslexia',
      'Military service: Yes (branch Army; discharge Honorable; combat exposure yes)',
      'Employment: Unemployed; occupation: Electrician',
    ].join('\n')
  );
  assert.equal(renderAdultDevelopmental({ ...EMPTY_ADULT_DEV, military: 'No', branch: 'ignored' }), 'Military service: No');

  assert.equal(renderAdultMenses(EMPTY_ADULT_MENSES), '');
  assert.equal(renderAdultMenses({ ...EMPTY_ADULT_MENSES, notApplicable: true, lmp: 'x' }), 'Not applicable.');
  const m = { ...EMPTY_ADULT_MENSES, lmp: '2026-10-01', pregnancy: 'Possibly pregnant' as const, breastfeeding: 'No' as const, contraception: 'IUD', menopause: 'Premenopausal' as const };
  assert.equal(renderAdultMenses(m), 'LMP: 2026-10-01\nPregnancy status: Possibly pregnant\nBreastfeeding: No\nContraception: IUD\nMenopausal status: Premenopausal');
  assert.equal(pregnancyCaution(m), true);
  assert.equal(pregnancyCaution({ ...m, pregnancy: 'Not pregnant' }), false);
  assert.equal(pregnancyCaution({ ...EMPTY_ADULT_MENSES, breastfeeding: 'Yes' }), true);
  // Menstruation section is hidden by default for male chart sex (same rule as the child note)
  assert.equal(mensesApplies('Male'), false);
  assert.equal(mensesApplies('M'), false);
  assert.equal(mensesApplies('Female'), true);
  assert.equal(mensesApplies(''), true, 'unknown sex shows the section');
  // Trauma exposure (inside Stressors) uses the same tri-state chips
  assert.equal(renderHistoryItem('Trauma exposure', { answer: 'Not assessed', types: [], details: '' }), 'Trauma exposure: Not assessed.');
});

test('adult intake sign rules: CPT, high risk needs safety plan, blanks, AI markers, carry-forward', () => {
  const empty = structuredSignBlockers({ noteType: ADULT_PSYCH_INTAKE, body: compose(ADULT_PSYCH_INTAKE, {}), cptCode: '' });
  assert.deepEqual(empty.map((b) => b.heading), ['Header']);
  assert.match(empty[0].message, /Service code/);
  assert.deepEqual(structuredSignBlockers({ noteType: ADULT_PSYCH_INTAKE, body: compose(ADULT_PSYCH_INTAKE, {}), cptCode: '90792' }), []);

  const high = renderOverallRisk({ level: 'High', rationale: 'recent attempt', safetyPlanBlock: '', safetyPlanReference: '' });
  const blocked = structuredSignBlockers({ noteType: ADULT_PSYCH_INTAKE, body: compose(ADULT_PSYCH_INTAKE, { [API.protectiveFactors]: high }), cptCode: '99205' });
  assert.ok(blocked.some((b) => b.heading === API.protectiveFactors && /safety plan/.test(b.message)));
  const withRef = renderOverallRisk({ level: 'High', rationale: 'recent attempt', safetyPlanBlock: '', safetyPlanReference: 'Updated in Safety Plans today' });
  assert.deepEqual(structuredSignBlockers({ noteType: ADULT_PSYCH_INTAKE, body: compose(ADULT_PSYCH_INTAKE, { [API.protectiveFactors]: withRef }), cptCode: '99205' }), []);

  const body = compose(ADULT_PSYCH_INTAKE, {
    [API.hpi]: `${AI_DRAFT_MARKER}\nlow mood for [___] months`,
    [API.stressors]: broughtForwardBlock('2026-09-01', 'Current stressors: Financial'),
  });
  const msgs = structuredSignBlockers({ noteType: ADULT_PSYCH_INTAKE, body, cptCode: '99214' });
  assert.ok(msgs.some((b) => /blank/.test(b.message) && b.heading === API.hpi));
  assert.ok(msgs.some((b) => /AI DRAFT/.test(b.message) && b.heading === API.hpi));
  assert.ok(msgs.some((b) => b.heading === API.stressors && /review/.test(b.message)));
  assert.equal(addOnAllowed('99205'), true);
  assert.equal(addOnAllowed('90792'), false);
});

// ─── Adult Psychiatry Re-Eval (Valant 22019) ────────────────────────────────

test('Adult Psych Re-Eval sections follow Valant template 22019 order', () => {
  assert.ok(NOTE_TYPES.includes(ADULT_PSYCH_REEVAL));
  assert.equal(NOTE_LABELS[ADULT_PSYCH_REEVAL], 'Adult Psychiatry Re-Eval');
  assert.deepEqual([...NOTE_SECTIONS[ADULT_PSYCH_REEVAL]], [
    'Header',
    'Identifying Information',
    'Chief Complaint',
    'HPI',
    'History of Present Illness/Interval History',
    'Inpatient Hx',
    'Outpatient Hx',
    'Suicide/Self-Harm Hx',
    'Psychiatric Med Hx',
    'Abuse',
    'Past Medical Hx',
    'Menstruation and Pregnancy Hx',
    'Patient Allergies',
    'Substance Use Hx',
    'Substance Use Consequences',
    'Substance Treatment Hx',
    'Family Hx',
    'Family Relationships',
    'Free Form Content',
    'Developmental and Educational Hx',
    'General Social Hx',
    'Legal History',
    'Violence Hx',
    'Stressors',
    'Review of Systems',
    'Exam',
    'Assessment - Sources of Risk',
    'Suicide Risk Factors',
    'Suicide Protective Factors',
    'Measure Review',
    'Assessment - Diagnoses',
    'Meds & Allergies',
    'Plan',
    'Plan - Med Changes',
    'Plan - Labs Ordered',
    'Plan - Next Appointment',
    'Review',
  ]);
  const s = NOTE_SECTIONS[ADULT_PSYCH_REEVAL];
  for (const h of Object.values(APR)) assert.ok(s.includes(h), `APR heading ${h} is a section`);
  // Reused headings are the same strings as the source templates
  assert.equal(APR.interval, CPI.interval);
  assert.equal(APR.freeForm, PMM.freeForm);
  assert.equal(APR.measures, PMM.measures);
  assert.equal(APR.labsOrdered, PMM.labsOrdered);
  // The 18771 adult intake keeps Substance Use Consequences after Substance Use Hx
  const a = NOTE_SECTIONS[ADULT_PSYCH_INTAKE];
  assert.equal(a.indexOf('Substance Use Consequences'), a.indexOf('Substance Use Hx') + 1);
  assert.equal(normalizeNoteType('MD Health - Adult Psychiatry Intake Note for Re-Eval'), ADULT_PSYCH_REEVAL);
  assert.equal(normalizeNoteType('Adult Psychiatry Re-Eval'), ADULT_PSYCH_REEVAL);
  assert.equal(asStructuredNoteType('Adult Psychiatry Re-Eval'), ADULT_PSYCH_REEVAL);

  const cfg = TEMPLATE_CONFIG[ADULT_PSYCH_REEVAL];
  assert.deepEqual([...cfg.aiSections], [APR.hpi, APR.interval], 'AI only for HPI and interval history');
  assert.equal(cfg.carrySource, 'priorEvaluation');
  assert.equal(cfg.codeLabel, 'Service code');
  assert.deepEqual(cfg.codeOptions, TEMPLATE_CONFIG[ADULT_PSYCH_INTAKE].codeOptions, 'same service codes as the adult intake');
  assert.ok(cfg.codeOptions.some((o) => o.code === '90792'));
  for (const o of cfg.codeOptions) assert.ok(['90792', '99204', '99205', '99214', '99215'].includes(o.code));
  assert.equal(addOnAllowed('90792'), false, 'add-ons with E/M only');
  // Stable history: no suicide / pregnancy history (re-assessed)
  const all: readonly string[] = APR_BRING_FORWARD_ALL;
  assert.ok(!all.includes(APR.suicideHx));
  assert.ok(!all.includes(APR.menstruation));
  for (const h of all) assert.ok(cfg.carryForward.includes(h), `${h} also offers single-section bring forward`);
  assert.equal(all.length, 16);

  const texts = Object.fromEntries(s.map((h, i) => [h, `content ${i}`]));
  const parsed = structuredNoteSections(ADULT_PSYCH_REEVAL, compose(ADULT_PSYCH_REEVAL, texts));
  assert.equal(parsed.length, s.length);
  for (const p of parsed) assert.equal(p.text, texts[p.title]);
});

test('re-eval: "Bring forward all" marks each stable-history section for review and blocks signing until each is reviewed', () => {
  const date = '2026-06-02';
  const priorSections: Record<string, string> = {
    [APR.inpatient]: '- Facility: Sheppard Pratt; Dates: 2024',
    [APR.psychMedHx]: '(from 2026-01-05 — reviewed, no changes)\n- Medication: sertraline; Response: partial',
    [APR.familyHx]: 'Family psychiatric history:\n- Depression: Mother',
    [APR.stressors]: 'Current stressors: Financial',
    [APR.suicideHx]: 'Suicide / self-harm history: Endorses — Suicide attempt(s).',
    [APR.diagnoses]: 'F33.1 MDD, recurrent, moderate',
  };
  const current = { [APR.familyHx]: 'Brother newly diagnosed with bipolar disorder.' };
  const r = bringForwardAll(current, date, priorSections, APR_BRING_FORWARD_ALL);
  assert.deepEqual(r.brought, [APR.inpatient, APR.psychMedHx, APR.familyHx, APR.stressors]);
  assert.ok(r.noPriorText.includes(APR.outpatient) && r.noPriorText.includes(APR.legal));
  assert.equal(r.texts[APR.suicideHx], undefined, 'suicide history is never brought forward by "all"');
  assert.equal(r.texts[APR.diagnoses], undefined, 'assessment sections are never brought forward');
  for (const h of r.brought) {
    assert.equal(countPendingCarryForward(r.texts[h]), 1, `${h} is marked for review`);
    assert.match(r.texts[h], /\(from 2026-06-02 — review\)/);
  }
  assert.ok(!r.texts[APR.psychMedHx].includes('2026-01-05'), 'older markers stripped');
  assert.match(r.texts[APR.familyHx], /^Brother newly diagnosed[\s\S]*\(from 2026-06-02 — review\)\nFamily psychiatric history:/, 'clinician text kept first');
  // Clicking again does not duplicate
  const again = bringForwardAll(r.texts, date, priorSections, APR_BRING_FORWARD_ALL);
  assert.deepEqual(again.brought, []);
  assert.equal(again.alreadyPresent.length, 4);
  assert.deepEqual(again.texts, r.texts);

  // Signing is blocked (editor, note view and server share this rule) until each section is reviewed
  const blocked = structuredSignBlockers({ noteType: ADULT_PSYCH_REEVAL, body: compose(ADULT_PSYCH_REEVAL, r.texts), cptCode: '99215' });
  assert.deepEqual(blocked.map((b) => b.heading), r.brought);
  assert.ok(blocked.every((b) => /review/.test(b.message)));

  const reviewed = { ...r.texts };
  for (const h of r.brought.slice(0, 3)) reviewed[h] = markReviewedNoChanges(reviewed[h], date, priorSections[h]);
  const stillOne = structuredSignBlockers({ noteType: ADULT_PSYCH_REEVAL, body: compose(ADULT_PSYCH_REEVAL, reviewed), cptCode: '99215' });
  assert.deepEqual(stillOne.map((b) => b.heading), [APR.stressors], 'one unreviewed section still blocks');
  // Editing the text and removing the marker also counts as reviewed
  reviewed[APR.stressors] = 'Current stressors: Financial, Work / unemployment (lost job in August)';
  assert.deepEqual(structuredSignBlockers({ noteType: ADULT_PSYCH_REEVAL, body: compose(ADULT_PSYCH_REEVAL, reviewed), cptCode: '99215' }), []);
  assert.match(reviewed[APR.inpatient], /\(from 2026-06-02 — reviewed, no changes\)/);
});

test('re-eval: no prior evaluation brings nothing forward and signs like the initial adult intake', () => {
  const r = bringForwardAll({ [APR.stressors]: 'Current stressors: Housing' }, '2026-06-02', {}, APR_BRING_FORWARD_ALL);
  assert.deepEqual(r.brought, []);
  assert.equal(r.noPriorText.length, APR_BRING_FORWARD_ALL.length);
  assert.deepEqual(r.texts, { [APR.stressors]: 'Current stressors: Housing' });

  // Header line: "None on file" when the chart has no prior evaluation; draft reopen keeps the evaluation type
  assert.equal(priorEvalHeaderLine(null), 'Prior evaluation used as reference: None on file');
  assert.equal(priorEvalHeaderLine({ date: '2026-06-02', noteType: ADULT_PSYCH_INTAKE }), 'Prior evaluation used as reference: 2026-06-02 (Adult Psych Intake)');
  const header = ['Evaluation type: Re-evaluation', priorEvalHeaderLine({ date: '2026-06-02', noteType: ADULT_PSYCH_INTAKE }), 'History obtained from: Patient'].join('\n');
  assert.equal(parseIntakeHeader(header)?.evalKind, 'Re-evaluation');
  assert.deepEqual(parseIntakeHeader(header)?.informants, ['Patient']);
  assert.deepEqual([...REEVAL_SOURCE_TYPES], [ADULT_PSYCH_INTAKE, ADULT_PSYCH_REEVAL, 'Psych Eval', 'Intake']);

  // Same sign rules as the adult intake: only the service code is required on an empty note
  const empty = structuredSignBlockers({ noteType: ADULT_PSYCH_REEVAL, body: compose(ADULT_PSYCH_REEVAL, {}), cptCode: '' });
  assert.deepEqual(empty.map((b) => b.heading), ['Header']);
  assert.match(empty[0].message, /Service code/);
  assert.deepEqual(structuredSignBlockers({ noteType: ADULT_PSYCH_REEVAL, body: compose(ADULT_PSYCH_REEVAL, {}), cptCode: '90792' }), []);
  // High overall risk needs a safety plan
  const high = renderOverallRisk({ level: 'High', rationale: 'new attempt since last eval', safetyPlanBlock: '', safetyPlanReference: '' });
  assert.ok(
    structuredSignBlockers({ noteType: ADULT_PSYCH_REEVAL, body: compose(ADULT_PSYCH_REEVAL, { [APR.protectiveFactors]: high }), cptCode: '99215' }).some(
      (b) => b.heading === APR.protectiveFactors && /safety plan/.test(b.message)
    )
  );
  // AI marker in interval history blocks too
  const ai = structuredSignBlockers({ noteType: ADULT_PSYCH_REEVAL, body: compose(ADULT_PSYCH_REEVAL, { [APR.interval]: `${AI_DRAFT_MARKER}\nmood better` }), cptCode: '99215' });
  assert.ok(ai.some((b) => /AI DRAFT/.test(b.message) && b.heading === APR.interval));
});

test('re-eval interval prompts and prior evaluation reference write only what was chosen', () => {
  assert.equal(renderIntervalChanges('2026-06-02', {}), '');
  assert.equal(renderIntervalChanges('2026-06-02', { symptoms: { choice: '', details: '' } }), '');
  assert.equal(
    renderIntervalChanges('2026-06-02', {
      symptoms: { choice: 'Worsened', details: 'low mood since August' },
      er: { choice: 'None', details: '' },
      lifeEvents: { choice: '', details: 'job loss' },
    }),
    'Changes since prior evaluation (2026-06-02):\n- Symptoms: Worsened — low mood since August\n- ER visits: None\n- Life events / stressors: job loss'
  );
  assert.match(renderIntervalChanges(null, { meds: { choice: 'No changes', details: '' } }), /^Interval changes:\n- Medications: No changes$/);
  const domains: string[] = INTERVAL_DOMAINS.map((d) => d.label);
  for (const want of ['Symptoms', 'Medications', 'Psychiatric hospitalizations', 'ER visits', 'Substance use', 'Life events / stressors']) assert.ok(domains.includes(want));
  assert.equal(
    priorEvalReference({ date: '2026-06-02', noteType: ADULT_PSYCH_INTAKE, diagnoses: 'F33.1', plan: '', medChanges: 'Start sertraline 50 mg' }),
    'Prior evaluation (2026-06-02, Adult Psych Intake) for reference:\nDiagnoses: F33.1\nPlan: None documented\nMed changes: Start sertraline 50 mg'
  );
});

test('re-eval measure review: change since the prior evaluation date, not just since the previous score', () => {
  const records = [
    { instrument: 'PHQ-9', score: 19, severity: 'Moderately Severe', date: '2026-05-20', source: 'a' },
    { instrument: 'PHQ-9', score: 17, severity: 'Moderately Severe', date: '2026-06-02', source: 'a' },
    { instrument: 'PHQ-9', score: 12, severity: 'Moderate', date: '2026-08-01', source: 'a' },
    { instrument: 'PHQ-9', score: 9, severity: 'Mild', date: '2026-10-01', source: 'a' },
    { instrument: 'GAD-7', score: 8, severity: 'Mild', date: '2026-09-15', source: 'b' },
    { instrument: 'ASRS', score: 30, severity: null, date: '2026-01-10', source: 'a' },
  ];
  const rows = summarizeMeasuresSinceEval(records, '2026-06-02');
  const phq = rows.find((r) => r.instrument === 'PHQ-9');
  assert.equal(phq?.latest.score, 9);
  assert.deepEqual(phq?.atEval, { score: 17, date: '2026-06-02' }, 'score on the evaluation date');
  assert.equal(phq?.change, -8, 'vs the prior evaluation (previous-score change would be -3)');
  assert.equal(summarizeMeasures(records).find((r) => r.instrument === 'PHQ-9')?.change, -3);
  const gad = rows.find((r) => r.instrument === 'GAD-7');
  assert.equal(gad?.atEval, null, 'no score on or before the evaluation');
  assert.equal(gad?.change, null);
  const asrs = rows.find((r) => r.instrument === 'ASRS');
  assert.equal(asrs?.change, null, 'no score since the evaluation');
  const text = renderMeasuresSinceEval(rows, '2026-06-02');
  assert.match(text, /^Rating scales \(latest vs at prior evaluation 2026-06-02\):/);
  assert.match(text, /- PHQ-9: 9 Mild \(2026-10-01\); at prior evaluation 17 \(2026-06-02\); change since prior evaluation -8/);
  assert.match(text, /- GAD-7: 8 Mild \(2026-09-15\); at prior evaluation none on file; change since prior evaluation n\/a/);
  assert.match(text, /Source: a; b\./);
  assert.equal(renderMeasuresSinceEval([], '2026-06-02'), 'Rating scales: None on file');
});

// ─── Child Psychiatry Intake (Valant 18772) and Child Psychiatry Re-Eval (Valant 46444) ───

test('Child Psychiatry Intake (18772) follows the owner screenshot section order and has no Interval History', () => {
  assert.ok(NOTE_TYPES.includes(CHILD_PSYCH_INITIAL_INTAKE));
  assert.equal(NOTE_LABELS[CHILD_PSYCH_INITIAL_INTAKE], 'Child Psychiatry Intake');
  assert.deepEqual([...NOTE_SECTIONS[CHILD_PSYCH_INITIAL_INTAKE]], [
    'Header',
    'Identifying Information',
    'Chief Complaint',
    'HPI',
    'Inpatient Hx',
    'Outpatient Hx',
    'Suicide/Self-Harm Hx',
    'Psychiatric Med Hx',
    'Abuse',
    'Past Medical Hx',
    'Menstruation and Pregnancy Hx',
    'Patient Allergies',
    'Substance Use Hx',
    'Substance Use Consequences',
    'Substance Treatment Hx',
    'Family Hx',
    'Family Relationships',
    'Developmental and Educational Hx',
    'General Social Hx',
    'Legal History',
    'Violence Hx',
    'Trauma/Stressors',
    'Stressors',
    'Review of Systems',
    'Exam',
    'Assessment - Sources of Risk',
    'Suicide Risk Factors',
    'Suicide Protective Factors',
    'Assessment - Diagnoses',
    'Meds & Allergies',
    'Plan',
    'Plan - Med Changes',
    'Plan - Next Appointment',
    'Review',
  ]);
  assert.ok(!NOTE_SECTIONS[CHILD_PSYCH_INITIAL_INTAKE].includes(CPI.interval), 'no History of Present Illness/Interval History');
  // Exactly the 46444 list without the interval-history section
  assert.deepEqual([...NOTE_SECTIONS[CHILD_PSYCH_INITIAL_INTAKE]], NOTE_SECTIONS[CHILD_PSYCH_INTAKE].filter((h) => h !== CPI.interval));
  for (const alias of ['Child Psychiatry Intake', 'MD Health - Child Psychiatry Intake Note', CHILD_PSYCH_INITIAL_INTAKE]) {
    assert.equal(normalizeNoteType(alias), CHILD_PSYCH_INITIAL_INTAKE, alias);
  }
  assert.equal(asStructuredNoteType('Child Psychiatry Intake'), CHILD_PSYCH_INITIAL_INTAKE);
  assert.equal(noteTypeBadge(CHILD_PSYCH_INITIAL_INTAKE), 'Child Psych Intake');

  const cfg = TEMPLATE_CONFIG[CHILD_PSYCH_INITIAL_INTAKE];
  assert.deepEqual([...cfg.aiSections], [CPI.hpi], 'AI only for HPI');
  assert.deepEqual(cfg.codeOptions, TEMPLATE_CONFIG[CHILD_PSYCH_INTAKE].codeOptions, 'same service codes as the child re-eval');
  assert.equal(cfg.reEval, null, 'initial evaluation: no re-eval prompts');
  assert.equal(cfg.reEvalAlternative, CHILD_PSYCH_INTAKE, 'suggests Child Psychiatry Re-Eval when a prior evaluation exists');
  assert.deepEqual(priorEvalSourceTypesFor(CHILD_PSYCH_INITIAL_INTAKE), CHILD_REEVAL_SOURCE_TYPES, 'prior evaluation looked up for the hint');
  assert.equal(
    childHeaderLines({ evalKind: 'Initial evaluation', informants: ['Parent/guardian'], informantOther: '', guardianName: '', guardianRelationship: '' })[0],
    'Evaluation type: Initial evaluation'
  );

  // Sign rules: service code; high risk needs a safety plan; nothing else on an empty note
  const empty = structuredSignBlockers({ noteType: CHILD_PSYCH_INITIAL_INTAKE, body: compose(CHILD_PSYCH_INITIAL_INTAKE, {}), cptCode: '' });
  assert.deepEqual(empty.map((b) => b.heading), ['Header']);
  assert.deepEqual(structuredSignBlockers({ noteType: CHILD_PSYCH_INITIAL_INTAKE, body: compose(CHILD_PSYCH_INITIAL_INTAKE, {}), cptCode: '90792' }), []);
  const high = renderOverallRisk({ level: 'High', rationale: 'recent attempt', safetyPlanBlock: '', safetyPlanReference: '' });
  assert.ok(
    structuredSignBlockers({ noteType: CHILD_PSYCH_INITIAL_INTAKE, body: compose(CHILD_PSYCH_INITIAL_INTAKE, { [CPI.protectiveFactors]: high }), cptCode: '90792' }).some(
      (b) => b.heading === CPI.protectiveFactors
    )
  );
});

test('Child Psychiatry Re-Eval keeps the stored 46444 key and the old label still maps', () => {
  assert.equal(CHILD_PSYCH_REEVAL, CHILD_PSYCH_INTAKE);
  assert.equal(CHILD_PSYCH_INTAKE, 'Child Psych Intake', 'stored key unchanged');
  assert.equal(NOTE_LABELS[CHILD_PSYCH_INTAKE], 'Child Psychiatry Re-Eval');
  for (const alias of [
    'Child Psych Intake',
    'Child Psychiatry Intake / Re-Eval',
    'MD Health - Child Psychiatry Intake Note for Re-Eval',
    'Child Psychiatry Re-Eval',
    'Child Psych Re-Eval',
  ]) {
    assert.equal(normalizeNoteType(alias), CHILD_PSYCH_INTAKE, alias);
    assert.equal(asStructuredNoteType(alias), CHILD_PSYCH_INTAKE, alias);
  }
  assert.equal(noteTypeBadge(CHILD_PSYCH_INTAKE), 'Child Psych Re-Eval');
  assert.equal(noteTypeBadge(ADULT_PSYCH_REEVAL), ADULT_PSYCH_REEVAL, 'other badges unchanged');
  // A note saved before the relabel (stored type 'Child Psych Intake') still opens with the 46444 headings
  const saved = compose(CHILD_PSYCH_INTAKE, { [CPI.interval]: 'Mood better since June.', [CPI.familyHx]: 'Family psychiatric history: None reported.' });
  const parsed = structuredNoteSections('Child Psych Intake', saved);
  assert.equal(parsed.length, NOTE_SECTIONS[CHILD_PSYCH_INTAKE].length);
  assert.equal(parsed.find((p) => p.title === CPI.interval)?.text, 'Mood better since June.');
  // Prior-evaluation lines name the template by its display text, not the legacy key
  assert.equal(priorEvalHeaderLine({ date: '2026-03-04', noteType: CHILD_PSYCH_INTAKE }), 'Prior evaluation used as reference: 2026-03-04 (Child Psych Re-Eval)');
  assert.match(
    priorEvalReference({ date: '2026-03-04', noteType: CHILD_PSYCH_INITIAL_INTAKE, diagnoses: 'F90.2', plan: '', medChanges: '' }),
    /^Prior evaluation \(2026-03-04, Child Psych Intake\) for reference:/
  );

  const cfg = TEMPLATE_CONFIG[CHILD_PSYCH_INTAKE];
  assert.equal(cfg.carrySource, 'priorEvaluation');
  assert.deepEqual([...cfg.aiSections], [CPI.hpi, CPI.interval], 'AI only for HPI and interval history');
  assert.equal(cfg.reEval?.population, 'child');
  assert.equal(cfg.reEvalAlternative, null);
  assert.deepEqual([...CHILD_REEVAL_SOURCE_TYPES], [CHILD_PSYCH_INITIAL_INTAKE, CHILD_PSYCH_INTAKE, 'Psych Eval', 'Intake']);
  assert.deepEqual(priorEvalSourceTypesFor('Child Psychiatry Intake / Re-Eval'), CHILD_REEVAL_SOURCE_TYPES);
  assert.deepEqual(priorEvalSourceTypesFor(ADULT_PSYCH_REEVAL), REEVAL_SOURCE_TYPES, 'adult re-eval sources unchanged');
  assert.equal(priorEvalSourceTypesFor(PSYCH_MED_MGMT), null);
  assert.equal(priorEvalSourceTypesFor(ADULT_PSYCH_INTAKE), null);
});

test('child re-eval: "Bring forward all" covers the stable child history and blocks signing until each is reviewed', () => {
  const all: readonly string[] = CPR_BRING_FORWARD_ALL;
  assert.deepEqual(TEMPLATE_CONFIG[CHILD_PSYCH_INTAKE].reEval?.bringForwardAll, CPR_BRING_FORWARD_ALL);
  assert.equal(all.length, 17);
  assert.ok(!all.includes(CPI.suicideHx), 'suicide / self-harm history is re-assessed');
  assert.ok(!all.includes(CPI.menstruation), 'menstruation / pregnancy history is re-assessed');
  for (const h of [CPI.trauma, CPI.stressors, CPI.developmental, CPI.familyRelationships, CPI.substanceConsequences]) assert.ok(all.includes(h), h);
  for (const h of all) {
    assert.ok(NOTE_SECTIONS[CHILD_PSYCH_INTAKE].includes(h), `${h} is a 46444 section`);
    assert.ok((CPI_CARRY_FORWARD as readonly string[]).includes(h), `${h} also offers single-section bring forward`);
  }

  const date = '2026-03-04';
  // Prior evaluation = a signed Child Psychiatry Intake (18772)
  const priorSections: Record<string, string> = {
    [CPI.outpatient]: '- Provider / program: school-based therapy; Dates: 2025',
    [CPI.developmental]: 'Educational supports: IEP',
    [CPI.trauma]: 'Trauma history: Endorses — Bullying.',
    [CPI.suicideHx]: 'Suicide / self-harm history: Endorses — Non-suicidal self-injury.',
    [CPI.menstruation]: 'Menarche: age 12',
    [CPI.diagnoses]: 'F90.2 ADHD, combined type',
  };
  const r = bringForwardAll({}, date, priorSections, CPR_BRING_FORWARD_ALL);
  assert.deepEqual(r.brought, [CPI.outpatient, CPI.developmental, CPI.trauma]);
  assert.equal(r.texts[CPI.suicideHx], undefined);
  assert.equal(r.texts[CPI.menstruation], undefined);
  assert.equal(r.texts[CPI.diagnoses], undefined);
  for (const h of r.brought) assert.equal(countPendingCarryForward(r.texts[h]), 1, `${h} is marked for review`);

  const blocked = structuredSignBlockers({ noteType: CHILD_PSYCH_INTAKE, body: compose(CHILD_PSYCH_INTAKE, r.texts), cptCode: '99214' });
  assert.deepEqual(blocked.map((b) => b.heading), r.brought);
  const reviewed = { ...r.texts };
  reviewed[CPI.outpatient] = markReviewedNoChanges(reviewed[CPI.outpatient], date, priorSections[CPI.outpatient]);
  reviewed[CPI.developmental] = markReviewedNoChanges(reviewed[CPI.developmental], date, priorSections[CPI.developmental]);
  assert.deepEqual(
    structuredSignBlockers({ noteType: CHILD_PSYCH_INTAKE, body: compose(CHILD_PSYCH_INTAKE, reviewed), cptCode: '99214' }).map((b) => b.heading),
    [CPI.trauma],
    'one unreviewed section still blocks'
  );
  reviewed[CPI.trauma] = markReviewedNoChanges(reviewed[CPI.trauma], date, priorSections[CPI.trauma]);
  assert.deepEqual(structuredSignBlockers({ noteType: CHILD_PSYCH_INTAKE, body: compose(CHILD_PSYCH_INTAKE, reviewed), cptCode: '99214' }), []);
});

test('child re-eval interval prompts are child-specific and write only what was chosen', () => {
  const labels: string[] = CHILD_INTERVAL_DOMAINS.map((d) => d.label);
  for (const want of ['School', 'Family / home', 'Symptoms', 'Medications', 'Hospitalizations / ER visits', 'Substance use']) assert.ok(labels.includes(want), want);
  assert.ok(labels.some((l) => l.startsWith('Safety')));
  assert.deepEqual(TEMPLATE_CONFIG[CHILD_PSYCH_INTAKE].reEval?.intervalDomains, CHILD_INTERVAL_DOMAINS);
  assert.deepEqual(TEMPLATE_CONFIG[ADULT_PSYCH_REEVAL].reEval?.intervalDomains, INTERVAL_DOMAINS);
  assert.equal(renderIntervalChanges('2026-03-04', {}, CHILD_INTERVAL_DOMAINS), '');
  assert.equal(
    renderIntervalChanges(
      '2026-03-04',
      {
        school: { choice: 'New IEP / 504', details: 'IEP in place since April' },
        safety: { choice: 'No new concerns', details: '' },
        lifeEvents: { choice: 'Yes', details: 'adult-only domain, ignored' },
      },
      CHILD_INTERVAL_DOMAINS
    ),
    'Changes since prior evaluation (2026-03-04):\n- School: New IEP / 504 — IEP in place since April\n- Safety (self-harm, aggression, abuse): No new concerns'
  );
  // Measure change since the prior child evaluation uses the same rule as the adult re-eval
  const rows = summarizeMeasuresSinceEval(
    [
      { instrument: 'Vanderbilt', score: 40, severity: null, date: '2026-03-01', source: 'a' },
      { instrument: 'Vanderbilt', score: 28, severity: null, date: '2026-09-01', source: 'a' },
    ],
    '2026-03-04'
  );
  assert.equal(rows[0].change, -12);
});
