import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { completeness as tpCompleteness, minimumServicesCovered } from '../src/lib/aot/forms/treatmentPlan';
import { completeness as affCompleteness, deriveAdult } from '../src/lib/aot/forms/affidavit';
import { completeness as complaintCompleteness, mandatoryReportingTriggered, NOTIFICATION_PARTIES } from '../src/lib/aot/forms/complaint';
import { completeness as epCompleteness } from '../src/lib/aot/forms/epNotification';
import { completeness as continuedCompleteness } from '../src/lib/aot/forms/continuedPlan';
import {
  completeness as letterCompleteness,
  LETTER_RESPONSES,
  LETTER_TEXT,
  MDH_FOOTER,
  NONRESPONSIVE_LETTER,
} from '../src/lib/aot/forms/nonresponsiveLetter';
import {
  aotFormFlags,
  continuedPlanDueDate,
  failedOutreachStreak,
  isFailedOutreach,
  suggestNonResponsiveLetter,
} from '../src/lib/aot/forms/deadlines';
import { buildPrefill, insuranceCategories, splitName } from '../src/lib/aot/forms/prefill';
import { FORM_DEFINITIONS, FORM_TYPES, emptyData, parseFormData, progress, signingState } from '../src/lib/aot/forms';
import { canSignSlot } from '../src/lib/aot/forms/roles';
import {
  checklistFromEligibility,
  countyToCctRegion,
  hasOperationalCct,
  maxOrderEnd,
  normalizeChecklist,
  orderTermProblem,
  personLabel,
  petitionChecklistFlags,
  petitionerIssueIn,
  petitionerProblems,
  PETITION_CHECKLIST,
} from '../src/lib/aot/mdh';
import { AOT_RESOURCE_SEEDS, SEED_ITEMS } from '../src/lib/resources/seedCatalog';

const ROOT = path.join(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const service = (serviceType: string, extra: Record<string, unknown> = {}) => ({
  serviceType,
  actTeam: [],
  organization: 'Community Provider',
  providerAgreed: 'yes',
  providerAgreedDate: '2026-10-01',
  ...extra,
});

function completeTreatmentPlan(): Record<string, unknown> {
  return {
    psychiatristName: 'Dr. Example',
    planCompletionDate: '2026-10-15',
    representedByCounsel: 'no',
    hasHealthCareAgent: 'no',
    hasLegalGuardian: 'no',
    firstName: 'Pat',
    lastName: 'Respondent',
    dob: '1990-01-01',
    spmi: 'yes',
    spmiHow: 'Course of illness documented.',
    diagnoses: [{ diagnosis: 'Schizophrenia', code: 'F20.9', determinedBy: 'both' }],
    engagementEfforts: 'Phone and in-person outreach.',
    educationProvided: 'no',
    disabilities: ['none'],
    cprsAvailable: 'no',
    caseManagerAvailable: 'no',
    psychiatristAvailable: 'no',
    guardianParticipation: 'none_identified',
    healthCareAgentParticipation: 'none_identified',
    otherDesignatedParticipation: 'none_identified',
    livingSituation: 'unknown',
    transportationProblems: 'unknown',
    foodProblems: 'unknown',
    snap: 'unknown',
    incomeSources: ['unknown'],
    insurance: ['unknown'],
    hrsnPlan: 'Reviewed with the respondent.',
    mhAdvanceDirective: 'no',
    medicalAdvanceDirective: 'no',
    goals: [{ area: 'Housing/Living Arrangements', goal: '"I want my own place"', timeFrame: '6 months' }],
    services: [service('psychiatrist'), service('case_management'), service('cprs')],
    medicationIncluded: 'no',
  };
}

// ─── Treatment plan ────────────────────────────────────────────────────────

test('treatment plan: a complete plan has no missing items', () => {
  assert.deepEqual(tpCompleteness(completeTreatmentPlan()), []);
  assert.equal(progress(FORM_DEFINITIONS.treatment_plan, completeTreatmentPlan()).pct, 100);
});

test('treatment plan: psychiatrist, case management and CPRS are required (ACT or separately)', () => {
  const d = completeTreatmentPlan();
  d.services = [service('psychiatrist'), service('case_management')];
  assert.ok(tpCompleteness(d).some((m) => /CPRS services/.test(m)));

  d.services = [service('act', { actTeam: ['psychiatrist', 'case_manager', 'cprs'] })];
  assert.deepEqual(minimumServicesCovered(d), { psychiatrist: true, caseManagement: true, cprs: true });
  assert.deepEqual(tpCompleteness(d), []);

  d.services = [service('act', { actTeam: ['psychiatrist', 'case_manager'] })];
  assert.ok(tpCompleteness(d).some((m) => /CPRS services/.test(m)));
});

test('treatment plan: every service needs a community provider that agreed, with the date (HG §10-6A-06)', () => {
  const d = completeTreatmentPlan();
  d.services = [service('psychiatrist'), service('case_management', { providerAgreed: 'no' }), service('cprs', { providerAgreedDate: '' })];
  const msg = tpCompleteness(d).find((m) => /10-6A-06/.test(m));
  assert.ok(msg);
  assert.match(msg!, /row 2, 3/);
});

test('treatment plan: medication worksheet is required only when medication is included', () => {
  const d = completeTreatmentPlan();
  assert.ok(!tpCompleteness(d).some((m) => /Medication worksheet/.test(m)));
  d.medicationIncluded = 'yes';
  const missing = tpCompleteness(d);
  assert.ok(missing.some((m) => /Medication worksheet: Medications/.test(m)));
  assert.ok(missing.some((m) => /side effects/.test(m)));
  d.medications = [{ medication: 'Drug A', dosageRange: '1-2 mg', route: 'PO', indication: 'Psychosis', administration: 'self' }];
  d.sideEffects = 'Discussed.';
  d.medsDiscussed = 'Discussed with respondent.';
  d.alternativesConsidered = 'Considered.';
  d.medsForMaintenance = 'yes';
  assert.deepEqual(tpCompleteness(d), []);
  d.medications = [{ medication: 'Drug A' }];
  assert.ok(tpCompleteness(d).some((m) => /dosage range, route and reason/.test(m)));
});

test('treatment plan: advance medical directive "Yes" requires an attachment reference', () => {
  const d = completeTreatmentPlan();
  d.medicalAdvanceDirective = 'yes';
  d.medicalAdvanceDirectiveHonored = 'Will be honored.';
  assert.ok(tpCompleteness(d).some((m) => /must be attached/.test(m)));
  d.medicalAdvanceDirectiveAttachment = 'Chart doc 123';
  assert.deepEqual(tpCompleteness(d), []);
});

// ─── Affidavit ─────────────────────────────────────────────────────────────

function completeAffidavit(): Record<string, unknown> {
  return deriveAdult({
    psychiatristName: 'Dr. Example',
    respondentName: 'Pat Respondent',
    examDate: '2026-10-10',
    respondentDob: '1990-01-01',
    c_spmi: true,
    c_hospitalization: true,
    c_hospitalizationDetails: 'Two admissions.',
    c_needsAot: true,
    c_unlikelyAdhere: true,
    c_unlikelyAdhereFacts: 'Stopped treatment twice; not financial, transportation or language access.',
    willingToTestify: true,
    notRelatedToRespondent: true,
    petitionerName: 'Petitioner',
    notRelatedToPetitioner: true,
    financialInterest: 'none',
  });
}

test('affidavit: complete affidavit passes; 2a follows the date of birth', () => {
  const d = completeAffidavit();
  assert.equal(d.c_adult, true);
  assert.deepEqual(affCompleteness(d), []);
});

test('affidavit: at least one lack-of-adherence criterion (2c i or ii) is required', () => {
  const d = completeAffidavit();
  d.c_hospitalization = false;
  assert.ok(affCompleteness(d).some((m) => /2c/.test(m)));
  d.c_violence = true;
  d.c_violenceDetails = 'Threat on 2026-05-01.';
  assert.deepEqual(affCompleteness(d), []);
});

test('affidavit: a respondent under 18 is blocked', () => {
  const d = deriveAdult({ ...completeAffidavit(), respondentDob: '2010-06-01' });
  assert.equal(d.c_adult, false);
  const missing = affCompleteness(d);
  assert.ok(missing.some((m) => /under 18/.test(m)));
  // A client cannot force 2a: derive() recomputes it from the DOB on save.
  const forced = parseFormData('psychiatrist_affidavit', { ...d, c_adult: true });
  assert.equal(forced.ok, true);
  assert.equal(forced.data!.c_adult, false);
});

test('affidavit: exam-date timing is a non-blocking warning quoting MDH', () => {
  const def = FORM_DEFINITIONS.psychiatrist_affidavit;
  const w = def.warnings!(completeAffidavit(), new Date('2026-12-31T12:00:00Z'));
  assert.equal(w.length, 1);
  assert.match(w[0], /examined the individual atleast 30 days prior to the petition filing/);
  assert.match(w[0], /may mean within 30 days before filing; confirm with counsel/);
  assert.deepEqual(def.warnings!(completeAffidavit(), new Date('2026-10-20T12:00:00Z')), []);
});

// ─── Complaint, EP, continued plan, letter ─────────────────────────────────

test('complaint: at least one type is required; APS/CPS/law enforcement require the mandatory-reporting confirmation', () => {
  const d: Record<string, unknown> = {
    reportDate: '2026-10-20',
    reporterName: 'Staff',
    reporterOrg: 'Clinic',
    reporterRole: 'cct_staff',
    mayContact: 'yes',
    participantName: 'Pat',
    region: 'other',
    aotStatus: 'active_order',
    incidentDate: '2026-10-19',
    location: 'Clinic',
    whatOccurred: 'Described.',
    lawEnforcement: 'no',
    emergencyMedical: 'no',
    sentToHospital: 'no',
    immediateActions: 'Actions.',
    notifications: NOTIFICATION_PARTIES.map((party) => ({ party, notified: false, date: '' })),
  };
  assert.ok(complaintCompleteness(d).some((m) => /at least one type/.test(m)));
  d.complaintTypes = ['communication'];
  assert.deepEqual(complaintCompleteness(d), []);

  d.notifications = NOTIFICATION_PARTIES.map((party) => ({ party, notified: party === 'APS', date: party === 'APS' ? '2026-10-19' : '' }));
  assert.equal(mandatoryReportingTriggered(d), true);
  assert.ok(complaintCompleteness(d).some((m) => /Mandatory reporting is separate/.test(m)));
  d.mandatoryReportingConfirmed = true;
  assert.deepEqual(complaintCompleteness(d), []);
});

test('EP notification, continued plan and letter report their required fields', () => {
  assert.ok(epCompleteness({}).some((m) => /Date of emergency petition/.test(m)));
  assert.ok(continuedCompleteness({}).some((m) => /Participant ID/.test(m)));
  assert.ok(letterCompleteness({}).some((m) => /Outreach attempts/.test(m)));
  // "No" on diagnoses-same requires the changes
  assert.ok(continuedCompleteness({ diagnosesSame: 'no' }).some((m) => /Diagnoses: Changes/.test(m)));
});

test('non-responsive letter: MDH#0002BHA wording is verbatim, fixed, and only the blanks are editable', () => {
  assert.equal(
    LETTER_TEXT.intro,
    'The Maryland Assisted Outpatient Treatment (AOT) Program is writing to document our efforts to contact you regarding participation in the treatment plan development process associated with your AOT matter.',
  );
  assert.equal(LETTER_TEXT.outreachIntro, 'The AOT Team attempted to contact you regarding an initial engagement meeting on the following dates:');
  assert.match(LETTER_TEXT.orientation1, /^Assisted Outpatient Treatment \(AOT\) is a court-based outpatient treatment process/);
  assert.match(LETTER_TEXT.orientation2, /who assist with treatment planning, referrals, and coordination of care\.$/);
  assert.equal(LETTER_TEXT.preferencesBullets.length, 5);
  assert.equal(LETTER_TEXT.preferencesReturn, 'Please return written preferences to the address above or contact our office directly.');
  assert.equal(LETTER_TEXT.enclosures, 'Enclosures: Optional Initial Engagement Meeting Form/ Return Envelope');
  assert.equal(LETTER_TEXT.cc, 'cc: Counsel for Respondent');
  assert.deepEqual(
    LETTER_RESPONSES.map((o) => o.label),
    ['You declined to participate at this time.', 'We did not receive a response to our outreach attempts.', 'Other'],
  );
  assert.match(MDH_FOOTER, /Toll Free: 1-877-463-3464 · Deaf and Hard of Hearing Use Relay · MDH#0002BHA-Revised 06\/25\/2026$/);
  assert.ok(NONRESPONSIVE_LETTER.wordingVerified);

  // Body text is static (never stored, never editable); the schema drops any attempt to override it.
  const editable = NONRESPONSIVE_LETTER.sections.flatMap((s) => s.fields).filter((f) => f.type !== 'static').map((f) => f.key);
  assert.deepEqual(editable.sort(), [
    'contactEmail', 'contactName', 'contactPhone', 'directorName', 'letterDate', 'mailingAddress', 'outreachAttempts',
    'regionalOfficeAddress', 'regionalOfficeCity', 'regionalOfficeEmail', 'regionalOfficePhone', 'respondentName', 'responseOther', 'responseStatus',
  ]);
  const parsed = parseFormData('nonresponsive_letter', { bodyIntro: 'edited', orientationText: 'edited', contactName: 'AOT Office' });
  assert.equal(parsed.ok, true);
  assert.equal('bodyIntro' in parsed.data!, false);
  assert.equal('orientationText' in parsed.data!, false);
  const missing = letterCompleteness({});
  for (const label of ['AOT Program Contact', 'Phone', 'Email', 'Participation status']) assert.ok(missing.some((m) => m.includes(label)), label);
});

test('schemas strip unknown keys and reject values outside the option lists', () => {
  const ok = parseFormData('treatment_plan', { firstName: 'Pat', injected: 'x', _meta: { signatures: [{ slot: 'psychiatrist' }] } });
  assert.equal(ok.ok, true);
  assert.equal('injected' in ok.data!, false);
  assert.equal('_meta' in ok.data!, false);
  assert.equal(parseFormData('treatment_plan', { livingSituation: 'castle' }).ok, false);
  assert.equal(parseFormData('complaint', { complaintTypes: ['not_a_type'] }).ok, false);
  for (const t of FORM_TYPES) assert.equal(parseFormData(t, emptyData(FORM_DEFINITIONS[t])).ok, true, t);
});

// ─── Signing rules ─────────────────────────────────────────────────────────

test('signing: affidavit is psychiatrist-only; treatment plan also allows the verified Medical Director', () => {
  const aff = FORM_DEFINITIONS.psychiatrist_affidavit.signers[0];
  assert.equal(canSignSlot(aff, { role: 'PSYCHIATRIST' }), true);
  assert.equal(canSignSlot(aff, { role: 'NP' }), false);
  assert.equal(canSignSlot(aff, { role: 'NP', medicalDirector: true }), false);
  const tp = FORM_DEFINITIONS.treatment_plan.signers[0];
  assert.equal(canSignSlot(tp, { role: 'NP', medicalDirector: true }), true);
  assert.equal(canSignSlot(tp, { role: 'THERAPIST' }), false);
  const letter = FORM_DEFINITIONS.nonresponsive_letter.signers[0];
  assert.equal(canSignSlot(letter, { role: 'PRACTICE_DIRECTOR' }), true);
  assert.equal(canSignSlot(letter, { role: 'CASE_MANAGER' }), false);
  const cont = FORM_DEFINITIONS.continued_treatment_plan;
  const st = signingState(cont, { _meta: { signatures: [{ slot: 'psychiatrist', userId: 'u1', name: 'A', role: 'PSYCHIATRIST', signedAt: '', attestation: '' }] } }, { role: 'CASE_MANAGER' });
  assert.deepEqual(st.pending.map((s) => s.id), ['case_manager', 'staff']);
  assert.deepEqual(st.mySlots.map((s) => s.id), ['case_manager', 'staff']);
  assert.equal(st.complete, false);
});

// ─── Deadlines and outreach ────────────────────────────────────────────────

test('continued plan due date is order end minus 30 days', () => {
  assert.equal(continuedPlanDueDate('2027-03-31'), '2027-03-01');
  assert.equal(continuedPlanDueDate(new Date('2027-01-15T00:00:00Z')), '2026-12-16');
  assert.equal(continuedPlanDueDate(null), null);
});

test('caseboard flags: continued plan, unsigned treatment plan / affidavit', () => {
  const now = new Date('2027-02-20T15:00:00Z');
  const active = { status: 'active', orderStart: '2026-10-01', orderEnd: '2027-03-31' };
  const f = aotFormFlags(active, [], [], now);
  const cp = f.find((x) => x.formType === 'continued_treatment_plan');
  assert.ok(cp);
  assert.equal(cp!.due, '2027-03-01');
  assert.equal(cp!.daysLeft, 9);
  assert.equal(cp!.status, 'upcoming');
  // A plan signed in this order period clears it; one signed before the order started does not.
  assert.equal(aotFormFlags(active, [{ formType: 'continued_treatment_plan', status: 'signed', signedAt: '2027-02-10' }], [], now).length, 0);
  assert.equal(aotFormFlags(active, [{ formType: 'continued_treatment_plan', status: 'signed', signedAt: '2026-01-10' }], [], now).length, 1);

  const hearing = { status: 'hearing', hearingDate: '2027-02-25', petitionDate: '2027-02-01' };
  const hf = aotFormFlags(hearing, [], [], now).map((x) => x.formType).sort();
  assert.deepEqual(hf, ['psychiatrist_affidavit', 'treatment_plan']);
  const signedBoth = [
    { formType: 'treatment_plan', status: 'signed', signedAt: '2027-02-10' },
    { formType: 'psychiatrist_affidavit', status: 'signed', signedAt: '2027-01-30' },
  ];
  assert.equal(aotFormFlags(hearing, signedBoth, [], now).length, 0);
  // drafts do not count as signed
  assert.equal(aotFormFlags(hearing, [{ formType: 'treatment_plan', status: 'draft' }], [], now).some((x) => x.formType === 'treatment_plan'), true);
});

test('outreach: three failed attempts in a row suggest the non-responsive letter', () => {
  const a = (d: string, result: string) => ({ attemptedAt: `${d}T12:00:00Z`, result });
  assert.equal(isFailedOutreach('No answer — voicemail full'), true);
  assert.equal(isFailedOutreach('Reached — engaged'), false);
  assert.equal(isFailedOutreach('Certified letter MDH#0002BHA mailed'), false);
  const two = [a('2026-10-01', 'No answer'), a('2026-10-03', 'Left message')];
  assert.equal(suggestNonResponsiveLetter(two), false);
  const three = [...two, a('2026-10-05', 'Declined')];
  assert.equal(failedOutreachStreak(three), 3);
  assert.equal(suggestNonResponsiveLetter(three), true);
  // a successful contact resets the streak
  assert.equal(suggestNonResponsiveLetter([...three, a('2026-10-06', 'Reached — engaged')]), false);
  // a letter signed after the last attempt satisfies it
  assert.equal(suggestNonResponsiveLetter(three, '2026-10-07T00:00:00Z'), false);
  assert.equal(suggestNonResponsiveLetter(three, '2026-10-04T00:00:00Z'), true);
  const flags = aotFormFlags({ status: 'screening' }, [], three, new Date('2026-10-08T00:00:00Z'));
  assert.equal(flags.length, 1);
  assert.equal(flags[0].formType, 'nonresponsive_letter');
});

// ─── Prefill: only recorded values ─────────────────────────────────────────

test('prefill never invents values and never pre-checks attestations', () => {
  const bare = buildPrefill('treatment_plan', { participant: { name: 'Pat Q Respondent' }, client: null, actor: { name: 'Office User', role: 'OFFICE_MANAGER' } });
  assert.deepEqual(Object.keys(bare.data).sort(), ['firstName', 'lastName']);
  assert.equal(bare.data.lastName, 'Q Respondent');
  assert.match(bare.sources.firstName, /verify/);

  const aff = buildPrefill('psychiatrist_affidavit', {
    participant: {
      name: 'Pat Respondent',
      eligibilityData: { petitioner: { name: 'Sam Petitioner' }, screenAnswers: { priorHospitalizations: 'yes' } },
      psychiatristAffidavit: { examDate: '2026-10-01', basis: { history: 'Two stays', voluntary: 'Refused', smi: 'Dx', safety: 'Risk' } },
    },
    client: { name: 'Pat Respondent', dateOfBirth: new Date('1990-01-01T00:00:00Z') },
    actor: { name: 'Dr. P', role: 'PSYCHIATRIST' },
  });
  assert.equal(aff.data.psychiatristName, 'Dr. P');
  assert.equal(aff.data.petitionerName, 'Sam Petitioner');
  assert.equal(aff.data.respondentDob, '1990-01-01');
  assert.equal(aff.data.c_hospitalizationDetails, 'Two stays');
  assert.equal(aff.data.c_unlikelyAdhereFacts, 'Refused');
  for (const k of ['c_spmi', 'c_hospitalization', 'c_violence', 'c_needsAot', 'c_unlikelyAdhere', 'willingToTestify', 'notRelatedToRespondent', 'notRelatedToPetitioner']) {
    assert.equal(k in aff.data, false, k);
  }

  const tp = buildPrefill('treatment_plan', {
    participant: { name: 'Pat Respondent' },
    client: { name: 'Pat Respondent', insuranceType: 'Medicaid' },
    coverages: [{ payerName: 'Medicare Part B', claimFilingCode: 'MB', active: true }],
    diagnoses: [{ code: 'F20.9', label: 'Schizophrenia' }],
    outreach: [{ attemptedAt: '2026-10-02T12:00:00Z', method: 'phone', staffRole: 'cprs', result: 'No answer' }],
    actor: { name: 'Office', role: 'OFFICE_MANAGER' },
  });
  assert.deepEqual((tp.data.insurance as string[]).sort(), ['medicaid', 'medicare']);
  assert.deepEqual(tp.data.diagnoses, [{ diagnosis: 'Schizophrenia', code: 'F20.9', determinedBy: '' }]);
  assert.match(String(tp.data.engagementEfforts), /2026-10-02 — Phone \(CPRS\): No answer/);
  assert.equal('psychiatristName' in tp.data, false); // not a psychiatrist: left blank
  assert.equal('services' in tp.data, false);
});

test('prefill helpers', () => {
  assert.deepEqual(splitName('Cher'), { first: 'Cher', last: '' });
  assert.deepEqual(insuranceCategories(null, []), []);
  assert.deepEqual(insuranceCategories({ insurancePayer: 'Unknown Plan' }, []), []);
});

// ─── Wiring: storage, routes, audit ────────────────────────────────────────

test('migration 20261021_aot_documents.sql matches the schema and is idempotent', () => {
  const schema = read('prisma/schema.prisma');
  const sql = read('prisma/migrations/20261021_aot_documents.sql');
  for (const [model, table] of [['AotDocument', 'aot_documents'], ['AotOutreachAttempt', 'aot_outreach_attempts']]) {
    const m = schema.match(new RegExp(`model ${model} \\{([\\s\\S]*?)\\n\\}`));
    assert.ok(m, model);
    assert.match(m![1], new RegExp(`@@map\\("${table}"\\)`));
    const cols = m![1]
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('//') && !l.startsWith('@@'))
      .map((l) => l.match(/@map\("([^"]+)"\)/)?.[1] ?? l.split(/\s+/)[0]);
    const create = sql.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\);`));
    assert.ok(create, table);
    const sqlCols = [...create![1].matchAll(/^\s*"(\w+)"/gm)].map((x) => x[1]);
    assert.deepEqual([...sqlCols].sort(), [...cols].sort(), table);
  }
  assert.ok(!/CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/.test(sql));
  // ON DELETE CASCADE (foreign keys) is fine; no row deletes / inserts / drops
  assert.ok(!/\bDROP\b|(?<!ON )\bDELETE\b|\bINSERT\b/i.test(sql));
});

test('AOT document routes are org scoped, role gated and audited', () => {
  const list = read('src/app/api/aot/documents/route.ts');
  assert.match(list, /findParticipantInOrg\(participantId, gate\.organizationId\)/);
  assert.match(list, /action: 'CREATE'/);
  const one = read('src/app/api/aot/documents/[id]/route.ts');
  assert.match(one, /action: print \? 'PRINT' : 'READ'/);
  assert.match(one, /status !== 'draft'/);
  const sign = read('src/app/api/aot/documents/[id]/sign/route.ts');
  assert.match(sign, /canSignSlot\(slot, actor\)/);
  assert.match(sign, /missingItems\(def, fields\)/);
  assert.match(sign, /action: 'SIGN'/);
  assert.match(sign, /status: 'superseded'/);
  assert.match(sign, /kind: 'emergency_petition'/);
  const lib = read('src/lib/aot/documents.ts');
  assert.match(lib, /findParticipantInOrg\(doc\.participantId, organizationId\)/);
  assert.match(lib, /clientAccessWhere\(/);
  const outreach = read('src/app/api/aot/outreach/route.ts');
  assert.match(outreach, /findParticipantInOrg\(/);
  assert.match(outreach, /auditPhiAccess\(/);
  assert.match(read('src/app/api/aot/caseboard/route.ts'), /formFlags: formState\.get\(p\.id\)\?\.flags/);
  assert.match(read('src/app/dashboard/aot/page.tsx'), /<AotFormsWorkspace /);
  assert.match(read('docs/source-forms/md-aot-forms-2026-06-25.md'), /MDH#0001BHA/);
});

// ─── MDH AOT Resource Center (docs/source-forms/mdh-aot-resource-center-2026-10-20.md) ───

test('county maps to the MDH CCT region; other counties map to none', () => {
  assert.equal(countyToCctRegion('Baltimore City'), 'baltimore_city');
  assert.equal(countyToCctRegion('Anne Arundel County'), 'anne_arundel');
  assert.equal(countyToCctRegion('Anne Arundel'), 'anne_arundel');
  for (const c of ['Kent', "Queen Anne's County", 'Queen Annes', 'Caroline', 'Dorchester', 'Wicomico County', 'Somerset', 'Worcester', 'Cecil', 'Talbot']) {
    assert.equal(countyToCctRegion(c), 'eastern_shore', c);
  }
  for (const c of ['Baltimore County', 'Baltimore', 'Montgomery', "Prince George's", 'Howard', 'Not documented', '', null]) {
    assert.equal(countyToCctRegion(c), null, String(c));
  }
  assert.equal(hasOperationalCct('Talbot County'), true);
  assert.equal(hasOperationalCct('Harford'), false);
});

test('complaint prefill: Region follows a mapped county, stays unselected otherwise', () => {
  const pre = (county: string) =>
    buildPrefill('complaint', { participant: { name: 'Pat R', county, status: 'active' }, client: null, actor: { name: 'Staff', role: 'CASE_MANAGER' } });
  assert.equal(pre("Queen Anne's").data.region, 'eastern_shore');
  assert.match(pre("Queen Anne's").sources.region, /Eastern Shore/);
  assert.equal(pre('Baltimore City').data.region, 'baltimore_city');
  assert.equal('region' in pre('Montgomery').data, false);
  assert.equal('region' in pre('Baltimore County').data, false);
  const regionField = FORM_DEFINITIONS.complaint.sections.flatMap((x) => x.fields).find((f) => f.key === 'region')!;
  assert.match(String(regionField.help), /Phase II \/ other: select manually/);
});

test('order term may not exceed one year (365 days, 366 across Feb 29)', () => {
  assert.equal(maxOrderEnd('2026-03-01'), '2027-03-01'); // 365 days
  assert.equal(orderTermProblem('2026-03-01', '2027-03-01'), null);
  assert.match(String(orderTermProblem('2026-03-01', '2027-03-02')), /cannot exceed one year.*2027-03-01/);
  // Across 29 Feb 2028: 366 days allowed
  assert.equal(maxOrderEnd('2027-03-01'), '2028-03-01');
  assert.equal(orderTermProblem('2027-03-01', '2028-03-01'), null);
  assert.ok(orderTermProblem('2027-03-01', '2028-03-02'));
  assert.equal(maxOrderEnd('2028-02-28'), '2029-02-28');
  assert.equal(maxOrderEnd('2028-02-29'), '2029-02-28');
  assert.equal(maxOrderEnd('2028-03-01'), '2029-03-01');
  // End before start; missing dates are not checked here
  assert.match(String(orderTermProblem('2026-05-01', '2026-04-01')), /before the order start/);
  assert.equal(orderTermProblem(null, '2030-01-01'), null);
  assert.equal(orderTermProblem(new Date('2026-01-01T00:00:00Z'), new Date('2027-01-01T00:00:00Z')), null);
});

test('petitioner: type and relationship required; individual must attest to being 18+', () => {
  assert.deepEqual(petitionerProblems({ type: 'program_director', relationship: 'Program director' }), []);
  assert.deepEqual(petitionerProblems({ type: 'individual', relationship: 'Mother', attestedAdult: true }), []);
  assert.match(petitionerProblems({ type: 'individual', relationship: 'Mother' }).join(), /at least 18/);
  assert.match(petitionerProblems({ type: 'individual', relationship: 'Mother', attestedAdult: false }).join(), /at least 18/);
  assert.match(petitionerProblems({ type: 'neighbor', relationship: 'x' }).join(), /petitioner type/);
  assert.match(petitionerProblems({ type: 'program_director', relationship: ' ' }).join(), /relationship/);
  assert.equal(petitionerIssueIn(undefined), null);
  assert.equal(petitionerIssueIn({ statute: 'HG' }), null);
  assert.match(String(petitionerIssueIn({ petitioner: { type: 'individual', relationship: 'Son' } })), /^Petitioner: /);
  // The affidavit prefill still reads the petitioner name
  const aff = buildPrefill('psychiatrist_affidavit', {
    participant: { name: 'Pat R', eligibilityData: { petitioner: { type: 'individual', name: 'Sam P', relationship: 'Sibling', attestedAdult: true } } },
    client: null,
    actor: { name: 'X', role: 'CASE_MANAGER' },
  });
  assert.equal(aff.data.petitionerName, 'Sam P');
});

test('Respondent before an order is granted, Participant after', () => {
  for (const s of ['referral', 'screening', 'petition', 'hearing']) assert.equal(personLabel(s), 'Respondent', s);
  for (const s of ['active', 'renewal', 'stepdown']) assert.equal(personLabel(s), 'Participant', s);
});

test('petition checklist: open steps flag only at the petition / hearing stage', () => {
  assert.equal(PETITION_CHECKLIST.length, 8);
  assert.equal(petitionChecklistFlags('petition', {}).length, 8);
  assert.equal(petitionChecklistFlags('hearing', {}).length, 8);
  assert.equal(petitionChecklistFlags('screening', {}).length, 0);
  assert.equal(petitionChecklistFlags('active', {}).length, 0);

  const c = normalizeChecklist({
    petition_filed: { done: true, date: '2026-10-01', by: 'A. Coordinator' },
    affidavit_filed: { done: 'yes', date: 'not a date' }, // not done: done must be true
    respondent_plan_opportunity: { done: true }, // needs an outcome
    unknown_step: { done: true },
  });
  assert.deepEqual(Object.keys(c).sort(), ['affidavit_filed', 'petition_filed', 'respondent_plan_opportunity']);
  assert.equal(c.petition_filed.done, true);
  assert.equal(c.petition_filed.by, 'A. Coordinator');
  assert.equal(c.affidavit_filed.done, false);
  assert.equal(c.affidavit_filed.date, null);
  assert.equal(c.respondent_plan_opportunity.done, false);
  assert.equal(petitionChecklistFlags('petition', c).length, 7);

  const declined = normalizeChecklist({ respondent_plan_opportunity: { outcome: 'declined', date: '2026-10-05' } });
  assert.equal(declined.respondent_plan_opportunity.done, true);
  assert.equal(declined.respondent_plan_opportunity.outcome, 'declined');
  assert.equal(normalizeChecklist({ respondent_plan_opportunity: { outcome: 'maybe' } }).respondent_plan_opportunity.done, false);

  const all = Object.fromEntries(PETITION_CHECKLIST.map((x) => [x.id, x.outcome ? { outcome: 'no_response' } : { done: true }]));
  assert.equal(petitionChecklistFlags('hearing', normalizeChecklist(all)).length, 0);
  assert.equal(checklistFromEligibility({ petitioner: {}, petitionChecklist: all }).cct_composition.done, true);
  assert.deepEqual(checklistFromEligibility(null), {});
});

test('MDH AOT resources are seeded as drafts without invented links', () => {
  const keys = AOT_RESOURCE_SEEDS.map((a) => a.seedKey);
  assert.equal(new Set(keys).size, keys.length);
  for (const a of AOT_RESOURCE_SEEDS) {
    assert.equal('url' in a, false, a.seedKey);
    assert.ok(!SEED_ITEMS.some((s) => s.seedKey === a.seedKey), `${a.seedKey} collides with a verified seed`);
    assert.match(a.summary, /Link to be added by staff/);
  }
  assert.ok(AOT_RESOURCE_SEEDS.find((a) => a.seedKey === 'aot-nami-family-helpline')!.contactText!.includes('1-800-950-NAMI (6264)'));
  const store = read('src/lib/resources/store.ts');
  assert.match(store, /for \(const a of AOT_RESOURCE_SEEDS\)[\s\S]*?url: null,[\s\S]*?status: 'draft'/);
});

test('AOT participant APIs: order term 400, exam timing is a warning only, checklist merges into eligibilityData', () => {
  const create = read('src/app/api/aot/participants/route.ts');
  assert.doesNotMatch(create, /status: 422/);
  assert.match(create, /warnings/);
  assert.match(create, /orderTermProblem[\s\S]*status: 400/);
  const patch = read('src/app/api/aot/participants/[id]/route.ts');
  assert.match(patch, /orderTermProblem/);
  assert.match(patch, /petitionChecklist: checklist/);
  const board = read('src/app/api/aot/caseboard/route.ts');
  assert.match(board, /petitionChecklistFlags/);
  assert.match(board, /orderTermProblem/);
  const doc = read('docs/source-forms/mdh-aot-resource-center-2026-10-20.md');
  assert.match(doc, /atleast 30 days prior to the petition filing/);
  assert.match(doc, /MDH\.AOT@Maryland\.gov/);
});
