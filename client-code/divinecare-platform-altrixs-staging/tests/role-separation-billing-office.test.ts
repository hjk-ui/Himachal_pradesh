import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ROLE_PERSONAS, normalizeStaffRole } from '../src/lib/auth/rolePersonas';
import { canAccessPath, shouldBlockDashboardPath } from '../src/lib/auth/roleAccess';
import { roleLabel } from '../src/lib/auth/userRoles';

test('Role Personas configuration matches exact specifications', () => {
  const billing = ROLE_PERSONAS.BILLING;
  assert.equal(billing.name, 'Sandra Lee, CPC');
  assert.equal(billing.title, 'Certified Professional Coder');
  assert.equal(billing.email, 's.lee@organization.com');
  assert.equal(billing.color, '#F57F17');
  assert.equal(billing.background, '#FFFDE7');
  assert.equal(billing.iconName, 'CreditCard');
  assert.equal(billing.group, 'administrative');
  assert.ok(billing.hipaaGuardrail.includes('CANNOT view clinical psychotherapy notes'));

  const office = ROLE_PERSONAS.OFFICE_MANAGER;
  assert.equal(office.name, 'Kevin Davis');
  assert.equal(office.title, 'Office Manager');
  assert.equal(office.email, 'k.davis@organization.com');
  assert.equal(office.color, '#37474F');
  assert.equal(office.background, '#ECEFF1');
  assert.equal(office.iconName, 'ClipboardCheck');
  assert.equal(office.group, 'administrative');
  assert.ok(office.hipaaGuardrail.includes('CANNOT write clinical notes or submit electronic insurance claims'));
});

test('Role alias normalization handles snake_case and enum names', () => {
  assert.equal(normalizeStaffRole('billing_specialist'), 'BILLING');
  assert.equal(normalizeStaffRole('BILLING'), 'BILLING');
  assert.equal(normalizeStaffRole('billing'), 'BILLING');
  assert.equal(normalizeStaffRole('office_manager'), 'OFFICE_MANAGER');
  assert.equal(normalizeStaffRole('OFFICE_MANAGER'), 'OFFICE_MANAGER');

  assert.equal(roleLabel('BILLING'), 'Billing Specialist');
  assert.equal(roleLabel('billing_specialist'), 'Billing Specialist');
  assert.equal(roleLabel('OFFICE_MANAGER'), 'Office Manager');
  assert.equal(roleLabel('office_manager'), 'Office Manager');
});

test('Billing Specialist path access enforces HIPAA guardrails and billing suite access', () => {
  for (const role of ['BILLING', 'billing_specialist'] as const) {
    // Top-level & demographic client roster
    assert.equal(canAccessPath(role, '/dashboard'), true, `${role} must access /dashboard`);
    assert.equal(canAccessPath(role, '/dashboard/clients'), true, `${role} must access /dashboard/clients`);

    // EHR administrative & clearinghouse tools
    assert.equal(canAccessPath(role, '/dashboard/ehr/eligibility'), true);
    assert.equal(canAccessPath(role, '/dashboard/ehr/prior-auths'), true);
    assert.equal(canAccessPath(role, '/dashboard/ehr/part2'), true);

    // AI & Analytics: AI coding allowed
    assert.equal(canAccessPath(role, '/dashboard/coding'), true);

    // Business & billing suite
    assert.equal(canAccessPath(role, '/dashboard/billing'), true);
    assert.equal(canAccessPath(role, '/dashboard/billing/denials'), true);
    assert.equal(canAccessPath(role, '/dashboard/billing/autopay'), true);
    assert.equal(canAccessPath(role, '/dashboard/billing/superbills'), true);
    assert.equal(canAccessPath(role, '/dashboard/billing/payments'), true);
    assert.equal(canAccessPath(role, '/dashboard/billing/panels'), true);

    // HIPAA Guardrail: CANNOT view clinical psychotherapy notes or evaluations
    assert.equal(canAccessPath(role, '/dashboard/ehr/notes'), false, `${role} must NOT access EHR notes`);
    assert.equal(shouldBlockDashboardPath(role, '/dashboard/ehr/notes'), true);
    assert.equal(canAccessPath(role, '/dashboard/ehr/treatment-plans'), false);
    assert.equal(canAccessPath(role, '/dashboard/ehr/evaluations'), false);
    assert.equal(canAccessPath(role, '/dashboard/ehr/prescriptions'), false);
    assert.equal(canAccessPath(role, '/dashboard/scribe'), false);
  }
});

test('Office Manager path access enforces front-office ops and blocks electronic claims', () => {
  for (const role of ['OFFICE_MANAGER', 'office_manager'] as const) {
    // Clinical & operations
    assert.equal(canAccessPath(role, '/dashboard'), true);
    assert.equal(canAccessPath(role, '/dashboard/clients'), true);
    assert.equal(canAccessPath(role, '/dashboard/clients/waitlist'), true);
    assert.equal(canAccessPath(role, '/dashboard/clients/intake'), true);
    assert.equal(canAccessPath(role, '/dashboard/appointments'), true);
    assert.equal(canAccessPath(role, '/dashboard/messages'), true);

    // EHR administrative documents
    assert.equal(canAccessPath(role, '/dashboard/ehr/consents'), true);
    assert.equal(canAccessPath(role, '/dashboard/ehr/eligibility'), true);
    assert.equal(canAccessPath(role, '/dashboard/ehr/prior-auths'), true);
    assert.equal(canAccessPath(role, '/dashboard/ehr/part2'), true);

    // AI & Analytics
    assert.equal(canAccessPath(role, '/dashboard/analytics/schedule'), true);
    assert.equal(canAccessPath(role, '/dashboard/analytics/productivity'), true);
    assert.equal(canAccessPath(role, '/dashboard/analytics/surveys'), true);
    assert.equal(canAccessPath(role, '/dashboard/reports'), true);
    assert.equal(canAccessPath(role, '/dashboard/resources'), true);

    // Quality & Compliance
    assert.equal(canAccessPath(role, '/dashboard/qi'), true);
    assert.equal(canAccessPath(role, '/dashboard/incidents'), true);
    assert.equal(canAccessPath(role, '/dashboard/grievances'), true);
    assert.equal(canAccessPath(role, '/dashboard/compliance'), true);

    // Programs & Community
    assert.equal(canAccessPath(role, '/dashboard/prp'), true);
    assert.equal(canAccessPath(role, '/dashboard/community'), true);
    assert.equal(canAccessPath(role, '/dashboard/community/referrals'), true);
    assert.equal(canAccessPath(role, '/dashboard/pr'), true);

    // HIPAA / Scope Guardrails: CANNOT submit electronic insurance claims or write clinical notes
    assert.equal(canAccessPath(role, '/dashboard/billing/claims'), false, `${role} must NOT access billing claims`);
    assert.equal(shouldBlockDashboardPath(role, '/dashboard/billing/claims'), true);
    assert.equal(canAccessPath(role, '/dashboard/ehr/notes'), false, `${role} must NOT access clinical notes`);
    assert.equal(canAccessPath(role, '/dashboard/ehr/treatment-plans'), false);
    assert.equal(canAccessPath(role, '/dashboard/ehr/evaluations'), false);
  }
});
