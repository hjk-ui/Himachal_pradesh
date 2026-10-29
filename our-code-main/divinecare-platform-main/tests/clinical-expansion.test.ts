import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  NOTE_TYPES,
  encodeNoteBody,
  parseNoteMeta,
  normalizeNoteType,
  structuredNoteSections,
  hasNoteContent,
  noteTemplate,
  isSudNote,
} from '../src/lib/ehr/noteTemplates';
import {
  DIAGNOSIS_OPTIONS,
  DIAGNOSIS_GROUPS,
  PLAN_TYPES,
  PRACTICE_TEMPLATES,
  EMPTY_PLAN_CARE,
} from '../src/lib/ehr/planLibrary';
import { planCareSchema } from '../src/lib/ehr/planCareSchema';
import { CPT_CATALOG } from '../src/features/billing/billingHubData';
import { BILLING_MODIFIERS, PLACE_OF_SERVICE } from '../src/features/billing/codeLibrary';
import { SCANNER_PATIENTS, SERVICES, filterScannerPatients } from '../src/features/ehr/scannerData';
import {
  canAccessPath,
  filterNavForRole,
  shouldBlockDashboardPath,
} from '../src/lib/auth/roleAccess';
import { CLINIC_ROLES } from '../src/types/roles';
import { extractNoteCpt } from '../src/lib/billing/noteCoding';

test('clinical catalogs include all requested unique selections and usable templates', () => {
  assert.equal(NOTE_TYPES.length, 15);
  assert.equal(PLAN_TYPES.length, 9);
  assert.equal(DIAGNOSIS_OPTIONS.length, 43);
  assert.equal(DIAGNOSIS_GROUPS.length, 10);
  assert.equal(new Set(DIAGNOSIS_OPTIONS.map((dx) => dx.icd)).size, 43);
  assert.equal(Object.keys(CPT_CATALOG).length, 34);
  assert.equal(BILLING_MODIFIERS.length, 15);
  assert.equal(PLACE_OF_SERVICE.length, 13);
  assert.equal(PRACTICE_TEMPLATES.length, 6);
  for (const template of PRACTICE_TEMPLATES) {
    assert.ok(DIAGNOSIS_OPTIONS.some((dx) => dx.icd === template.icd));
    assert.ok(
      template.goals.every(
        (goal) => goal.text && goal.objectives.length && goal.interventions.length,
      ),
    );
  }
});

test('note metadata supports legacy notes and preserves new billing, telehealth and Part 2 fields', () => {
  const legacy = parseNoteMeta(
    '<!--ehr type="SOAP" duration="45"-->\nS - Subjective\nOriginal narrative',
  );
  assert.equal(legacy.noteType, 'SOAP');
  assert.equal(legacy.durationMinutes, 45);
  assert.equal(legacy.displayBody, 'S - Subjective\nOriginal narrative');
  assert.equal(parseNoteMeta('Unstructured old note').displayBody, 'Unstructured old note');
  const body =
    'Behavior\nClient report\n\nIntervention\nSupport\n\nResponse\nEngaged\n\nPlan\nReview';
  for (const pos of ['02', '10']) {
    const saved = parseNoteMeta(
      encodeNoteBody(body, {
        noteType: 'BIRP',
        durationMinutes: 45,
        billingCode: '90834',
        telehealth: true,
        placeOfService: pos,
        sudConfidential: true,
      }),
    );
    assert.equal(saved.displayBody, body);
    assert.equal(saved.billingCode, '90834');
    assert.equal(saved.telehealth, true);
    assert.equal(saved.placeOfService, pos);
    assert.equal(saved.sudConfidential, true);
    assert.deepEqual(
      structuredNoteSections('BIRP', saved.displayBody).map((item) => item.title),
      ['Behavior', 'Intervention', 'Response', 'Plan'],
    );
  }
  assert.equal(normalizeNoteType('Group Note'), 'Group');
  assert.equal(isSudNote('Chemical Dependency'), true);
  assert.equal(isSudNote('SOAP', true), true);
  assert.equal(isSudNote('SOAP'), false);
  assert.equal(hasNoteContent('SOAP', noteTemplate('SOAP')), false);
  assert.equal(hasNoteContent('SOAP', 'Subjective\nPatient narrative'), true);
  assert.deepEqual(
    structuredNoteSections(
      'SOAP',
      'S - Subjective\r\nClient narrative\r\n\r\nO - Objective\r\nObserved',
    ),
    [
      { title: 'Subjective', text: 'Client narrative' },
      { title: 'Objective', text: 'Observed' },
    ],
  );
});

test('scanner searches diagnosis and combines selected service/status without cross-service leakage', () => {
  assert.equal(SCANNER_PATIENTS.length, 8);
  assert.equal(
    filterScannerPatients(SCANNER_PATIENTS, '  MARCUS  ', null, 'All')[0].name,
    'Marcus Thompson',
  );
  assert.ok(filterScannerPatients(SCANNER_PATIENTS, 'PTSD', null, 'All').length > 0);
  assert.equal(filterScannerPatients(SCANNER_PATIENTS, 'unmatched', null, 'All').length, 0);
  for (const service of SERVICES) {
    const found = filterScannerPatients(SCANNER_PATIENTS, '', service, 'Eligible');
    assert.ok(found.every((patient) => patient.services[service].status === 'Eligible'));
  }
  assert.equal(filterScannerPatients(SCANNER_PATIENTS, 'Marcus', 'Spravato', 'Eligible').length, 0);
  assert.equal(filterScannerPatients(SCANNER_PATIENTS, 'Marcus', null, 'Eligible').length, 1);
});

test('scanner menu and direct routes enforce exactly the clinical and leadership roles', () => {
  const allowed = new Set(['THERAPIST', 'PSYCHIATRIST', 'NP', 'CASE_MANAGER', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'OFFICE_MANAGER']);
  const href = '/dashboard/ehr/scanner';
  for (const role of CLINIC_ROLES) {
    assert.equal(canAccessPath(role, href), allowed.has(role), role);
    assert.equal(shouldBlockDashboardPath(role, `${href}?service=AOT`), !allowed.has(role), role);
    assert.equal(
      filterNavForRole([{ label: 'EHR', items: [{ href }] }], role).length,
      allowed.has(role) ? 1 : 0,
      role,
    );
  }
});

test('care metadata validates enum selections and field lengths', () => {
  assert.equal(planCareSchema.safeParse(EMPTY_PLAN_CARE).success, true);
  assert.equal(
    planCareSchema.safeParse({ ...EMPTY_PLAN_CARE, planType: 'unknown' }).success,
    false,
  );
  assert.equal(
    planCareSchema.safeParse({ ...EMPTY_PLAN_CARE, coordinationOfCare: 'x'.repeat(4001) }).success,
    false,
  );
});

test('claim drafts honor explicit note billing metadata including new HCPCS and assessment codes', () => {
  for (const code of ['T1017', '96127', '99494', '90840']) {
    assert.equal(
      extractNoteCpt(
        encodeNoteBody('Prior visit used 90837', {
          noteType: 'SOAP',
          durationMinutes: 45,
          billingCode: code,
        }),
      ),
      code,
    );
  }
  assert.equal(extractNoteCpt('Existing note without metadata', 'Intake'), '90791');
  assert.equal(extractNoteCpt('Prior service T1016'), 'T1016');
});
