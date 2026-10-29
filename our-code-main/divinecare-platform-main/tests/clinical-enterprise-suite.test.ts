import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateCrisisTriage,
  type TriageInput,
} from '../src/services/crisisTriage';
import {
  evaluateAsamLevel,
  type AsamInput,
} from '../src/services/asamEngine';
import {
  evaluateAotEligibility,
  type AotCriteria,
} from '../src/services/aotEligibility';
import {
  auditChargeForBilling,
  type ChargeAuditInput,
} from '../src/services/chargeScrubber';
import {
  generateTriageProbe,
  generateEpisodeSummary,
  generateCsrDraft,
  generateAppealLetter,
} from '../src/lib/aiAssists';

// ---------------------------------------------------------------------------
// 1. Mobile Crisis Triage & Decision Engine (CARF-Aligned)
// ---------------------------------------------------------------------------
test('Crisis Triage Engine: Gate 1 immediate 911/EMS warm-transfer', () => {
  const input: TriageInput = {
    medicalEmergency: true,
    weaponViolence: false,
    attemptInProgress: false,
    suicidalIdeation: false,
    hasPlan: false,
    intentAndMeans: false,
    harmOthers: false,
    psychosisSigns: false,
    intoxicationSigns: false,
    supportPresent: false,
    willingToEngage: true,
  };
  const decision = evaluateCrisisTriage(input);
  assert.equal(decision.priority, 'P1_IMMINENT');
  assert.equal(decision.kind, 'EMS_TRANSFER');
  assert.ok(decision.label.includes('911 / EMS Transfer'));
});

test('Crisis Triage Engine: Gate 2 weapon/violence stages CIT law enforcement', () => {
  const input: TriageInput = {
    medicalEmergency: false,
    weaponViolence: true,
    attemptInProgress: false,
    suicidalIdeation: true,
    hasPlan: true,
    intentAndMeans: false,
    harmOthers: true,
    psychosisSigns: false,
    intoxicationSigns: false,
    supportPresent: false,
    willingToEngage: false,
  };
  const decision = evaluateCrisisTriage(input);
  assert.equal(decision.priority, 'P1_IMMINENT');
  assert.equal(decision.kind, 'POLICE_CIT');
  assert.ok(decision.detail.includes('Weapons or active violence'));
});

test('Crisis Triage Engine: Gate 3 attempt in progress triggers P1 dispatch (<=60m)', () => {
  const input: TriageInput = {
    medicalEmergency: false,
    weaponViolence: false,
    attemptInProgress: true,
    suicidalIdeation: true,
    hasPlan: true,
    intentAndMeans: true,
    harmOthers: false,
    psychosisSigns: false,
    intoxicationSigns: false,
    supportPresent: false,
    willingToEngage: false,
  };
  const decision = evaluateCrisisTriage(input);
  assert.equal(decision.priority, 'P1_IMMINENT');
  assert.equal(decision.kind, 'DISPATCH_P1');
  assert.ok(decision.detail.includes('60 minutes'));
});

test('Crisis Triage Engine: Urgent risk without imminent means triggers P2 dispatch (<=2h)', () => {
  const input: TriageInput = {
    medicalEmergency: false,
    weaponViolence: false,
    attemptInProgress: false,
    suicidalIdeation: true,
    hasPlan: true,
    intentAndMeans: false,
    harmOthers: false,
    psychosisSigns: true,
    intoxicationSigns: false,
    supportPresent: true,
    willingToEngage: true,
  };
  const decision = evaluateCrisisTriage(input);
  assert.equal(decision.priority, 'P2_URGENT');
  assert.equal(decision.kind, 'DISPATCH_P2');
  assert.ok(decision.detail.includes('2 hours'));
});

test('Crisis Triage Engine: Moderate distress routes to telehealth or routine referral', () => {
  const telehealthInput: TriageInput = {
    medicalEmergency: false,
    weaponViolence: false,
    attemptInProgress: false,
    suicidalIdeation: true,
    hasPlan: false,
    intentAndMeans: false,
    harmOthers: false,
    psychosisSigns: false,
    intoxicationSigns: false,
    supportPresent: true,
    willingToEngage: true,
  };
  const thDecision = evaluateCrisisTriage(telehealthInput);
  assert.equal(thDecision.priority, 'P3_ROUTINE');
  assert.equal(thDecision.kind, 'TELEHEALTH');

  const referralInput: TriageInput = {
    ...telehealthInput,
    suicidalIdeation: false,
    willingToEngage: false,
  };
  const refDecision = evaluateCrisisTriage(referralInput);
  assert.equal(refDecision.priority, 'P3_ROUTINE');
  assert.equal(refDecision.kind, 'REFERRAL');
});

// ---------------------------------------------------------------------------
// 2. ASAM 3.1 & 3.5 Six-Dimension Qualification Engine
// ---------------------------------------------------------------------------
test('ASAM Engine: Exclusionary safety gates refer to medical inpatient / 3.7 detox', () => {
  const input: AsamInput = {
    gates: { withdrawalRisk: true, medicalInstability: false, acutePsych: false },
    dims: [2, 1, 1, 1, 2, 2],
  };
  const result = evaluateAsamLevel(input);
  assert.equal(result.level, 'REFER_UP_MEDICAL');
  assert.equal(result.allowed, false);
});

test('ASAM Engine: Severe intoxication (D1>=3) refers to ASAM 3.7 medically monitored', () => {
  const input: AsamInput = {
    gates: { withdrawalRisk: false, medicalInstability: false, acutePsych: false },
    dims: [3, 2, 2, 2, 3, 2],
  };
  const result = evaluateAsamLevel(input);
  assert.equal(result.level, 'REFER_UP_3_7');
  assert.equal(result.allowed, false);
});

test('ASAM Engine: High relapse potential (D5>=3) + co-occurring (D3>=2) qualifies ASAM 3.5', () => {
  const input: AsamInput = {
    gates: { withdrawalRisk: false, medicalInstability: false, acutePsych: false },
    dims: [2, 1, 3, 2, 4, 3],
  };
  const result = evaluateAsamLevel(input);
  assert.equal(result.level, 'ASAM_3_5');
  assert.equal(result.allowed, true);
  assert.ok(result.label.includes('ASAM 3.5 High-Intensity'));
});

test('ASAM Engine: Relapse risk or recovery environment >=2 qualifies ASAM 3.1 low-intensity', () => {
  const input: AsamInput = {
    gates: { withdrawalRisk: false, medicalInstability: false, acutePsych: false },
    dims: [1, 1, 1, 1, 2, 2],
  };
  const result = evaluateAsamLevel(input);
  assert.equal(result.level, 'ASAM_3_1');
  assert.equal(result.allowed, true);
  assert.ok(result.label.includes('ASAM 3.1 Low-Intensity'));
});

test('ASAM Engine: Low severity across all dimensions routes to outpatient IOP', () => {
  const input: AsamInput = {
    gates: { withdrawalRisk: false, medicalInstability: false, acutePsych: false },
    dims: [0, 0, 1, 1, 1, 1],
  };
  const result = evaluateAsamLevel(input);
  assert.equal(result.level, 'OUTPATIENT_IOP');
  assert.equal(result.allowed, false);
});

// ---------------------------------------------------------------------------
// 3. Maryland Health-General § 10-6A-05 Statutory Screen
// ---------------------------------------------------------------------------
test('AOT Screen: Minor respondents are redirected to Child & Adolescent Services', () => {
  const criteria: AotCriteria = {
    isAdult: false,
    meetsInpatient: false,
    willVoluntarilyEngage: false,
    hasSmi: true,
    needsSafetySupervision: true,
    historyHospitalizations: true,
    historyViolence: false,
    unlikelyAdhereVoluntary: true,
    leastRestrictiveAlt: true,
  };
  const res = evaluateAotEligibility(criteria);
  assert.equal(res.eligible, false);
  assert.equal(res.action, 'REFER_CHILD_SERVICES');
});

test('AOT Screen: Imminent danger / inpatient criteria diverts to ER evaluation', () => {
  const criteria: AotCriteria = {
    isAdult: true,
    meetsInpatient: true,
    willVoluntarilyEngage: false,
    hasSmi: true,
    needsSafetySupervision: true,
    historyHospitalizations: true,
    historyViolence: false,
    unlikelyAdhereVoluntary: true,
    leastRestrictiveAlt: true,
  };
  const res = evaluateAotEligibility(criteria);
  assert.equal(res.eligible, false);
  assert.equal(res.action, 'INPATIENT_EMERGENCY_EVAL');
});

test('AOT Screen: Meets full § 10-6A-05 statutory criteria with 3-year hospitalization prong', () => {
  const criteria: AotCriteria = {
    isAdult: true,
    meetsInpatient: false,
    willVoluntarilyEngage: false,
    hasSmi: true,
    needsSafetySupervision: true,
    historyHospitalizations: true,
    historyViolence: false,
    unlikelyAdhereVoluntary: true,
    leastRestrictiveAlt: true,
  };
  const res = evaluateAotEligibility(criteria);
  assert.equal(res.eligible, true);
  assert.equal(res.action, 'BUILD_PETITION_PACKET');
  assert.equal(res.statutoryCode, 'MD_HG_10_6A_05');
});

test('AOT Screen: Meets full § 10-6A-05 statutory criteria with 3-year violence prong', () => {
  const criteria: AotCriteria = {
    isAdult: true,
    meetsInpatient: false,
    willVoluntarilyEngage: false,
    hasSmi: true,
    needsSafetySupervision: true,
    historyHospitalizations: false,
    historyViolence: true, // violent act / threat satisfies 3-year history
    unlikelyAdhereVoluntary: true,
    leastRestrictiveAlt: true,
  };
  const res = evaluateAotEligibility(criteria);
  assert.equal(res.eligible, true);
  assert.equal(res.action, 'BUILD_PETITION_PACKET');
  assert.equal(res.statutoryCode, 'MD_HG_10_6A_05');
});

test('AOT Screen: Failing 3-year prong routes to Outpatient Assertive Engagement', () => {
  const criteria: AotCriteria = {
    isAdult: true,
    meetsInpatient: false,
    willVoluntarilyEngage: false,
    hasSmi: true,
    needsSafetySupervision: true,
    historyHospitalizations: false,
    historyViolence: false,
    unlikelyAdhereVoluntary: true,
    leastRestrictiveAlt: true,
  };
  const res = evaluateAotEligibility(criteria);
  assert.equal(res.eligible, false);
  assert.equal(res.action, 'OUTPATIENT_ASSERTIVE_ENGAGEMENT');
});

// ---------------------------------------------------------------------------
// 4. Residential & Crisis Charge Scrubber & Hold Guard
// ---------------------------------------------------------------------------
test('Charge Scrubber: Residential H0018 / H0019 blocked when CSR is overdue', async () => {
  const charge: ChargeAuditInput = {
    cptCode: 'H0018',
    clientId: 'client-1',
    dos: new Date(),
    csrStatus: 'OVERDUE',
    priorAuth: { remainingUnits: 15, isActive: true },
  };
  const audit = await auditChargeForBilling(charge);
  assert.equal(audit.status, 'BLOCKED');
  assert.equal(audit.reason, 'csr_overdue');
  assert.ok(audit.detail?.includes('Continued-stay review lapsed'));
});

test('Charge Scrubber: Residential H0018 / H0019 blocked when Prior Auth is missing or exhausted', async () => {
  // Missing PA
  const missingPa: ChargeAuditInput = {
    cptCode: 'H0019',
    clientId: 'client-2',
    dos: new Date(),
    csrStatus: 'CURRENT',
    priorAuth: null,
  };
  const res1 = await auditChargeForBilling(missingPa);
  assert.equal(res1.status, 'BLOCKED');
  assert.equal(res1.reason, 'pa_missing');

  // Exhausted PA
  const exhaustedPa: ChargeAuditInput = {
    ...missingPa,
    priorAuth: { remainingUnits: 0, isActive: true },
  };
  const res2 = await auditChargeForBilling(exhaustedPa);
  assert.equal(res2.status, 'BLOCKED');
  assert.equal(res2.reason, 'pa_exhausted');
});

test('Charge Scrubber: Clean residential per-diem releases with READY status', async () => {
  const cleanCharge: ChargeAuditInput = {
    cptCode: 'H0018',
    clientId: 'client-3',
    dos: new Date(),
    csrStatus: 'CURRENT',
    priorAuth: { remainingUnits: 20, isActive: true },
  };
  const audit = await auditChargeForBilling(cleanCharge);
  assert.equal(audit.status, 'READY');
  assert.equal(audit.reason, null);
});

test('Charge Scrubber: Crisis H2011 held until documentation and notifications complete', async () => {
  const incompleteCrisis: ChargeAuditInput = {
    cptCode: 'H2011',
    clientId: 'episode-1',
    dos: new Date(),
    crisisDocComplete: false,
    crisisNotified: true,
  };
  const res = await auditChargeForBilling(incompleteCrisis);
  assert.equal(res.status, 'HELD');
  assert.equal(res.reason, 'doc_incomplete');

  const readyCrisis: ChargeAuditInput = {
    ...incompleteCrisis,
    crisisDocComplete: true,
    crisisNotified: true,
  };
  const res2 = await auditChargeForBilling(readyCrisis);
  assert.equal(res2.status, 'READY');
  assert.equal(res2.reason, null);
});

// ---------------------------------------------------------------------------
// 5. AI Assists & Clinical Scribe
// ---------------------------------------------------------------------------
test('AI Assists: Aria Triage Copilot generates de-escalating probe questions', async () => {
  const probe = await generateTriageProbe({
    symptoms: 'Severely overwhelmed, pacing, auditory hallucinations',
    location: 'Penn-North Baltimore',
  });
  assert.ok(probe.copilot.includes('Aria'));
  assert.ok(probe.probeQuestions.length >= 2);
  assert.ok(probe.safetyRationale.length > 0);
});

test('AI Assists: Episode Summary formats CARF-compliant note and LRA narrative', async () => {
  const summary = await generateEpisodeSummary({
    episodeNumber: 'MC-2026-0099',
    clientName: 'Jordan Taylor',
    timeline: [
      { time: '14:00', label: 'Dispatched', note: 'Unit 1 sent', kind: 'dispatch' },
      { time: '14:22', label: 'Arrived', note: 'Engaged safely', kind: 'arrival' },
    ],
    mse: { appearance: 'Cooperative', mood: 'Anxious' },
    interventions: ['Verbal De-escalation', 'Stanley-Brown Safety Plan'],
    lraNarrative: 'Least Restrictive Alternative achieved via natural support.',
  });
  assert.ok(summary.note.includes('MOBILE CRISIS INTERVENTION ENCOUNTER NOTE'));
  assert.ok(summary.note.includes('Jordan Taylor'));
  assert.ok(summary.lraJustification.includes('Least Restrictive Alternative'));
});

test('AI Assists: CSR Drafter generates ASAM continued-stay medical necessity note', async () => {
  const csr = await generateCsrDraft({
    residentName: 'Derek Thorne',
    program: '3.5',
    losDays: 14,
    counselor: 'Sarah Jenkins, LCADC',
  });
  assert.ok(csr.justification.includes('ASAM LEVEL 3.5'));
  assert.ok(csr.justification.includes('Derek Thorne'));
  assert.ok(csr.justification.includes('Dimension 1'));
  assert.ok(csr.justification.includes('Dimension 5'));
});

test('AI Assists: Appeal Letter Drafter includes MHPAEA, COMAR, and CARC dispute', async () => {
  const appeal = await generateAppealLetter({
    clientName: 'Elena Rostova',
    payer: 'Optum Maryland (OMDBH)',
    dos: '2026-10-01',
    cptCode: 'H0018',
    reasonCode: 'CO-16',
    reasonText: 'Claim lacks authorization',
    amountCents: 38500,
    mbcScores: { phq9: 18, gad7: 15 },
  });
  assert.ok(appeal.letter.includes('MHPAEA'));
  assert.ok(appeal.letter.includes('COMAR 10.09.24'));
  assert.ok(appeal.letter.includes('$385.00'));
  assert.ok(appeal.letter.includes('CO-16'));
});
