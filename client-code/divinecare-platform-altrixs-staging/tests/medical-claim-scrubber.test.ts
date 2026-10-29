import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scrubMedicalClaim,
  type BillingRuleScrubberItem,
  type PayerScrubberItem,
  type MedicalClaimInput,
} from '../src/lib/medical/claimScrubber';

const SAMPLE_PAYERS: PayerScrubberItem[] = [
  {
    payerId: '87726',
    name: 'UnitedHealthcare / Optum',
    shortName: 'UHC',
    payerType: 'Commercial',
    timely: 90,
    electronicSubmission: true,
  },
  {
    payerId: '77013',
    name: 'Maryland Medicaid (HealthChoice)',
    shortName: 'MDMCD',
    payerType: 'Medicaid',
    timely: 360,
    electronicSubmission: true,
  },
  {
    payerId: '00840',
    name: 'Medicare Part B — Novitas Solutions',
    shortName: 'MCR',
    payerType: 'Medicare',
    timely: 365,
    electronicSubmission: true,
  },
];

const SAMPLE_RULES: BillingRuleScrubberItem[] = [
  {
    id: 'r-1',
    priority: 1,
    name: 'Supervisor NPI — Box 24J',
    ruleType: 'supervisor_npi',
    trigger: 'Rendering provider role = Intern / Resident',
    action: 'Populate Box 24J with supervising physician NPI from provider record',
    payers: ['All'],
    active: true,
  },
  {
    id: 'r-2',
    priority: 2,
    name: 'Telehealth Modifier — Medicaid (GT)',
    ruleType: 'telehealth_modifier',
    trigger: 'Visit location = Telehealth AND payer type = Medicaid',
    action: 'Append modifier GT to all procedure codes on claim',
    payers: ['77013'],
    active: true,
  },
  {
    id: 'r-3',
    priority: 3,
    name: 'Telehealth Modifier — Commercial/Medicare (95)',
    ruleType: 'telehealth_modifier',
    trigger: 'Visit location = Telehealth AND payer type ≠ Medicaid',
    action: 'Append modifier 95 to all procedure codes on claim',
    payers: ['All except Medicaid'],
    active: true,
  },
  {
    id: 'r-4',
    priority: 4,
    name: 'Preventive + Office Visit Modifier (25)',
    ruleType: 'modifier_auto',
    trigger: 'Same-day CPT: 99381-99397 AND 99202-99215',
    action: 'Append modifier 25 to E&M code (99202-99215)',
    payers: ['All'],
    active: true,
  },
  {
    id: 'r-5',
    priority: 5,
    name: 'Medicare Secondary Payer Check',
    ruleType: 'payer_specific',
    trigger: 'Primary payer = Medicare AND secondary insurance on file',
    action: 'Flag claim as MSP review required before submission',
    payers: ['00840'],
    active: true,
  },
  {
    id: 'r-6',
    priority: 6,
    name: 'Timely Filing Warning',
    ruleType: 'custom',
    trigger: 'Date of service + timely filing limit ≤ 30 days from today',
    action: 'Show amber warning banner on charge and flag in worklist',
    payers: ['All'],
    active: true,
  },
];

test('Scrubber Rule P1: Intern rendering provider auto-populates Box 24J supervisor NPI', () => {
  const claim: MedicalClaimInput = {
    id: 'CLM-001',
    patientId: 'PT-1',
    patientName: 'Test Patient',
    payerId: '87726',
    dos: '2026-10-01',
    location: 'Office',
    renderingProviderRole: 'Intern',
    renderingProviderNpi: '1982736451',
    supervisingPhysicianNpi: '1234567890',
    lines: [{ id: 'l1', cptCode: '99213', modifiers: [], description: 'E&M Level 3', fee: 100 }],
  };

  const res = scrubMedicalClaim(claim, SAMPLE_RULES, SAMPLE_PAYERS);
  assert.equal(res.clean, true);
  assert.equal(res.modifiedClaim.box24JNpi, '1234567890');
  assert.ok(res.appliedRules.some((r) => r.ruleName === 'Supervisor NPI — Box 24J'));
});

test('Scrubber Rule P2 & P3: Telehealth modifiers GT (Medicaid) vs 95 (Commercial)', () => {
  // Test Medicaid (GT)
  const medicaidClaim: MedicalClaimInput = {
    id: 'CLM-002',
    patientId: 'PT-2',
    patientName: 'Medicaid Patient',
    payerId: '77013',
    dos: '2026-10-01',
    location: 'Telehealth',
    renderingProviderRole: 'Physician',
    renderingProviderNpi: '1982736451',
    lines: [{ id: 'l1', cptCode: '90834', modifiers: [], description: 'Psychotherapy 45m', fee: 120 }],
  };

  const medRes = scrubMedicalClaim(medicaidClaim, SAMPLE_RULES, SAMPLE_PAYERS);
  assert.deepEqual(medRes.modifiedClaim.lines[0].modifiers, ['GT']);

  // Test Commercial (95)
  const commercialClaim: MedicalClaimInput = {
    ...medicaidClaim,
    id: 'CLM-003',
    payerId: '87726',
  };

  const commRes = scrubMedicalClaim(commercialClaim, SAMPLE_RULES, SAMPLE_PAYERS);
  assert.deepEqual(commRes.modifiedClaim.lines[0].modifiers, ['95']);
});

test('Scrubber Rule P4: Same-day Preventive (99395) + E&M (99214) auto-attaches Modifier 25', () => {
  const comboClaim: MedicalClaimInput = {
    id: 'CLM-004',
    patientId: 'PT-3',
    patientName: 'Wellness Patient',
    payerId: '87726',
    dos: '2026-10-01',
    location: 'Office',
    renderingProviderRole: 'Physician',
    renderingProviderNpi: '1982736451',
    lines: [
      { id: 'l1', cptCode: '99395', modifiers: [], description: 'Preventive Exam', fee: 180 },
      { id: 'l2', cptCode: '99214', modifiers: [], description: 'E&M Level 4', fee: 145 },
    ],
  };

  const res = scrubMedicalClaim(comboClaim, SAMPLE_RULES, SAMPLE_PAYERS);
  assert.equal(res.clean, true);
  const emLine = res.modifiedClaim.lines.find((l) => l.cptCode === '99214');
  assert.ok(emLine?.modifiers.includes('25'));
});

test('Scrubber Rule P5: Medicare with secondary insurance triggers MSP review', () => {
  const mcrClaim: MedicalClaimInput = {
    id: 'CLM-005',
    patientId: 'PT-4',
    patientName: 'Senior Patient',
    payerId: '00840',
    secondaryPayerId: '87726',
    dos: '2026-10-01',
    location: 'Office',
    renderingProviderRole: 'Physician',
    renderingProviderNpi: '1982736451',
    lines: [{ id: 'l1', cptCode: '99213', modifiers: [], description: 'E&M', fee: 100 }],
  };

  const res = scrubMedicalClaim(mcrClaim, SAMPLE_RULES, SAMPLE_PAYERS);
  assert.equal(res.modifiedClaim.mspReviewRequired, true);
  assert.ok(res.warnings.some((w) => w.includes('MSP Review Required')));
});
