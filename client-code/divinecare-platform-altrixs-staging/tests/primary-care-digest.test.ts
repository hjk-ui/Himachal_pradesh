import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  canGenerateChartDigest,
  canViewAnyChartDigest,
  canViewChartDigest,
  defaultDigestKind,
  digestKindsFor,
  kindsForScript,
  medicalAudienceFor,
  parseScriptKind,
} from '../src/lib/ai/chartDigest/access';
import { canSeeChartHistoryTab, canSeeMedicalHistoryTab, chartHistoryTabsFor, medicalHistoryPanelSections, MEDICAL_PANEL_ORDER } from '../src/lib/ai/chartDigest/panelOrder';
import { classifyMedicalDocument, isFamilyPracticeDocument } from '../src/lib/ai/chartDigest/medical/classify';
import {
  applyMedicalMinimumNecessary,
  combineMedicalDigest,
  isMinimumNecessaryBhItem,
  preventiveDueFrom,
  restrictForMedicalAssistant,
  structuredMedicalFacts,
  type StructuredSet,
} from '../src/lib/ai/chartDigest/medical/structured';
import {
  buildMedicalDigest,
  computeMedicalSourceHash,
  generateMedicalForViewer,
  selectMedicalSources,
  viewMedicalDigest,
  type MedicalDigestDeps,
  type MedicalSourceSet,
  type VisitRow,
} from '../src/lib/ai/chartDigest/medical/service';
import { emptyMedicalSections, type MedicalDigest } from '../src/lib/ai/chartDigest/medical/types';
import { MEDICAL_DIGEST_SYSTEM_PROMPT } from '../src/lib/ai/chartDigest/medical/prompt';
import { computeSourceHash, digestStaleness, type DigestAudit, type DocRow, type StoredDigest } from '../src/lib/ai/chartDigest/service';
import type { CareGap } from '../src/lib/medical/primaryCareWorkflow';

const ROOT = path.join(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const NOW = new Date('2026-10-25T14:00:00Z');

// ─── Fixtures ────────────────────────────────────────────────────────────────

function doc(id: string, over: Partial<DocRow> = {}): DocRow {
  return {
    id,
    documentType: 'Progress Note',
    fileName: `PN_20240105_Office Visit(${id}).pdf`,
    sourcePath: null,
    extractedFields: [
      { label: 'Document date', value: '2024-01-05' },
      { label: 'Valant folder', value: 'Family Practice / Progress Notes' },
    ],
    mimeType: 'application/pdf',
    s3RawKey: `${id}.pdf`,
    extractedText: null,
    pageTexts: null,
    pageCount: 1,
    textMethod: null,
    textExtractedAt: null,
    textOcrJobId: null,
    sha256: `sha-${id}`,
    fileSize: 1000,
    filedAt: new Date('2026-10-01T00:00:00Z'),
    createdAt: new Date('2026-10-01T00:00:00Z'),
    ...over,
  };
}

function visit(id: string, over: Partial<VisitRow> = {}): VisitRow {
  return {
    id,
    visitType: 'Follow-up',
    visitDate: new Date('2026-10-20T15:00:00Z'),
    chiefComplaint: 'Diabetes follow-up',
    subjective: 'Patient Pat Lee reports good adherence to metformin 500 mg twice daily.',
    objective: 'BP 138/86.',
    assessment: 'Type 2 diabetes, improving.',
    plan: 'Repeat A1c in three months and refer to ophthalmology for retinal exam.',
    icd10Codes: ['E11.9'],
    signedAt: new Date('2026-10-20T16:00:00Z'),
    updatedAt: new Date('2026-10-20T16:00:00Z'),
    ...over,
  };
}

const LAB_PAGE =
  'Office visit 01/05/2024. Hemoglobin A1c 8.2 % on 2024-01-05. Past medical history: hypertension since 2015. ' +
  'Lisinopril 10 mg was stopped because of a dry cough. Patient has a history of childhood trauma and attends weekly therapy sessions.';

function structured(over: Partial<StructuredSet> = {}): StructuredSet {
  return {
    problems: [
      { id: 'p1', name: 'Type 2 diabetes mellitus', icd10Code: 'E11.9', status: 'Active', isChronic: true, onsetDate: new Date('2020-03-01T00:00:00Z'), resolvedDate: null, createdAt: NOW },
      { id: 'p2', name: 'Alcohol use disorder, moderate', icd10Code: 'F10.20', status: 'Active', isChronic: false, onsetDate: null, resolvedDate: null, createdAt: NOW },
      { id: 'p3', name: 'Old entry', icd10Code: null, status: 'Entered in error', isChronic: false, onsetDate: null, resolvedDate: null, createdAt: NOW },
    ],
    meds: [
      { id: 'm1', medicationName: 'Metformin', drugName: 'metformin', dosage: '500 mg', dosageText: null, frequency: 'twice daily', indication: 'diabetes', startDate: new Date('2021-01-01T00:00:00Z'), endDate: null, stopDate: null, stopReason: null, active: true, status: 'active', isAntipsychotic: false },
      { id: 'm2', medicationName: 'Sertraline', drugName: 'sertraline', dosage: '100 mg', dosageText: null, frequency: 'daily', indication: null, startDate: new Date('2025-01-01T00:00:00Z'), endDate: null, stopDate: null, stopReason: null, active: true, status: 'active', isAntipsychotic: false },
      { id: 'm3', medicationName: 'Atorvastatin', drugName: 'atorvastatin', dosage: '20 mg', dosageText: null, frequency: null, indication: null, startDate: new Date('2022-01-01T00:00:00Z'), endDate: null, stopDate: new Date('2023-01-01T00:00:00Z'), stopReason: 'myalgia', active: false, status: 'stopped', isAntipsychotic: false },
      { id: 'm4', medicationName: 'Buprenorphine-naloxone', drugName: 'buprenorphine', dosage: '8 mg', dosageText: null, frequency: null, indication: null, startDate: new Date('2025-06-01T00:00:00Z'), endDate: null, stopDate: null, stopReason: null, active: true, status: 'active', isAntipsychotic: false },
    ],
    allergies: [{ id: 'a1', allergen: 'Penicillin', reaction: 'hives', severity: 'Moderate', status: 'Active', allergenType: 'drug', createdAt: new Date('2019-05-01T00:00:00Z') }],
    vitals: [{ id: 'v1', systolic: 142, bpSystolic: null, diastolic: 90, bpDiastolic: null, weightLbs: 201.4, bmi: 31.2, recordedAt: new Date('2026-10-20T15:00:00Z') }],
    labs: [
      { id: 'l1', testName: 'Hemoglobin A1c', testKey: 'a1c', panelName: null, value: '7.4', unit: '%', flag: 'H', collectedAt: new Date('2026-09-01T00:00:00Z'), resultedAt: null, createdAt: NOW },
      { id: 'l2', testName: 'WBC', testKey: 'wbc', panelName: 'CBC', value: '6.1', unit: 'K/uL', flag: 'N', collectedAt: new Date('2026-09-01T00:00:00Z'), resultedAt: null, createdAt: NOW },
      { id: 'l3', testName: 'Hemoglobin', testKey: 'hgb', panelName: 'CBC', value: '10.9', unit: 'g/dL', flag: 'L', collectedAt: new Date('2026-09-01T00:00:00Z'), resultedAt: null, createdAt: NOW },
    ],
    referrals: [
      { id: 'r1', kind: 'specialist', target: 'Ophthalmology', facility: null, reason: 'Diabetic retinal exam', status: 'sent', sentAt: new Date('2026-10-20T00:00:00Z'), scheduledFor: null },
      { id: 'r2', kind: 'internal_bh', target: 'BH team', facility: null, reason: 'PHQ-9 of 18 after a recent assault', status: 'scheduled', sentAt: new Date('2026-10-21T00:00:00Z'), scheduledFor: null },
    ],
    bh: { primaryDiagnosis: 'Major depressive disorder, recurrent', primaryDiagnosisCode: 'F33.1', secondaryDiagnoses: null, lastRisk: { id: 'rk1', severity: 'HIGH', createdAt: new Date('2026-09-15T00:00:00Z') } },
    careGaps: [
      { key: 'colorectal', label: 'Colorectal cancer screening', group: 'cancer_screening', basis: '', window: '', status: 'overdue', reason: '', lastDate: null, nextDue: '2026-01-01', patientReported: null },
      { key: 'influenza', label: 'Influenza vaccine', group: 'immunization', basis: '', window: '', status: 'met', reason: '', lastDate: '2026-09-10', nextDue: null, patientReported: null },
      { key: 'breast', label: 'Breast cancer screening (mammogram)', group: 'cancer_screening', basis: '', window: '', status: 'not_applicable', reason: '', lastDate: null, nextDue: null, patientReported: null },
    ] as CareGap[],
    part2Client: true,
    part2ConsentCovers: false,
    ...over,
  };
}

// ─── 1. Medical document classification ──────────────────────────────────────

test('medical doc classification: medical records in, billing / IDs / consents / BH records / psychotherapy notes out', () => {
  const bh = { behavioral: true };
  const pcOnly = { behavioral: false };
  assert.equal(classifyMedicalDocument({ documentType: 'Lab Report' }, bh).include, true);
  assert.equal(classifyMedicalDocument({ documentType: 'Other', fileName: 'Chest X-ray report 2024.pdf' }, bh).include, true);
  assert.equal(classifyMedicalDocument({ documentType: 'Other', title: 'Cardiology consult letter' }, bh).include, true);
  assert.equal(classifyMedicalDocument({ documentType: 'Other', title: 'Hospital discharge summary' }, bh).include, true);
  assert.equal(classifyMedicalDocument({ documentType: 'Other', fileName: 'Immunization record.pdf' }, bh).include, true);
  assert.equal(classifyMedicalDocument({ documentType: 'Other', title: 'History and Physical' }, bh).include, true);
  // Generic progress note: Family Practice marker, or a primary-care-only patient
  assert.equal(classifyMedicalDocument({ documentType: 'Progress Note', folder: 'Family Practice / Notes' }, bh).reason, 'family_practice');
  assert.equal(classifyMedicalDocument({ documentType: 'Progress Note' }, pcOnly).reason, 'primary_care_only');
  assert.equal(classifyMedicalDocument({ documentType: 'Progress Note' }, bh).include, false, 'a BH progress note never feeds the medical digest');
  assert.equal(classifyMedicalDocument({ documentType: 'Discharge Summary' }, bh).include, false);
  // Never
  for (const t of ['Insurance Card', 'Patient ID', 'Payment Receipt', 'Consent / ROI', 'Demographics', 'Billing Archive', 'Measures', 'Intake Form']) {
    assert.equal(classifyMedicalDocument({ documentType: t, folder: 'Family Practice' }, pcOnly).include, false, t);
  }
  assert.equal(classifyMedicalDocument({ documentType: 'Other', title: 'Psychotherapy notes', folder: 'Family Practice' }, pcOnly).reason, 'psychotherapy_note');
  assert.equal(classifyMedicalDocument({ documentType: 'Psychiatric Evaluation', folder: 'Family Practice' }, pcOnly).reason, 'behavioral_health_record');
  assert.equal(classifyMedicalDocument({ documentType: 'Other', title: 'Counseling session summary' }, pcOnly).reason, 'behavioral_health_record');
  assert.equal(isFamilyPracticeDocument({ documentType: 'Other', sourcePath: 'Valant/Family Practice/2024' }), true);
});

// ─── 2. Structured record citations ──────────────────────────────────────────

test('structured records: deterministic facts, each citing its own record (quote = record text)', () => {
  const { sections, sources } = structuredMedicalFacts(structured({ part2Client: false }));
  const dm = sections.problems.find((p) => p.text.includes('E11.9'))!;
  assert.equal(dm.kind, 'chronic');
  assert.deepEqual(dm.cites, [{ source: 'rec:problem:p1', page: null, date: '2020-03-01', quote: 'Type 2 diabetes mellitus (E11.9)' }]);
  assert.equal(sources['rec:problem:p1'].label, 'Problem list');
  assert.ok(!sections.problems.some((p) => p.text.includes('Old entry')), 'entered in error dropped');
  const statin = sections.medicationTrials.find((t) => t.drug === 'atorvastatin')!;
  assert.equal(statin.reasonStopped, 'myalgia');
  assert.equal(statin.end, '2023-01-01');
  assert.equal(sections.medicationTrials.find((t) => t.drug === 'metformin')!.response, 'current');
  assert.match(sections.allergies[0].text, /Penicillin — hives/);
  assert.deepEqual(sections.vitals.map((v) => v.text), ['BP 142/90', 'Weight 201.4 lb, BMI 31.2']);
  assert.ok(sections.labs.some((l) => l.text === 'Hemoglobin A1c 7.4 % (H)' && l.kind === 'a1c'));
  assert.ok(sections.labs.some((l) => l.text.startsWith('Hemoglobin 10.9')), 'flagged CBC kept');
  assert.ok(!sections.labs.some((l) => l.text.startsWith('WBC')), 'normal CBC not trended');
  assert.ok(sections.referrals.some((r) => r.kind === 'referral_open' && r.text.includes('Ophthalmology')));
  for (const s of Object.values(sections).flat()) for (const c of (s as { cites: { source: string }[] }).cites) assert.ok(c.source.startsWith('rec:'));
});

test('preventive care due: computed only from care-gap records (not applicable left out)', () => {
  const due = preventiveDueFrom(structured().careGaps);
  assert.deepEqual(due.map((g) => `${g.key}:${g.status}`), ['colorectal:overdue', 'influenza:met']);
  assert.match(MEDICAL_DIGEST_SYSTEM_PROMPT, /Never say a screening or vaccine is due/);
});

// ─── 3. BH summary: minimum necessary for the medical audience ────────────────

test('BH summary: diagnoses, current psych meds, last risk flag only — never therapy / trauma detail', () => {
  const { sections } = structuredMedicalFacts(structured({ part2Client: false }));
  const texts = sections.bhSummary.map((i) => i.text);
  assert.ok(texts.includes('Diagnosis: Major depressive disorder, recurrent (F33.1)'));
  assert.ok(texts.includes('Current psychiatric medication: sertraline'));
  assert.ok(texts.includes('Last risk flag: high'));
  assert.ok(!texts.some((t) => /metformin|atorvastatin/.test(t)), 'non-psych meds are not BH');
  // BH handoff referral: the reason (assault, PHQ score) is never shown
  const bhRef = sections.referrals.find((r) => r.text.startsWith('Behavioral health referral'))!;
  assert.doesNotMatch(JSON.stringify(bhRef), /assault|PHQ/);
  // Model-extracted items
  assert.equal(isMinimumNecessaryBhItem({ text: 'Generalized anxiety disorder', kind: 'diagnosis' }), true);
  assert.equal(isMinimumNecessaryBhItem({ text: 'History of childhood trauma', kind: 'diagnosis' }), false);
  assert.equal(isMinimumNecessaryBhItem({ text: 'Attends weekly CBT sessions', kind: 'therapy' }), false);
  assert.equal(isMinimumNecessaryBhItem({ text: 'Patient disclosed abuse by partner', kind: 'risk_flag' }), false);
  const d = { ...emptyMedicalSections(), bhSummary: [{ text: 'Weekly therapy sessions for trauma', date: null, kind: 'diagnosis', cites: [] }], socialFunctional: [{ text: 'On probation after arrest', date: null, kind: null, cites: [] }, { text: 'Lives alone; needs transportation', date: null, kind: null, cites: [] }] };
  const safe = applyMedicalMinimumNecessary(d);
  assert.equal(safe.bhSummary.length, 0);
  assert.deepEqual(safe.socialFunctional.map((i) => i.text), ['Lives alone; needs transportation']);
});

// ─── 4. Part 2 ───────────────────────────────────────────────────────────────

test('Part 2: SUD diagnoses / meds and Part 2 documents withheld without a covering consent', () => {
  const noConsent = structuredMedicalFacts(structured());
  assert.ok(!noConsent.sections.problems.some((p) => p.text.includes('F10.20')));
  assert.ok(!noConsent.sections.medicationTrials.some((t) => t.drug === 'buprenorphine'));
  const consent = structuredMedicalFacts(structured({ part2ConsentCovers: true }));
  assert.ok(consent.sections.problems.some((p) => p.text.includes('F10.20')));
  assert.ok(consent.sections.medicationTrials.some((t) => t.drug === 'buprenorphine'));

  const set: MedicalSourceSet = { docs: [doc('a'), doc('b', { documentType: 'Lab Report', fileName: 'labs.pdf', extractedFields: [] })], visits: [visit('v1')], part2Client: true, part2ConsentCovers: false, behavioral: true };
  const r = selectMedicalSources(set);
  assert.deepEqual(r.selected.map((s) => s.key), ['visit:v1'], 'imported documents of a Part 2 client are Part 2');
  assert.equal(r.excluded.part2_no_consent, 2);
  const ok = selectMedicalSources({ ...set, part2ConsentCovers: true });
  assert.equal(ok.selected.filter((s) => s.part2).length, 2);
  // Unsigned visits never feed the digest
  assert.equal(selectMedicalSources({ ...set, visits: [visit('v2', { signedAt: null })] }).excluded.unsigned_visit, 1);
});

// ─── 5. Access rules (pure + browser mirror) ─────────────────────────────────

const ROLES = ['SUPER_ADMIN', 'ADMIN', 'PRACTICE_DIRECTOR', 'DIRECTOR', 'THERAPIST', 'CLINICIAN', 'PSYCHIATRIST', 'NP', 'PHYSICIAN', 'MEDICAL_NP', 'MEDICAL_ASSISTANT', 'PRP_SPECIALIST', 'CASE_MANAGER', 'PEER_SUPPORT', 'OFFICE_MANAGER', 'FRONT_DESK', 'BILLING', 'HR'];

test('access: primary-care roles can now view the medical digest; BH digest rules unchanged', () => {
  for (const r of ['PHYSICIAN', 'MEDICAL_NP', 'MEDICAL_ASSISTANT', 'PSYCHIATRIST', 'NP', 'PRACTICE_DIRECTOR']) assert.equal(canViewChartDigest(r, 'medical'), true, r);
  for (const r of ['THERAPIST', 'PEER_SUPPORT', 'FRONT_DESK', 'BILLING', 'HR', 'OFFICE_MANAGER', 'SUPER_ADMIN', 'CASE_MANAGER']) assert.equal(canViewChartDigest(r, 'medical'), false, r);
  for (const r of ['PHYSICIAN', 'MEDICAL_NP', 'MEDICAL_ASSISTANT']) {
    assert.equal(canViewChartDigest(r), false, `${r}: never the BH digest`);
    assert.equal(canViewAnyChartDigest(r), true);
    assert.equal(defaultDigestKind(r), 'medical');
  }
  assert.equal(defaultDigestKind('THERAPIST'), 'bh');
  assert.equal(canGenerateChartDigest('PHYSICIAN', 'medical'), true);
  assert.equal(canGenerateChartDigest('MEDICAL_NP', 'medical'), true);
  assert.equal(canGenerateChartDigest('MEDICAL_ASSISTANT', 'medical'), false);
  assert.equal(canGenerateChartDigest('PSYCHIATRIST', 'medical'), false);
  assert.equal(canGenerateChartDigest('PHYSICIAN'), false, 'BH regenerate unchanged');
  assert.equal(medicalAudienceFor('MEDICAL_ASSISTANT'), 'ma');
  assert.equal(medicalAudienceFor('PHYSICIAN'), 'provider');
  for (const r of ROLES) {
    assert.equal(canSeeMedicalHistoryTab(r), canViewChartDigest(r, 'medical'), r);
    assert.equal(canSeeChartHistoryTab(r), canViewChartDigest(r, 'bh'), r);
  }
  assert.equal(canSeeMedicalHistoryTab(null), false);
});

test('both tabs by role: integrated patient gets BH + medical for BH prescribers, medical only for primary care', () => {
  const both = { primaryCare: true };
  assert.deepEqual(digestKindsFor('PSYCHIATRIST', both), ['bh', 'medical']);
  assert.deepEqual(digestKindsFor('PRACTICE_DIRECTOR', both), ['bh', 'medical']);
  assert.deepEqual(digestKindsFor('PHYSICIAN', both), ['medical']);
  assert.deepEqual(digestKindsFor('MEDICAL_ASSISTANT', both), ['medical']);
  assert.deepEqual(digestKindsFor('THERAPIST', both), ['bh'], 'therapists: no medical history (minimum necessary)');
  assert.deepEqual(digestKindsFor('PHYSICIAN', { primaryCare: false }), []);
  assert.deepEqual(digestKindsFor('PSYCHIATRIST', { primaryCare: false }), ['bh']);
  assert.deepEqual(chartHistoryTabsFor('NP', both).map((t) => t.label), ['Behavioral health history', 'Medical history']);
  // Audience-first order; the MA panel lists only the minimum-necessary sections
  assert.deepEqual(medicalHistoryPanelSections('PHYSICIAN').slice(0, 4).map((s) => s.key), ['problems', 'medicationTrials', 'allergies', 'labs']);
  assert.deepEqual(MEDICAL_PANEL_ORDER.ma, ['allergies', 'medicationTrials', 'vitals', 'preventiveDue']);
});

// ─── 6. MA restricted sections ───────────────────────────────────────────────

test('medical assistant: allergies, current meds, vitals, preventive due only — not full history', () => {
  const records = structuredMedicalFacts(structured({ part2Client: false }));
  const full = combineMedicalDigest(null, records, preventiveDueFrom(structured().careGaps));
  assert.ok(full.problems.length && full.bhSummary.length && full.labs.length);
  const ma = restrictForMedicalAssistant(full);
  for (const k of ['problems', 'labs', 'hospitalizations', 'referrals', 'socialFunctional', 'openItems', 'bhSummary', 'preventive'] as const) assert.equal(ma[k].length, 0, k);
  assert.equal(ma.allergies.length, 1);
  assert.equal(ma.vitals.length, 2);
  assert.deepEqual(ma.medicationTrials.map((t) => t.drug).sort(), ['buprenorphine', 'metformin', 'sertraline'], 'past trials (stopped statin) not shown');
  assert.equal(ma.preventiveDue!.length, 2);
  assert.ok(Object.keys(ma.sources).every((k) => /^rec:(allergy|vital|med):/.test(k)), 'only cited sources');
});

// ─── 7. Generation, kind-separated staleness, view gates ─────────────────────

function fakeDeps(over: Partial<MedicalDigestDeps> & { set?: MedicalSourceSet; primaryCare?: boolean } = {}) {
  const audits: DigestAudit[] = [];
  const store: StoredDigest[] = [];
  const prompts: string[] = [];
  let set: MedicalSourceSet = over.set ?? { docs: [doc('a', { pageTexts: [LAB_PAGE], textExtractedAt: NOW })], visits: [visit('v1')], part2Client: false, part2ConsentCovers: false, behavioral: true };
  const deps: MedicalDigestDeps = {
    async resolveAccess(viewer) {
      return viewer.userId === 'outsider' ? { ok: false, status: 403, reason: 'not_on_caseload' } : { ok: true, names: ['Pat Lee'] };
    },
    async onCareTeam(viewer) {
      return viewer.userId !== 'not-team';
    },
    async aiConsent() {
      return 'signed';
    },
    async loadMedicalSources() {
      return set;
    },
    async loadStructured() {
      return structured({ part2Client: false });
    },
    async isPrimaryCare() {
      return over.primaryCare ?? true;
    },
    async clientNames() {
      return ['Pat Lee'];
    },
    async extract(d) {
      const pages = Array.isArray(d.pageTexts) ? (d.pageTexts as string[]) : [];
      return { state: 'ready', pages, method: 'pdf_text', pageCount: pages.length, scannedPages: 0 };
    },
    async latestDigest() {
      return store[store.length - 1] ?? null;
    },
    async saveDigest(row) {
      const s: StoredDigest = { ...row, id: `md${store.length + 1}` };
      store.push(s);
      return s;
    },
    bedrockConfigured: () => true,
    async invokeModel({ system, userPrompt }) {
      assert.equal(system, MEDICAL_DIGEST_SYSTEM_PROMPT);
      prompts.push(userPrompt);
      const doc = /SOURCE (S\d+) \| 2024-01-05/.exec(userPrompt)?.[1];
      if (doc) {
        return {
          text: JSON.stringify({
            labs: [{ text: 'A1c 8.2 %', date: '2024-01-05', kind: 'a1c', cites: [{ src: doc, page: null, quote: 'Hemoglobin A1c 8.2 % on 2024-01-05' }] }],
            problems: [
              { text: 'Hypertension since 2015', kind: 'chronic', cites: [{ src: doc, page: null, quote: 'Past medical history: hypertension since 2015' }] },
              { text: 'Invented asthma', kind: 'active', cites: [{ src: doc, page: null, quote: 'patient has severe persistent asthma' }] },
            ],
            medicationTrials: [{ drug: 'lisinopril', doses: ['10 mg', '40 mg'], reasonStopped: 'dry cough', cites: [{ src: doc, page: null, quote: 'Lisinopril 10 mg was stopped because of a dry cough' }] }],
            bhSummary: [{ text: 'History of childhood trauma, in weekly therapy', kind: 'diagnosis', cites: [{ src: doc, page: null, quote: 'Patient has a history of childhood trauma' }] }],
          }),
          tokensIn: 1000,
          tokensOut: 200,
        };
      }
      const v = /SOURCE (S\d+)/.exec(userPrompt)![1];
      return { text: JSON.stringify({ openItems: [{ text: 'Repeat A1c in three months', kind: null, cites: [{ src: v, page: null, quote: 'Repeat A1c in three months' }] }] }), tokensIn: 500, tokensOut: 100 };
    },
    modelId: 'haiku-test',
    async audit(e) {
      audits.push(e);
    },
    now: () => NOW,
    ...over,
  };
  return { deps, audits, store, prompts, setSources: (s: MedicalSourceSet) => (set = s) };
}

const PCP = { organizationId: 'org1', userId: 'u1', role: 'PHYSICIAN' };

test('generation: cited facts only, invented dose / fact / trauma dropped, names redacted, audit counts only', async () => {
  const f = fakeDeps();
  const r = await generateMedicalForViewer(f.deps, PCP, 'c1');
  assert.equal(r.ok, true);
  assert.equal(r.digest!.promptVersion, 'medical-digest-v1');
  const d = (r.digest!.digestJson as { digest: MedicalDigest }).digest;
  assert.equal(d.kind, 'medical');
  assert.deepEqual(d.problems.map((p) => p.text), ['Hypertension since 2015']);
  assert.equal(d.labs[0].date, '2024-01-05');
  assert.deepEqual(d.medicationTrials[0].doses, ['10 mg'], '40 mg is not in the source');
  assert.equal(d.bhSummary.length, 0, 'trauma / therapy never reaches the medical digest');
  assert.equal(d.openItems.length, 1);
  assert.ok(f.prompts.every((p) => !/Pat Lee/.test(p)));
  const ai = f.audits.find((a) => a.action === 'AI_ACCESS')!;
  assert.doesNotMatch(JSON.stringify(ai.metadata), /lisinopril|trauma|Pat Lee|hypertension/i);
  assert.equal(ai.metadata.kind, 'medical');
});

test('kind-separated staleness: own hash / prompt version; a new visit re-maps only its month', async () => {
  const f = fakeDeps();
  const sel = selectMedicalSources(await f.deps.loadMedicalSources('org1', 'c1')).selected;
  assert.notEqual(computeMedicalSourceHash(sel), computeSourceHash(sel), 'BH and medical hashes never collide');
  await buildMedicalDigest(f.deps, { organizationId: 'org1', clientId: 'c1', actorId: 'u1', allowOcr: true });
  assert.equal(f.prompts.length, 2);
  const again = await buildMedicalDigest(f.deps, { organizationId: 'org1', clientId: 'c1', actorId: 'u1', allowOcr: true });
  assert.equal(again.skipped, true);
  f.setSources({ docs: [doc('a', { pageTexts: [LAB_PAGE], textExtractedAt: NOW })], visits: [visit('v1'), visit('v2', { visitDate: new Date('2026-11-03T15:00:00Z') })], part2Client: false, part2ConsentCovers: false, behavioral: true });
  const after = computeMedicalSourceHash(selectMedicalSources(await f.deps.loadMedicalSources('org1', 'c1')).selected);
  assert.equal(digestStaleness(f.store[0], after).reason, 'sources_changed');
  const r = await buildMedicalDigest(f.deps, { organizationId: 'org1', clientId: 'c1', actorId: 'u1', allowOcr: true });
  assert.equal(r.summary!.chunksReused, 2);
  assert.equal(r.summary!.modelCalls, 1);
  assert.equal(r.digest!.version, 2);
});

test('view: record facts + AI facts for the provider, MA subset, not-primary-care and role denials audited', async () => {
  const f = fakeDeps();
  await buildMedicalDigest(f.deps, { organizationId: 'org1', clientId: 'c1', actorId: 'u1', allowOcr: true });
  const v = await viewMedicalDigest(f.deps, PCP, 'c1');
  assert.equal(v.ok, true);
  assert.equal(v.view!.aiGenerated, true);
  assert.equal(v.view!.canRegenerate, true);
  assert.ok(v.view!.digest.problems.some((p) => p.cites[0].source === 'rec:problem:p1'));
  assert.ok(v.view!.digest.problems.some((p) => p.cites[0].source === 'doc:a'));
  assert.equal(v.view!.digest.preventiveDue!.length, 2);

  const ma = await viewMedicalDigest(f.deps, { ...PCP, role: 'MEDICAL_ASSISTANT' }, 'c1');
  assert.equal(ma.view!.audience, 'ma');
  assert.equal(ma.view!.canRegenerate, false);
  assert.equal(ma.view!.digest.problems.length + ma.view!.digest.bhSummary.length + ma.view!.digest.labs.length, 0);
  assert.equal((await generateMedicalForViewer(f.deps, { ...PCP, role: 'MEDICAL_ASSISTANT' }, 'c1')).reason, 'not_on_care_team');

  assert.equal((await viewMedicalDigest(f.deps, { ...PCP, role: 'THERAPIST' }, 'c1')).status, 403);
  assert.equal((await viewMedicalDigest(f.deps, { ...PCP, userId: 'outsider' }, 'c1')).reason, 'not_on_caseload');
  const notPc = fakeDeps({ primaryCare: false });
  assert.equal((await viewMedicalDigest(notPc.deps, PCP, 'c1')).reason, 'not_primary_care');
  assert.ok(f.audits.filter((a) => a.outcome === 'DENIED').length >= 3);
});

// ─── 8. Wiring (source assertions) ───────────────────────────────────────────

test('route, store, UI and schema wiring', () => {
  const route = read('src/app/api/clients/[id]/chart-digest/route.ts');
  assert.match(route, /canViewChartDigest\(viewer\.role, kind\)/);
  assert.match(route, /viewMedicalDigest/);
  assert.match(route, /generateMedicalForViewer/);
  assert.match(route, /digestKindsFor/);
  assert.match(route, /chartDigestCitationLinks/);
  assert.match(read('src/lib/ai/chartDigest/citationLinks.ts'), /chartDocumentFilter/);
  const service = read('src/lib/ai/chartDigest/service.ts');
  assert.match(service, /from '@\/lib\/ai\/chartDigest\/access'/);
  const store = read('src/lib/ai/chartDigest/store.ts');
  assert.match(store, /where: \{ organizationId, clientId, kind \}/);
  const mstore = read('src/lib/ai/chartDigest/medical/store.ts');
  assert.match(mstore, /signedAt: \{ not: null \}/);
  assert.match(mstore, /kind: 'medical'/);
  assert.doesNotMatch(mstore, /psychotherapyNote/);
  assert.doesNotMatch(mstore, /description: true/, 'risk alert description never read');
  const visits = read('src/app/dashboard/medical/visits/page.tsx');
  assert.match(visits, /SessionSideTabs/);
  assert.match(visits, /kind="medical"/);
  assert.match(visits, /canSeeMedicalHistoryTab\(role\)/);
  assert.match(read('src/features/medical/components/RoomingPanel.tsx'), /<ChartHistoryCard kind="medical"/);
  const card = read('src/components/ai/ChartHistoryCard.tsx');
  assert.match(card, /chart-digest\?kind=\$\{kind\}/);
  assert.match(card, /target="_blank"/);
  assert.match(card, /Computed from preventive-care records/);
  const schema = read('prisma/schema.prisma');
  assert.match(schema, /@@unique\(\[organizationId, clientId, kind, version\]\)/);
  const sql = read('prisma/migrations/20261026_primary_care_digest.sql');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'bh'/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS/);
});

// ─── 9. Script --kind ────────────────────────────────────────────────────────

test('script: --kind=medical|bh|auto, estimator counts medical sources, pilot cap kept, no names printed', () => {
  assert.equal(parseScriptKind(undefined), 'bh');
  assert.equal(parseScriptKind('AUTO'), 'auto');
  assert.equal(parseScriptKind('dental'), null);
  assert.deepEqual(kindsForScript('auto', { primaryCare: true, behavioral: false }), ['medical']);
  assert.deepEqual(kindsForScript('auto', { primaryCare: true, behavioral: true }), ['bh', 'medical']);
  assert.deepEqual(kindsForScript('auto', { primaryCare: false, behavioral: true }), ['bh']);
  assert.deepEqual(kindsForScript('medical', { primaryCare: false, behavioral: true }), []);
  assert.deepEqual(kindsForScript('bh', { primaryCare: true, behavioral: false }), ['bh']);
  const script = read('scripts/chart-digest.ts');
  assert.match(script, /--kind=bh\|medical\|auto/);
  assert.match(script, /selectMedicalSources\(await loadMedicalDigestSources/);
  assert.match(script, /buildMedicalDigest\(medicalDeps/);
  assert.match(script, /APPLY_MAX = 25/);
  assert.doesNotMatch(script, /name: true|legalFirstName|legalLastName|client\.name/, 'never selects or prints names');
});
