import Module from 'node:module';
import { createRequire } from 'node:module';

const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load;
loader._load = function (id: string, ...args: unknown[]) {
  if (id === 'server-only') return {};
  return originalLoad.call(this, id, ...args);
};

const req = createRequire(import.meta.url);
const { canAccessEligibility } = req('../src/lib/eligibility/manage') as typeof import('../src/lib/eligibility/manage');

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canAccessPath,
  shouldBlockDashboardPath,
  homePathForRole,
} from '../src/lib/auth/roleAccess';
import {
  canAccessClientAppointments,
  canAccessClientChartNotes,
  canAccessClientMessages,
  canAccessClientRoster,
  canAssignPatientToClinician,
  canCreateClient,
} from '../src/lib/clients/orgScope';
import { canUseClinicModule } from '../src/lib/modules/access';
import { canReadLedger, canMutateLedger, canAccessDenials } from '../src/lib/billing/ledger';
import { canAccessConsents } from '../src/lib/consents/manage';
import { PRIOR_AUTH_READ_ROLES, PRIOR_AUTH_WRITE_ROLES } from '../src/lib/ehr/priorAuths';
import { roleLabel, pickPrimaryRole } from '../src/lib/auth/userRoles';
import { isClinicalStaff, isCaseloadRole, CLINIC_ADMIN_ROLES } from '../src/types/roles';

test('OFFICE_MANAGER has full access to operations, billing, appointments, and HR suites', () => {
  // Patient-side billing only. Payer pages stay with Billing and leadership.
  assert.equal(canAccessPath('OFFICE_MANAGER', '/dashboard/billing'), false);
  assert.equal(canAccessPath('OFFICE_MANAGER', '/dashboard/billing/payments'), true);
  assert.equal(canAccessPath('OFFICE_MANAGER', '/dashboard/billing/statements'), true);
  assert.equal(canAccessPath('OFFICE_MANAGER', '/dashboard/billing/autopay'), true);
  assert.equal(canAccessPath('OFFICE_MANAGER', '/dashboard/billing/prior-auth'), true);
  assert.equal(canAccessPath('OFFICE_MANAGER', '/dashboard/ehr/eligibility'), true);
  assert.equal(canAccessPath('OFFICE_MANAGER', '/dashboard/billing/claims'), false);
  assert.equal(canAccessPath('OFFICE_MANAGER', '/dashboard/billing/denials'), false);
  assert.equal(canAccessPath('OFFICE_MANAGER', '/dashboard/billing/superbills'), false);
  assert.equal(canAccessPath('OFFICE_MANAGER', '/dashboard/billing/panels'), false);
  assert.equal(canAccessPath('OFFICE_MANAGER', '/dashboard/billing/ar-control'), false);
  assert.equal(canAccessPath('OFFICE_MANAGER', '/dashboard/billing/fee-schedule'), false);
  assert.equal(canAccessPath('OFFICE_MANAGER', '/dashboard/billing/provider-collections'), false);
  assert.equal(canAccessPath('OFFICE_MANAGER', '/dashboard/billing/insurance-companies'), false);
  assert.equal(canAccessPath('OFFICE_MANAGER', '/dashboard/billing/valant-balances'), false);
  assert.equal(canAccessPath('OFFICE_MANAGER', '/dashboard/programs/intensive/billing'), false);
  assert.equal(canAccessPath('BILLING', '/dashboard/billing/provider-collections'), true);
  assert.equal(canAccessPath('BILLING', '/dashboard/billing/insurance-companies'), true);
  assert.equal(canAccessPath('OFFICE_MANAGER', '/dashboard/medical/billing'), false);
  assert.equal(canAccessPath('OFFICE_MANAGER', '/dashboard/medical/payer-settings'), false);
  assert.equal(canAccessPath('OFFICE_MANAGER', '/dashboard/reports/outcomes'), false);
  assert.equal(canAccessPath('BILLING', '/dashboard/billing'), true);
  assert.equal(canAccessPath('BILLING', '/dashboard/billing/claims'), true);
  assert.equal(canAccessPath('BILLING', '/dashboard/billing/ar-control'), true);
  assert.equal(canAccessPath('BILLING', '/dashboard/billing/fee-schedule'), true);
  assert.equal(canAccessPath('PRACTICE_DIRECTOR', '/dashboard/billing/denials'), true);
  assert.equal(canAccessPath('FRONT_DESK', '/dashboard/billing/payments'), true);
  assert.equal(canAccessPath('FRONT_DESK', '/dashboard/billing/autopay'), true);
  assert.equal(canAccessPath('FRONT_DESK', '/dashboard/billing/statements'), false);

  // Appointments & Operations
  assert.equal(canAccessPath('OFFICE_MANAGER', '/dashboard/appointments'), true);
  assert.equal(canAccessPath('OFFICE_MANAGER', '/dashboard/tasks'), true);
  assert.equal(canAccessPath('OFFICE_MANAGER', '/dashboard/messages'), true);
  assert.equal(canAccessPath('OFFICE_MANAGER', '/dashboard/settings'), true);
  assert.equal(canAccessPath('OFFICE_MANAGER', '/dashboard/telehealth'), true);

  // Clients, Intake, Waitlist
  assert.equal(canAccessPath('OFFICE_MANAGER', '/dashboard/clients'), true);
  assert.equal(canAccessPath('OFFICE_MANAGER', '/dashboard/clients/intake'), true);
  assert.equal(canAccessPath('OFFICE_MANAGER', '/dashboard/clients/waitlist'), true);

  // HR Suite
  assert.equal(canAccessPath('OFFICE_MANAGER', '/dashboard/hr'), true);
  assert.equal(canAccessPath('OFFICE_MANAGER', '/dashboard/hr/credentialing'), true);
  assert.equal(canAccessPath('OFFICE_MANAGER', '/dashboard/hr/supervision'), true);
  assert.equal(canAccessPath('OFFICE_MANAGER', '/dashboard/hr/training'), true);

  // Dashboard root is not blocked
  assert.equal(shouldBlockDashboardPath('OFFICE_MANAGER', '/dashboard'), false);
  assert.equal(homePathForRole('OFFICE_MANAGER'), '/dashboard');
});

test('OFFICE_MANAGER has permissions in client scope and ledger/consents/eligibility modules', () => {
  assert.equal(canAccessClientRoster('OFFICE_MANAGER'), true);
  assert.equal(canCreateClient('OFFICE_MANAGER'), true);
  assert.equal(canAccessClientAppointments('OFFICE_MANAGER'), true);
  assert.equal(canAccessClientMessages('OFFICE_MANAGER'), true);
  assert.equal(canAccessClientChartNotes('OFFICE_MANAGER'), true);

  // Ledger & Claims
  assert.equal(canReadLedger('OFFICE_MANAGER'), true);
  assert.equal(canMutateLedger('OFFICE_MANAGER'), false);
  assert.equal(canAccessDenials('OFFICE_MANAGER'), false);

  // Eligibility & Consents
  assert.equal(canAccessEligibility('OFFICE_MANAGER'), true);
  assert.equal(canAccessConsents('OFFICE_MANAGER'), true);
  assert.equal(PRIOR_AUTH_READ_ROLES.includes('OFFICE_MANAGER'), true);
  assert.equal(PRIOR_AUTH_WRITE_ROLES.includes('OFFICE_MANAGER'), true);

  // Clinic Modules
  assert.equal(canUseClinicModule('OFFICE_MANAGER', 'billing-claims'), false);
  assert.equal(canUseClinicModule('OFFICE_MANAGER', 'denials'), false);
  assert.equal(canUseClinicModule('OFFICE_MANAGER', 'billing-eobs'), false);
  assert.equal(canUseClinicModule('OFFICE_MANAGER', 'superbills'), false);
  assert.equal(canUseClinicModule('OFFICE_MANAGER', 'payer-panels'), false);
  assert.equal(canUseClinicModule('OFFICE_MANAGER', 'invoices'), true);
  assert.equal(canUseClinicModule('OFFICE_MANAGER', 'autopay-clients'), true);
  assert.equal(canUseClinicModule('OFFICE_MANAGER', 'autopay-charges'), true);
  assert.equal(canUseClinicModule('OFFICE_MANAGER', 'prior-auth'), true);
  assert.equal(canUseClinicModule('FRONT_DESK', 'superbills'), true);
  assert.equal(canUseClinicModule('BILLING', 'billing-claims'), true);
  assert.equal(canUseClinicModule('BILLING', 'payer-panels'), true);
  assert.equal(canUseClinicModule('OFFICE_MANAGER', 'hr-operations'), true);
  assert.equal(canUseClinicModule('OFFICE_MANAGER', 'referrals'), true);
});

test('PRACTICE_DIRECTOR has leadership and clinic-wide access', () => {
  assert.equal(canAccessPath('PRACTICE_DIRECTOR', '/dashboard/admin'), true);
  assert.equal(canAccessPath('PRACTICE_DIRECTOR', '/dashboard/billing'), true);
  assert.equal(canAccessPath('PRACTICE_DIRECTOR', '/dashboard/hr'), true);
  assert.equal(canAccessPath('PRACTICE_DIRECTOR', '/dashboard/enterprise'), true);
  assert.equal(canAccessPath('PRACTICE_DIRECTOR', '/dashboard/subscription'), true);
  assert.equal(canAccessPath('PRACTICE_DIRECTOR', '/dashboard/practice-setup'), true);
  assert.equal(canAccessPath('PRACTICE_DIRECTOR', '/dashboard/qi'), true);
  assert.equal(canAccessPath('PRACTICE_DIRECTOR', '/dashboard/compliance'), true);

  // Client roster & clinical
  assert.equal(canAccessClientRoster('PRACTICE_DIRECTOR'), true);
  assert.equal(canCreateClient('PRACTICE_DIRECTOR'), true);
  assert.equal(canAccessClientAppointments('PRACTICE_DIRECTOR'), true);
  assert.equal(canAccessClientMessages('PRACTICE_DIRECTOR'), true);
  assert.equal(canAccessClientChartNotes('PRACTICE_DIRECTOR'), true);
});

test('Role classification helpers correctly recognize new administrative roles', () => {
  assert.equal(isClinicalStaff('OFFICE_MANAGER'), true);
  assert.equal(isClinicalStaff('PRACTICE_DIRECTOR'), true);
  assert.equal(isCaseloadRole('OFFICE_MANAGER'), false);
  assert.equal(isCaseloadRole('PRACTICE_DIRECTOR'), false);

  assert.equal(CLINIC_ADMIN_ROLES.includes('OFFICE_MANAGER'), true);
  assert.equal(CLINIC_ADMIN_ROLES.includes('PRACTICE_DIRECTOR'), true);
  assert.equal(CLINIC_ADMIN_ROLES.includes('ADMIN'), true);
});

test('userRoles helpers provide correct labels and priority hierarchy', () => {
  assert.equal(roleLabel('OFFICE_MANAGER'), 'Office Manager');
  assert.equal(roleLabel('PRACTICE_DIRECTOR'), 'Practice Director');

  const chosen = pickPrimaryRole(['OFFICE_MANAGER', 'PEER_SUPPORT']);
  assert.equal(chosen, 'OFFICE_MANAGER');

  const chosenDirector = pickPrimaryRole(['THERAPIST', 'PRACTICE_DIRECTOR']);
  assert.equal(chosenDirector, 'PRACTICE_DIRECTOR');
});
