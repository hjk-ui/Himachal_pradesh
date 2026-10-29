/**
 * TMS workflow (owner's TMS steps, Oct 27 2026): stages + days in stage, intake packet, referral
 * next step, payer prescriber rule (seeded only from the owner's list), evaluation / screening,
 * start blockers, course scheduling (5 days a week x 20 min, authorized count, 26-visit series),
 * monitoring flags, billing hand-off, routes and migration.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  OWNER_PAYER_RULE_SEEDS,
  SERIES_CHUNK,
  TMS_SESSION_MINUTES,
  TMS_STAGES,
  TMS_WEEKDAYS,
  TMS_WORKFLOW_HELP,
  checkPrescriber,
  courseDates,
  courseSeriesChunks,
  daysInStage,
  defaultSessionCount,
  evaluationMissing,
  matchPayerRules,
  packetMissing,
  phq9Worsening,
  providerKindForRole,
  referralNextStep,
  stageDurations,
  startCourseBlockers,
  weeklyMeasureFor,
  MD_MEDICAID_MATCH_TERMS,
  TMS_CONSENT_TEMPLATE_KEY,
  TMS_DEVICES,
  TMS_DEVICE_CLEARANCE_LABEL,
  TMS_SCORE_INSTRUMENTS,
  TMS_SCORE_MILESTONES,
  ageYearsFrom,
  countAdtTrials,
  courseTargetLabel,
  courseTargetSessions,
  criteriaChecklist,
  criteriaIncomplete,
  devicePickValue,
  isTmsPrescriber,
  payerMinFailedTrials,
  payerRuleHint,
  providerKindForUser,
  tmsConsentHref,
  ybocsSeverity,
  ybocsWorsening,
  type TmsEvaluation,
} from '../src/lib/tms/workflow';
import { ALL_TEMPLATE_VERSIONS } from '../src/lib/consents/library/catalog';
import { ASSESSMENT_CATALOG } from '../src/features/ehr/assessments/catalog';
import { WORSENING_POINTS, isSendable } from '../src/lib/measures/instruments';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

const fullEval: TmsEvaluation = {
  dxConfirmed: true, symptoms: 's', functionalImpact: 'f', adtReviewed: true, psychHistory: 'p', currentTreatment: 'c', currentMedications: 'm', substanceUse: 'none',
  seizureRisk: 'none', neuroHistory: 'none', implantsMetal: 'none', deviceScreenDone: true, pregnancy: 'not_applicable', suicideRisk: 'low', escalationPlan: 'call 988',
  protocolExplained: true, consentObtained: true, prescriberDetermination: true, treatmentPlanDocumented: true, monitoringPlan: true,
};

test('stages follow the owner pipeline', () => {
  assert.deepEqual(TMS_STAGES.map((s) => s.value), ['referral', 'intake_packet', 'insurance_sent', 'verification', 'evaluation', 'scheduled', 'in_treatment', 'completed', 'discontinued']);
});

test('days in stage and per-stage durations', () => {
  const now = new Date('2026-10-27T12:00:00Z');
  assert.equal(daysInStage('2026-10-24T12:00:00Z', now), 3);
  assert.equal(daysInStage(null, now), null);
  const d = stageDurations([{ stage: 'referral', at: '2026-10-20T12:00:00Z' }, { stage: 'intake_packet', at: '2026-10-22T12:00:00Z' }], now);
  assert.deepEqual(d.map((x) => x.days), [2, 5]);
});

test('intake packet checklist: referral, PHQ-9, medication history, proof of diagnosis, consents', () => {
  assert.equal(packetMissing({}).length, 5);
  assert.deepEqual(packetMissing({ referral: true, phq9: true, medHistory: true, proofOfDx: true }), ['Consent forms (incl. TMS informed consent)']);
});

test('no referral: schedule medication management first', () => {
  assert.match(referralNextStep('none', false), /schedule medication management/i);
  assert.match(referralNextStep('external', false), /Review the intake packet/);
});

test('payer rules seeded only from the owner list', () => {
  const byKey = Object.fromEntries(OWNER_PAYER_RULE_SEEDS.map((r) => [r.payerKey, r.rule]));
  assert.deepEqual(byKey, {
    aetna: 'psychiatrist_or_np',
    medicare: 'psychiatrist_only',
    carefirst: 'plan_specific',
    cigna: 'plan_specific',
    medicaid: 'plan_specific',
    uhc: 'plan_specific',
  });
});

test('payer matching by name terms and payer type', () => {
  const r = OWNER_PAYER_RULE_SEEDS;
  assert.deepEqual(matchPayerRules({ name: 'Aetna Commercial PPO' }, r).map((x) => x.payerKey), ['aetna']);
  assert.deepEqual(matchPayerRules({ name: 'Priority Partners', type: 'Medicaid' }, r).map((x) => x.payerKey), ['medicaid']);
  assert.deepEqual(matchPayerRules({ name: 'CareFirst BlueChoice' }, r).map((x) => x.payerKey), ['carefirst']);
  assert.deepEqual(matchPayerRules({ name: 'Optum Maryland' }, r), []);
  assert.deepEqual(matchPayerRules({ name: 'Aetna' }, r.map((x) => ({ ...x, active: x.payerKey !== 'aetna' }))), []);
});

test('prescriber check: Medicare psychiatrist only, Aetna psychiatrist or NP, plan specific needs verification', () => {
  const r = OWNER_PAYER_RULE_SEEDS;
  const medicare = matchPayerRules({ name: 'Medicare Part B', type: 'medicare' }, r);
  assert.equal(checkPrescriber(medicare, 'np').ok, false);
  assert.equal(checkPrescriber(medicare, 'psychiatrist').ok, true);
  const aetna = matchPayerRules({ name: 'Aetna' }, r);
  assert.deepEqual([checkPrescriber(aetna, 'np').ok, checkPrescriber(aetna, 'np').needsVerification], [true, false]);
  const cigna = checkPrescriber(matchPayerRules({ name: 'Cigna' }, r), 'np');
  assert.equal(cigna.ok, true);
  assert.equal(cigna.needsVerification, true);
  // Aetna Medicare plan: strictest rule (psychiatrist only) and verification
  const both = matchPayerRules({ name: 'Aetna Medicare Advantage' }, r);
  assert.equal(both.length, 2);
  assert.equal(checkPrescriber(both, 'np').ok, false);
  assert.equal(checkPrescriber(both, 'psychiatrist').needsVerification, true);
  assert.equal(checkPrescriber([], 'np').needsVerification, true);
  assert.equal(checkPrescriber(aetna, 'other').ok, false);
  assert.equal(providerKindForRole('PSYCHIATRIST'), 'psychiatrist');
  assert.equal(providerKindForRole('NP'), 'np');
  assert.equal(providerKindForRole('THERAPIST'), 'other');
});

test('evaluation covers the owner checklist incl. pregnancy and device screen', () => {
  assert.deepEqual(evaluationMissing(fullEval), []);
  const m = evaluationMissing({});
  for (const s of ['Diagnosis confirmed', 'Seizure risk screen', 'Implanted devices / metal screen', 'Device-specific contraindication screen', 'Pregnancy status', 'Risk assessment (suicidality) and escalation plan']) {
    assert.ok(m.includes(s), s);
  }
  assert.ok(evaluationMissing({ ...fullEval, seizureRisk: 'present' }).includes('Seizure risk screen'));
});

test('start blockers: consent, screening, authorization, determination, device cleared for the indication, payer rule', () => {
  const okPrescriber = checkPrescriber(matchPayerRules({ name: 'Aetna' }, OWNER_PAYER_RULE_SEEDS), 'np');
  const ready = { evaluation: fullEval, indication: 'mdd' as const, deviceName: 'Device X', deviceClearedForIndication: true, authStatus: 'approved', prescriber: okPrescriber, payerVerified: null, payerVerifyNote: null };
  assert.deepEqual(startCourseBlockers(ready), []);
  assert.ok(startCourseBlockers({ ...ready, authStatus: 'pending' }).some((b) => /authorization/.test(b)));
  assert.deepEqual(startCourseBlockers({ ...ready, authStatus: 'not_required' }), []);
  assert.ok(startCourseBlockers({ ...ready, evaluation: { ...fullEval, consentObtained: false } }).some((b) => /consent/.test(b)));
  assert.ok(startCourseBlockers({ ...ready, evaluation: { ...fullEval, prescriberDetermination: false } }).some((b) => /determination/.test(b)));
  assert.ok(startCourseBlockers({ ...ready, indication: 'ocd', deviceClearedForIndication: false }).some((b) => /cleared for this indication \(OCD\) per the device's labeling/.test(b)));
  assert.ok(startCourseBlockers({ ...ready, absoluteContraindications: 1 }).some((b) => /absolute contraindication/.test(b)));
  const plan = checkPrescriber(matchPayerRules({ name: 'UnitedHealthcare' }, OWNER_PAYER_RULE_SEEDS), 'np');
  assert.ok(startCourseBlockers({ ...ready, prescriber: plan }).some((b) => /Verified with plan/.test(b)));
  assert.ok(startCourseBlockers({ ...ready, prescriber: plan, payerVerified: true, payerVerifyNote: '' }).some((b) => /Verified with plan/.test(b)));
  assert.deepEqual(startCourseBlockers({ ...ready, prescriber: plan, payerVerified: true, payerVerifyNote: 'Spoke with J, ref 123' }), []);
  const medicareNp = checkPrescriber(matchPayerRules({ name: 'Medicare' }, OWNER_PAYER_RULE_SEEDS), 'np');
  assert.ok(startCourseBlockers({ ...ready, prescriber: medicareNp }).some((b) => /psychiatrist/.test(b)));
});

test('course: 5 weekdays a week, 20 minutes, count from the authorization (never a built-in 36)', () => {
  assert.deepEqual([...TMS_WEEKDAYS], [1, 2, 3, 4, 5]);
  assert.equal(TMS_SESSION_MINUTES, 20);
  assert.equal(defaultSessionCount(30), 30);
  assert.equal(defaultSessionCount(null), null);
  assert.equal(defaultSessionCount(0), null);
  const d = courseDates('2026-10-30', 3); // Friday
  assert.deepEqual(d, ['2026-10-30', '2026-11-02', '2026-11-03']);
  const chunks = courseSeriesChunks('2026-11-02', 36);
  assert.equal(SERIES_CHUNK, 26);
  assert.deepEqual(chunks.map((c) => c.count), [26, 10]);
  assert.ok(chunks[1].startDate > chunks[0].lastDate);
  assert.equal(courseSeriesChunks('2026-11-02', 20).length, 1);
  const lib = read('src/lib/tms/workflow.ts') + read('src/lib/tms/workflowDb.ts');
  assert.doesNotMatch(lib, /\b36\b/);
});

test('monitoring: weekly PHQ-9 for MDD; Y-BOCS total (score only) for OCD; worsening threshold', () => {
  assert.equal(weeklyMeasureFor('mdd').instrumentId, 'phq-9');
  assert.equal(weeklyMeasureFor('ocd').instrumentId, 'ybocs');
  assert.match(weeklyMeasureFor('ocd').note ?? '', /score only/);
  assert.deepEqual(phq9Worsening([18, 14, 19]), { worse: true, from: 14, to: 19 });
  assert.deepEqual(phq9Worsening([12, 18]), { worse: true, from: 12, to: 18 });
  assert.equal(phq9Worsening([18, 16, 15]).worse, false);
  assert.equal(phq9Worsening([18]).worse, false);
});

test('help panel lists the owner steps', () => {
  assert.equal(TMS_WORKFLOW_HELP.length, 7);
  assert.match(TMS_WORKFLOW_HELP[0], /medication management/);
  assert.match(TMS_WORKFLOW_HELP.join(' '), /5 days a week, 20 minutes/);
});

test('migration: idempotent, no TmsCourse change, owner rules not written by SQL', () => {
  const sql = read('prisma/migrations/20261027_tms_workflow.sql');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS tms_case_workflows/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS tms_payer_rules/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "attendance"/);
  assert.doesNotMatch(sql, /ALTER TABLE "TmsCourse"/);
  assert.doesNotMatch(sql, /INSERT INTO/);
  const schema = read('prisma/schema.prisma');
  assert.match(schema, /model TmsCaseWorkflow \{/);
  assert.match(schema, /model TmsPayerRule \{/);
});

test('routes are gated and audited with field names only', () => {
  const http = read('src/lib/tms/http.ts');
  assert.match(http, /canWriteTmsSpravato/);
  assert.match(http, /\/dashboard\/billing\/authorizations/);
  const wf = read('src/app/api/tms/workflow/[courseId]/route.ts');
  assert.match(wf, /tmsGate\('read'\)/);
  assert.match(wf, /tmsGate\('write'\)/);
  assert.match(wf, /fields: changedFields\(parsed\.data\)/);
  assert.match(read('src/app/api/tms/workflow/[courseId]/verification/route.ts'), /tmsGate\('billing'\)/);
  assert.match(read('src/app/api/tms/workflow/[courseId]/schedule/route.ts'), /canAccessClientAppointments/);
  const db = read('src/lib/tms/workflowDb.ts');
  assert.match(db, /clientAccessWhere/);
  assert.match(db, /Only a psychiatrist or NP can record the prescriber determination/);
  assert.match(db, /createSeries\(/);
  assert.match(db, /source: 'program'/);
  assert.match(db, /createRiskAlert\(/);
});

test('billing hand-off reuses To-Do and shows on Authorizations', () => {
  assert.match(read('src/lib/tasks/manage.ts'), /'tms_billing_handoff'/);
  assert.match(read('src/app/dashboard/billing/authorizations/page.tsx'), /<TmsBillingHandoffs \/>/);
});

test('TMS page: help panel, workflow panel, attendance + SI on the session log', () => {
  const page = read('src/app/dashboard/ehr/tms-spravato/page.tsx');
  assert.match(page, /<TmsWorkflowHelp \/>/);
  assert.match(page, /<TmsWorkflowPanel/);
  assert.match(page, /suicidalIdeation/);
  assert.match(page, /TMS_ATTENDANCE/);
  const ui = read('src/components/tms/TmsWorkflowPanel.tsx');
  assert.match(ui, /Schedule medication management/);
  assert.match(ui, /Verified with plan/);
  assert.match(ui, /Schedule TMS course/);
  assert.doesNotMatch(ui, /\p{Extended_Pictographic}/u);
  assert.match(read('src/app/api/tms/sessions/route.ts'), /flagSessionConcerns/);
});

// ─── Industry-standard follow-ups (Oct 28 2026) ──────────────────────────────

test('all roles: psychiatrist / NP by primary role OR any assigned role', () => {
  assert.equal(providerKindForUser({ role: 'THERAPIST', roles: ['THERAPIST', 'PSYCHIATRIST'] }), 'psychiatrist');
  assert.equal(providerKindForUser({ role: 'PRACTICE_DIRECTOR', roles: ['NP'] }), 'np');
  assert.equal(providerKindForUser({ role: 'NP', roles: ['PSYCHIATRIST'] }), 'psychiatrist');
  assert.equal(providerKindForUser({ role: 'THERAPIST', roles: [] }), 'other');
  assert.equal(providerKindForUser(null), 'other');
  assert.equal(isTmsPrescriber({ role: 'ADMIN', roles: ['ADMIN', 'NP'] }), true);
  assert.equal(isTmsPrescriber({ role: 'BILLING' }), false);
  // A Medicare case: a director who also holds PSYCHIATRIST qualifies
  const medicare = matchPayerRules({ name: 'Medicare' }, OWNER_PAYER_RULE_SEEDS);
  assert.equal(checkPrescriber(medicare, providerKindForUser({ role: 'PRACTICE_DIRECTOR', roles: ['PSYCHIATRIST'] })).ok, true);
  assert.match(read('src/lib/tms/workflow.ts'), /normalizeUserRoles/);
  const db = read('src/lib/tms/workflowDb.ts');
  assert.match(db, /roles: \{ hasSome: PRESCRIBER_ROLES \}/);
  assert.match(db, /isTmsPrescriber\(\{ role: actor\.role, roles: actor\.roles \}\)/);
  assert.doesNotMatch(db, /providerKindForRole\(/);
  assert.doesNotMatch(db, /PRESCRIBER_ROLES\.includes\(actor\.role\)/);
  assert.match(read('src/lib/tms/http.ts'), /roles: user\?\.roles/);
  const ui = read('src/components/tms/TmsWorkflowPanel.tsx');
  assert.match(ui, /isTmsPrescriber\(/);
  assert.doesNotMatch(ui, /role === 'PSYCHIATRIST' \|\| role === 'NP'/);
});

test('course target: never a built-in 36; "Not set" until authorized or entered', () => {
  assert.equal(courseTargetSessions({}), null);
  assert.equal(courseTargetSessions({ targetSessions: null, scheduledSessions: null, authorizedSessions: 30 }), 30);
  assert.equal(courseTargetSessions({ targetSessions: 24, authorizedSessions: 30 }), 24);
  assert.equal(courseTargetLabel(null), 'Not set');
  assert.equal(courseTargetLabel(30), '30 sessions');
  const schema = read('prisma/schema.prisma');
  assert.match(schema, /targetSessions Int\?\r?\n/);
  assert.doesNotMatch(schema, /targetSessions Int +@default\(36\)/);
  for (const f of ['src/app/api/tms/courses/route.ts', 'src/app/api/tms/courses/[id]/route.ts', 'src/app/dashboard/ehr/tms-spravato/page.tsx', 'src/app/api/tms/phq9/route.ts']) {
    assert.doesNotMatch(read(f), /\b36\b/, f);
  }
  const consts = read('src/features/ehr/tmsSpravatoConstants.ts');
  assert.doesNotMatch(consts, /\b36\b/);
  assert.doesNotMatch(consts, /require 4 failed trials|PHQ-9 ≥ 10|HDRS ≥ 14/);
  assert.match(read('src/app/dashboard/ehr/tms-spravato/page.tsx'), /placeholder="Not set"/);
  const sql = read('prisma/migrations/20261028_tms_standard.sql');
  assert.match(sql, /DROP NOT NULL/);
  assert.match(sql, /is_nullable = 'NO'/);
});

test('device: FDA-cleared picklist + Other, no hard-coded clearances, practice default', () => {
  assert.deepEqual([...TMS_DEVICES], [
    'NeuroStar Advanced Therapy (Neuronetics)',
    'BrainsWay Deep TMS',
    'MagVenture TMS Therapy',
    'Magstim Horizon',
    'Nexstim NBT',
    'Apollo TMS Therapy',
    'CloudTMS',
  ]);
  // Plain strings only: no indication / clearance data attached to a device
  for (const d of TMS_DEVICES) assert.equal(typeof d, 'string');
  const lib = read('src/lib/tms/workflow.ts');
  const deviceBlock = lib.slice(lib.indexOf('export const TMS_DEVICES'), lib.indexOf('export const TMS_DEVICE_OTHER'));
  assert.doesNotMatch(deviceBlock, /mdd|ocd|depress|obsess|indication/i);
  assert.equal(TMS_DEVICE_CLEARANCE_LABEL, "Cleared for this indication per the device's labeling");
  assert.equal(devicePickValue('BrainsWay Deep TMS'), 'BrainsWay Deep TMS');
  assert.equal(devicePickValue('Acme Coil 9'), 'other');
  assert.equal(devicePickValue(null), '');
  const ui = read('src/components/tms/TmsWorkflowPanel.tsx');
  assert.match(ui, /Other \(specify\)/);
  assert.match(ui, /Cleared indications \/ coil/);
  assert.match(ui, /TMS_DEVICE_CLEARANCE_LABEL/);
  assert.match(ui, /\/api\/tms\/practice-defaults/);
  assert.match(read('src/lib/tms/workflowDb.ts'), /deviceFromPracticeDefault/);
  assert.match(read('prisma/schema.prisma'), /model TmsPracticeDefault \{/);
  assert.match(read('src/app/api/tms/practice-defaults/route.ts'), /tmsGate\('write'\)/);
});

test('Maryland Medicaid: HealthChoice MCOs match the Medicaid rule, more specific match wins', () => {
  const r = OWNER_PAYER_RULE_SEEDS;
  const medicaid = r.find((x) => x.payerKey === 'medicaid')!;
  for (const t of ['maryland medicaid', 'medical assistance', 'healthchoice', 'carelon', 'aetna better health', 'carefirst community health plan', 'jai medical systems', 'kaiser permanente medicaid', 'maryland physicians care', 'medstar family choice', 'priority partners', 'unitedhealthcare community plan', 'wellpoint maryland']) {
    assert.ok(medicaid.matchTerms.includes(t), t);
  }
  assert.deepEqual([...medicaid.matchTerms], [...MD_MEDICAID_MATCH_TERMS]);
  const keys = (name: string, type?: string) => matchPayerRules({ name, type }, r).map((x) => x.payerKey);
  assert.deepEqual(keys('UnitedHealthcare Community Plan'), ['medicaid']);
  assert.deepEqual(keys('UnitedHealthcare Community Plan of Maryland'), ['medicaid']);
  assert.deepEqual(keys('Aetna Better Health of Maryland'), ['medicaid']);
  assert.deepEqual(keys('Aetna Better Health'), ['medicaid']);
  assert.deepEqual(keys('CareFirst Community Health Plan Maryland'), ['medicaid']);
  assert.deepEqual(keys('Wellpoint Maryland'), ['medicaid']);
  assert.deepEqual(keys('Maryland Physicians Care'), ['medicaid']);
  assert.deepEqual(keys('Carelon Behavioral Health'), ['medicaid']);
  assert.deepEqual(keys('UnitedHealthcare Choice Plus'), ['uhc']);
  assert.deepEqual(keys('Kaiser Permanente'), []);
  // Different parts of the name: both rules stay and the plan must be verified
  const both = matchPayerRules({ name: 'Aetna Medicare Advantage' }, r);
  assert.deepEqual(both.map((x) => x.payerKey).sort(), ['aetna', 'medicare']);
  assert.equal(checkPrescriber(both, 'psychiatrist').needsVerification, true);
  // A Medicaid MCO whose name contains a commercial payer resolves to the plan-specific Medicaid rule
  assert.equal(checkPrescriber(matchPayerRules({ name: 'Aetna Better Health' }, r), 'np').needsVerification, true);
  assert.equal(payerRuleHint('medicaid'), 'Prior authorization through Carelon Behavioral Health (ASO)');
  assert.equal(payerRuleHint('aetna'), null);
  // Existing org rows get the new terms once (terms added, never removed)
  const db = read('src/lib/tms/workflowDb.ts');
  assert.match(db, /OWNER_RULE_SOURCE_V2/);
  assert.match(db, /MAX_MATCH_TERMS = 30/);
});

test('payer minimum failed trials: optional per rule, blank by default, never seeded', () => {
  for (const seed of OWNER_PAYER_RULE_SEEDS) assert.equal(seed.minFailedTrials, undefined, seed.payerKey);
  assert.equal(payerMinFailedTrials([]), null);
  assert.equal(payerMinFailedTrials([{ ...OWNER_PAYER_RULE_SEEDS[0], minFailedTrials: 2 }, { ...OWNER_PAYER_RULE_SEEDS[1], minFailedTrials: 3 }]), 3);
  assert.match(read('src/app/api/tms/payer-rules/route.ts'), /minFailedTrials: z\.number\(\)\.int\(\)\.min\(1\)\.max\(20\)\.nullish\(\)/);
  assert.match(read('prisma/migrations/20261028_tms_standard.sql'), /ADD COLUMN IF NOT EXISTS "minFailedTrials" INTEGER/);
});

test('medical-necessity checklist: count from prior trials, payer minimum blank, warnings, required when plan specific', () => {
  assert.equal(countAdtTrials([{ medication: 'sertraline' }, { medication: ' ' }, { medication: 'bupropion' }, null]), 2);
  assert.equal(ageYearsFrom('2000-06-15', new Date('2026-10-28T12:00:00Z')), 26);
  assert.equal(ageYearsFrom(null), null);
  const complete: TmsEvaluation = {
    ...fullEval,
    criteriaDx: 'mdd_recurrent_severe',
    adtAdequacyConfirmed: true,
    psychotherapyTrial: 'yes',
    psychotherapyDates: 'CBT 01/2026-04/2026',
    baselineInstrument: 'phq-9',
    baselineScore: 21,
    activePsychosis: 'none',
    planSessions: 30,
    planTaper: '6 sessions over 3 weeks',
  };
  const base = { evaluation: complete, indication: 'mdd' as const, ageYears: 40, failedTrials: 2, payerMinimum: null };
  assert.deepEqual(criteriaIncomplete(criteriaChecklist(base)), []);
  const trials = criteriaChecklist(base).find((c) => c.key === 'trials')!;
  assert.match(trials.detail, /2 trials listed · Payer minimum: __/);
  // Payer minimum comes from the rule; never a built-in pass / fail number
  assert.equal(criteriaChecklist({ ...base, payerMinimum: 3 }).find((c) => c.key === 'trials')!.ok, false);
  assert.equal(criteriaChecklist({ ...base, payerMinimum: 2 }).find((c) => c.key === 'trials')!.ok, true);
  assert.equal(criteriaChecklist({ ...base, ageYears: 16 }).find((c) => c.key === 'age')!.ok, false);
  assert.match(criteriaChecklist({ ...base, ageYears: 16 }).find((c) => c.key === 'age')!.detail, /device labeling/);
  assert.equal(criteriaChecklist({ ...base, evaluation: { ...complete, activePsychosis: 'present' } }).find((c) => c.key === 'safety')!.ok, false);
  assert.equal(criteriaChecklist({ ...base, absoluteContraindications: 1 }).find((c) => c.key === 'safety')!.ok, false);
  // OCD baseline must be Y-BOCS; a course baseline score counts too
  const ocd = { ...base, indication: 'ocd' as const, evaluation: { ...complete, criteriaDx: 'ocd' as const, baselineInstrument: undefined, baselineScore: undefined } };
  assert.equal(criteriaChecklist(ocd).find((c) => c.key === 'baseline')!.ok, false);
  assert.equal(criteriaChecklist({ ...ocd, baselineScores: [{ instrument: 'ybocs', score: 26 }] }).find((c) => c.key === 'baseline')!.ok, true);
  const missing = criteriaIncomplete(criteriaChecklist({ ...base, evaluation: fullEval, failedTrials: 0 }));
  assert.ok(missing.length >= 5);
  // Plan specific: required (blocks scheduling); otherwise warnings only
  const plan = checkPrescriber(matchPayerRules({ name: 'Cigna' }, OWNER_PAYER_RULE_SEEDS), 'np');
  const ready = { evaluation: fullEval, indication: 'mdd' as const, deviceName: 'BrainsWay Deep TMS', deviceClearedForIndication: true, authStatus: 'approved', prescriber: plan, payerVerified: true, payerVerifyNote: 'ref 1' };
  assert.ok(startCourseBlockers({ ...ready, criteriaIncomplete: missing, criteriaRequired: true }).some((b) => /medical-necessity checklist/.test(b)));
  assert.deepEqual(startCourseBlockers({ ...ready, criteriaIncomplete: missing, criteriaRequired: false }), []);
  const aetna = checkPrescriber(matchPayerRules({ name: 'Aetna' }, OWNER_PAYER_RULE_SEEDS), 'np');
  assert.deepEqual(startCourseBlockers({ ...ready, prescriber: aetna, criteriaIncomplete: missing }), []);
  // UI: warnings before "Send insurance to billing" and before scheduling
  const ui = read('src/components/tms/TmsWorkflowPanel.tsx');
  assert.equal((ui.match(/<CriteriaList wf=\{wf\} compact \/>/g) ?? []).length, 2);
  assert.match(ui, /href="#tms-safety-screening"/);
  assert.match(ui, /Payer minimum: \{wf\.payerMinimum \?\? '__'\}/);
});

test('TMS informed consent: draft template in the consent library, no device named, linked from the case', () => {
  const t = ALL_TEMPLATE_VERSIONS.find((x) => x.key === TMS_CONSENT_TEMPLATE_KEY)!;
  assert.ok(t, 'template present');
  assert.equal(t.origin, 'proposed');
  assert.equal(t.defaultStatus, 'DRAFT');
  assert.ok(t.reviewFlags.some((f) => /practice \/ legal review/.test(f.text)));
  const text = t.blocks.map((b) => ('text' in b ? b.text : 'items' in b ? b.items.join(' ') : '')).join(' ');
  for (const want of [/magnetic/i, /MDD|major depressive/i, /OCD|obsessive/i, /weekdays/i, /motor threshold/i, /scalp discomfort/i, /headache/i, /twitching/i, /lightheaded/i, /hearing protection/i, /seizure/i, /thoughts of harming or killing myself/i, /ECT|electroconvulsive/i, /esketamine/i, /stop treatment at any time/i, /no guarantee/i, /implant/i, /pregnan/i, /prior authorization/i, /\{\{practicePhone\}\}/]) {
    assert.match(text, want);
  }
  for (const d of [...TMS_DEVICES, 'NeuroStar', 'BrainsWay', 'MagVenture', 'Magstim', 'Nexstim', 'Apollo', 'CloudTMS', 'Neuronetics']) {
    assert.ok(!text.includes(d), d);
    assert.ok(!t.title.includes(d), d);
  }
  assert.equal(tmsConsentHref('c1'), '/dashboard/ehr/consents/client/c1?template=tms-informed-consent');
  const ui = read('src/components/tms/TmsWorkflowPanel.tsx');
  assert.equal((ui.match(/href=\{wf\.consentHref\}/g) ?? []).length, 2);
});

test('Y-BOCS: score only (no items), weekly for OCD, published bands, +5 flag mirrors PHQ-9; HAM-D / MADRS baseline totals', () => {
  const y = ASSESSMENT_CATALOG.find((i) => i.id === 'ybocs')!;
  assert.ok(y);
  assert.equal(y.adminType, 'Clinician-Rated');
  assert.equal(y.maxScore, 40);
  assert.ok(!y.questions || y.questions.length === 0);
  assert.equal(y.hasDigitalQuestionnaire, false);
  assert.equal(isSendable('ybocs'), false);
  assert.match(y.description, /Score only/);
  assert.deepEqual(y.scoreRanges!.map((r) => [r.min, r.max, r.label]), [[0, 7, 'Subclinical'], [8, 15, 'Mild'], [16, 23, 'Moderate'], [24, 31, 'Severe'], [32, 40, 'Extreme']]);
  assert.deepEqual([0, 7, 8, 15, 16, 23, 24, 31, 32, 40].map(ybocsSeverity), ['Subclinical', 'Subclinical', 'Mild', 'Mild', 'Moderate', 'Moderate', 'Severe', 'Severe', 'Extreme', 'Extreme']);
  assert.equal(WORSENING_POINTS.ybocs, 5);
  assert.deepEqual(ybocsWorsening([24, 22, 27]), { worse: true, from: 22, to: 27 });
  assert.equal(ybocsWorsening([24, 26]).worse, false);
  const madrs = ASSESSMENT_CATALOG.find((i) => i.id === 'madrs')!;
  assert.ok(madrs && !madrs.questions?.length && madrs.maxScore === 60);
  const hamd = ASSESSMENT_CATALOG.find((i) => i.id === 'ham-d')!;
  assert.ok(hamd && !hamd.questions?.length);
  const inst = Object.fromEntries(TMS_SCORE_INSTRUMENTS.map((i) => [i.value, i]));
  assert.equal(inst.ybocs.max, 40);
  assert.equal(inst.ybocs.baselineOnly, false);
  assert.equal(inst['ham-d'].baselineOnly, true);
  assert.equal(inst.madrs.baselineOnly, true);
  assert.ok((TMS_SCORE_MILESTONES as readonly string[]).includes('weekly'));
  const route = read('src/app/api/tms/phq9/route.ts');
  assert.match(route, /recorded at baseline only/);
  assert.match(route, /ybocs: row\.instrument === 'ybocs'/);
  assert.match(read('src/lib/tms/workflowDb.ts'), /Y-BOCS total rose from/);
  assert.match(read('prisma/migrations/20261028_tms_standard.sql'), /"instrument" TEXT NOT NULL DEFAULT 'phq-9'/);
  // No Y-BOCS item wording anywhere in the TMS code
  const code = read('src/lib/tms/workflow.ts') + read('src/components/tms/TmsWorkflowPanel.tsx') + read('src/app/dashboard/ehr/tms-spravato/page.tsx');
  assert.doesNotMatch(code, /time occupied by obsessive|interference due to obsessive|resistance against compulsions/i);
});

test('migration 20261028: idempotent and no policy rows', () => {
  const sql = read('prisma/migrations/20261028_tms_standard.sql');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS tms_practice_defaults/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "deviceDetail" TEXT/);
  assert.doesNotMatch(sql, /INSERT INTO/);
});
