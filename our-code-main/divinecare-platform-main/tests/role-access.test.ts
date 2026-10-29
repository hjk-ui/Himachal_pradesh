import assert from 'node:assert/strict';
import { canGenerateDraftClaim } from '../src/lib/billing/claims';
import { test } from 'node:test';
import {
  canAccessPath,
  CLINIC_NAV_HREFS,
  filterNavForRole,
  homePathForRole,
  shouldBlockDashboardPath,
} from '../src/lib/auth/roleAccess';
import {
  canAccessClientAppointments,
  canAccessClientChartNotes,
  canAccessClientMessages,
  canAccessClientRoster,
  canAssignPatientToClinician,
  canCreateClient,
  canEditClientProfile,
  canEditClinicMrn,
  canWriteClientChartNotes,
  clientAccessWhere,
  clientBelongsToOrg,
  clientByIdWhere,
} from '../src/lib/clients/orgScope';
import { canAccessWaitlist } from '../src/lib/waitlist/manage';
import { canAccessIntake } from '../src/lib/intake/manage';
import { canUseClinicModule } from '../src/lib/modules/access';

test('FRONT_DESK cannot open billing; home is allowed', () => {
  assert.equal(canAccessPath('FRONT_DESK', '/dashboard/billing'), false);
  assert.equal(canAccessPath('FRONT_DESK', '/dashboard/billing/claims'), false);
  assert.equal(canAccessPath('FRONT_DESK', '/dashboard'), true);
  assert.equal(shouldBlockDashboardPath('FRONT_DESK', '/dashboard/billing'), true);
  assert.equal(shouldBlockDashboardPath('FRONT_DESK', '/dashboard'), false);
});

test('BILLING cannot open EHR notes', () => {
  assert.equal(canAccessPath('BILLING', '/dashboard/ehr/notes'), false);
  assert.equal(canAccessPath('BILLING', '/dashboard/billing'), true);
  assert.equal(canAccessPath('BILLING', '/dashboard/coding'), true);
  assert.equal(shouldBlockDashboardPath('BILLING', '/dashboard/ehr/notes'), true);
  assert.equal(shouldBlockDashboardPath('BILLING', '/dashboard/coding'), false);
});

test('THERAPIST cannot open HR; telehealth and notes allowed', () => {
  assert.equal(canAccessPath('THERAPIST', '/dashboard/hr'), false);
  assert.equal(canAccessPath('THERAPIST', '/dashboard/telehealth'), true);
  assert.equal(canAccessPath('THERAPIST', '/dashboard/ehr/notes'), true);
  assert.equal(shouldBlockDashboardPath('THERAPIST', '/dashboard/hr'), true);
});

test('SUPER_ADMIN is not blocked by clinic dashboard helper (platform gate is separate)', () => {
  assert.equal(shouldBlockDashboardPath('SUPER_ADMIN', '/dashboard/billing'), false);
  assert.equal(canAccessPath('SUPER_ADMIN', '/platform'), true);
  assert.equal(canAccessPath('SUPER_ADMIN', '/dashboard'), false);
});

test('NP cannot open waitlist or billing; prescriptions allowed', () => {
  assert.equal(canAccessPath('NP', '/dashboard/clients/waitlist'), false);
  assert.equal(canAccessPath('NP', '/dashboard/billing/claims'), false);
  assert.equal(canAccessPath('NP', '/dashboard/ehr/prescriptions'), true);
  assert.equal(shouldBlockDashboardPath('NP', '/dashboard/clients/waitlist'), true);
  assert.equal(shouldBlockDashboardPath('NP', '/dashboard/ehr/prescriptions'), false);
});

test('public-style paths are not clinic dashboard blocks', () => {
  assert.equal(shouldBlockDashboardPath('THERAPIST', '/telehealth/join/abc'), false);
  assert.equal(shouldBlockDashboardPath('THERAPIST', '/intake/token'), false);
  assert.equal(shouldBlockDashboardPath('BILLING', '/book/demo'), false);
});

test('PDF waitlist is Front Desk / Admin / Director only', () => {
  assert.equal(canAccessPath('FRONT_DESK', '/dashboard/clients/waitlist'), true);
  assert.equal(canAccessPath('ADMIN', '/dashboard/clients/waitlist'), true);
  assert.equal(canAccessPath('DIRECTOR', '/dashboard/clients/waitlist'), true);
  assert.equal(canAccessPath('BILLING', '/dashboard/clients/waitlist'), false);
  assert.equal(canAccessPath('THERAPIST', '/dashboard/clients/waitlist'), false);
  assert.equal(canAccessPath('HR', '/dashboard/clients/waitlist'), false);
});

test('PDF digital intake is Front Desk / Admin / Director only', () => {
  assert.equal(canAccessPath('FRONT_DESK', '/dashboard/clients/intake'), true);
  assert.equal(canAccessPath('THERAPIST', '/dashboard/clients/intake'), false);
  assert.equal(canAccessPath('BILLING', '/dashboard/clients/intake'), false);
});

test('PDF billing roster is allowed; notes and waitlist are not', () => {
  assert.equal(canAccessPath('BILLING', '/dashboard/clients'), true);
  assert.equal(canAccessPath('BILLING', '/dashboard/clients/abc'), true);
  assert.equal(canAccessPath('BILLING', '/dashboard/tasks'), true);
  assert.equal(canAccessClientRoster('BILLING'), true);
  assert.equal(canCreateClient('BILLING'), false);
  assert.equal(canAccessPath('BILLING', '/dashboard/ehr/notes'), false);
  assert.equal(canAccessPath('BILLING', '/dashboard/clients/waitlist'), false);
});

test('HR has no patient messages or consents', () => {
  assert.equal(canAccessPath('HR', '/dashboard/messages'), false);
  assert.equal(canAccessClientMessages('HR'), false);
  assert.equal(canAccessPath('HR', '/dashboard/ehr/consents'), false);
  assert.equal(canAccessPath('HR', '/dashboard/hr/credentialing'), true);
  assert.equal(homePathForRole('HR'), '/dashboard');
});

test('PDF clinician cannot open billing; Front Desk can collect copays', () => {
  assert.equal(canAccessPath('THERAPIST', '/dashboard/billing'), false);
  assert.equal(canAccessPath('THERAPIST', '/dashboard/billing/payments'), false);
  assert.equal(canAccessPath('THERAPIST', '/dashboard/billing/claims'), false);
  assert.equal(canAccessPath('FRONT_DESK', '/dashboard/billing/payments'), true);
  assert.equal(canAccessPath('FRONT_DESK', '/dashboard/billing/claims'), false);
  assert.equal(canAccessPath('FRONT_DESK', '/dashboard/alerts'), false);
});

test('specialty homes: PRP notes, peer/case community; Front Desk credentialing blocked', () => {
  assert.equal(canAccessPath('PRP_SPECIALIST', '/dashboard/ehr/notes'), true);
  assert.equal(canAccessPath('PRP_SPECIALIST', '/dashboard/prp'), true);
  assert.equal(canAccessPath('CASE_MANAGER', '/dashboard/community'), true);
  assert.equal(canAccessPath('PEER_SUPPORT', '/dashboard/community'), true);
  assert.equal(canAccessPath('FRONT_DESK', '/dashboard/hr/credentialing'), false);
  assert.equal(homePathForRole('ADMIN'), '/dashboard');
  assert.equal(homePathForRole('BILLING'), '/dashboard');
  assert.equal(homePathForRole('SUPER_ADMIN'), '/platform');
});

test('Leadership sidebar access preserves the scanner clinical-role restriction', () => {
  // Scanner stays clinical-only; HIE/CRISP is PHYSICIAN + MEDICAL_NP only (leadership not excepted).
  const adminDenied = new Set(['/dashboard/ehr/scanner', '/dashboard/ehr/hie']);
  const directorDenied = new Set(['/dashboard/ehr/hie']);
  for (const href of CLINIC_NAV_HREFS) {
    assert.equal(canAccessPath('ADMIN', href), !adminDenied.has(href), `Unexpected ADMIN access for ${href}`);
    assert.equal(canAccessPath('DIRECTOR', href), !directorDenied.has(href), `DIRECTOR blocked from ${href}`);
    assert.equal(canAccessPath('SUPER_ADMIN', href), false, `SUPER_ADMIN leaked clinic ${href}`);
  }
  assert.equal(canAccessPath('SUPER_ADMIN', '/platform'), true);
  assert.equal(canAccessPath('ADMIN', '/platform'), false);
  assert.equal(canAccessPath('THERAPIST', '/platform'), false);
});

const STAFF_LEAK_PATHS = [
  '/dashboard/hr',
  '/dashboard/hr/credentialing',
  '/dashboard/billing/claims',
  '/dashboard/clients/waitlist',
  '/dashboard/clients/intake',
  '/dashboard/community',
  '/dashboard/pr',
  '/dashboard/subscription',
  '/dashboard/practice-setup',
  '/dashboard/qi',
  '/dashboard/admin',
] as const;

test('Therapist / Psych / NP cannot open HR, claims, waitlist, community, subscription', () => {
  for (const role of ['THERAPIST', 'PSYCHIATRIST', 'NP', 'CLINICIAN'] as const) {
    for (const href of STAFF_LEAK_PATHS) {
      assert.equal(canAccessPath(role, href), false, `${role} leaked ${href}`);
      assert.equal(shouldBlockDashboardPath(role, href), true, `${role} URL not blocked ${href}`);
    }
    assert.equal(canAccessPath(role, '/dashboard/ehr/notes'), true);
    assert.equal(canAccessPath(role, '/dashboard/telehealth'), true);
    assert.equal(canAccessWaitlist(role), false);
    assert.equal(canAccessIntake(role), false);
  }
  assert.equal(canAccessPath('PSYCHIATRIST', '/dashboard/ehr/prescriptions'), true);
  assert.equal(canAccessPath('NP', '/dashboard/ehr/prescriptions'), true);
  assert.equal(canAccessPath('THERAPIST', '/dashboard/ehr/prescriptions'), false);
});

test('Peer Support cannot open EHR notes, alerts, scribe, billing, waitlist, HR', () => {
  const blocked = [
    '/dashboard/ehr/notes',
    '/dashboard/ehr',
    '/dashboard/alerts',
    '/dashboard/scribe',
    '/dashboard/ai-insights',
    '/dashboard/mbc',
    '/dashboard/billing/claims',
    '/dashboard/clients/waitlist',
    '/dashboard/hr',
    '/dashboard/subscription',
  ];
  for (const href of blocked) {
    assert.equal(canAccessPath('PEER_SUPPORT', href), false, `PEER leaked ${href}`);
  }
  assert.equal(canAccessPath('PEER_SUPPORT', '/dashboard/messages'), true);
  assert.equal(canAccessPath('PEER_SUPPORT', '/dashboard/appointments'), true);
  assert.equal(canAccessPath('PEER_SUPPORT', '/dashboard/community'), true);
  assert.equal(canAccessClientChartNotes('PEER_SUPPORT'), false);
  assert.equal(canWriteClientChartNotes('PEER_SUPPORT'), false);
  assert.equal(canCreateClient('PEER_SUPPORT'), false);
});

test('Case Manager cannot open notes list, billing, waitlist, HR, scribe', () => {
  for (const href of [
    '/dashboard/ehr/notes',
    '/dashboard/billing/claims',
    '/dashboard/clients/waitlist',
    '/dashboard/hr',
    '/dashboard/scribe',
    '/dashboard/subscription',
  ]) {
    assert.equal(canAccessPath('CASE_MANAGER', href), false, `CASE_MANAGER leaked ${href}`);
  }
  assert.equal(canAccessPath('CASE_MANAGER', '/dashboard/community'), true);
  assert.equal(canAccessPath('CASE_MANAGER', '/dashboard/alerts'), true);
  assert.equal(canAccessClientChartNotes('CASE_MANAGER'), true);
});

test('Front Desk cannot open claims, HR, alerts, community events, QI', () => {
  for (const href of [
    '/dashboard/billing/claims',
    '/dashboard/hr',
    '/dashboard/alerts',
    '/dashboard/community',
    '/dashboard/pr',
    '/dashboard/qi',
    '/dashboard/ehr/notes',
    '/dashboard/scribe',
  ]) {
    assert.equal(canAccessPath('FRONT_DESK', href), false, `FRONT_DESK leaked ${href}`);
  }
  assert.equal(canAccessPath('FRONT_DESK', '/dashboard/community/referrals'), true);
  assert.equal(canAccessPath('FRONT_DESK', '/dashboard/billing/payments'), true);
  assert.equal(canAccessWaitlist('FRONT_DESK'), true);
  assert.equal(canAccessClientAppointments('BILLING'), false);
});

test('HR: no patient modules, no My To-Do, no Resource Library', () => {
  for (const href of [
    '/dashboard/clients',
    '/dashboard/messages',
    '/dashboard/appointments',
    '/dashboard/telehealth',
    '/dashboard/ehr/consents',
    '/dashboard/ehr/notes',
    '/dashboard/billing',
    '/dashboard/clients/waitlist',
    '/dashboard/clients/intake',
    '/dashboard/community',
    '/dashboard/alerts',
    '/dashboard/tasks',
    '/dashboard/resources',
  ]) {
    assert.equal(canAccessPath('HR', href), false, `HR leaked ${href}`);
    assert.equal(shouldBlockDashboardPath('HR', href), true, `HR URL not blocked ${href}`);
  }
  assert.equal(canAccessClientRoster('HR'), false);
  assert.equal(canAccessClientChartNotes('HR'), false);
  assert.equal(canAccessClientMessages('HR'), false);
  assert.equal(canAccessClientAppointments('HR'), false);
  assert.equal(canAssignPatientToClinician('HR'), false);
  assert.equal(canAccessPath('HR', '/dashboard/hr'), true);
  assert.equal(canAccessPath('HR', '/dashboard/hr/credentialing'), true);
  assert.equal(canAccessPath('HR', '/dashboard/hr/training'), true);
  assert.equal(canAccessPath('HR', '/dashboard/settings'), true);
});

test('Admin, PD, Front Desk, and Office Manager can assign a patient to a clinician', () => {
  assert.equal(canAssignPatientToClinician('ADMIN'), true);
  assert.equal(canAssignPatientToClinician('PRACTICE_DIRECTOR'), true);
  assert.equal(canAssignPatientToClinician('FRONT_DESK'), true);
  assert.equal(canAssignPatientToClinician('OFFICE_MANAGER'), true);
  for (const role of [
    'DIRECTOR',
    'THERAPIST',
    'PSYCHIATRIST',
    'NP',
    'CLINICIAN',
    'BILLING',
    'HR',
    'CASE_MANAGER',
    'PEER_SUPPORT',
  ] as const) {
    assert.equal(canAssignPatientToClinician(role), false, `${role} must not assign`);
  }
});

test('Caseload roles stay inside the organization and match assignment or treatment-team membership', () => {
  const orgBoundary = {
    OR: [
      { organizationId: 'org-1' },
      { location: { organizationId: 'org-1' } },
      {
        AND: [{ locationId: null }, { assignedTo: { organizationId: 'org-1' } }],
      },
    ],
  };
  const caseloadBoundary = {
    OR: [
      { assignedToId: 'doc-1' },
      { treatmentTeamMembers: { some: { providerId: 'doc-1' } } },
    ],
  };

  for (const role of [
    'THERAPIST',
    'PSYCHIATRIST',
    'NP',
    'CLINICIAN',
    'PRP_SPECIALIST',
    'CASE_MANAGER',
    'PEER_SUPPORT',
    'PHYSICIAN',
    'MEDICAL_NP',
    'MEDICAL_ASSISTANT',
  ] as const) {
    const where = clientAccessWhere({
      organizationId: 'org-1',
      actorUserId: 'doc-1',
      actorRole: role,
    });
    assert.deepEqual(
      where,
      { AND: [orgBoundary, caseloadBoundary] },
      `${role} must keep the organization filter and both caseload paths`
    );
    const [organization, caseload] = where.AND ?? [];
    const organizationMatch =
      organization &&
      'OR' in organization &&
      Array.isArray(organization.OR) &&
      organization.OR.some((branch) => 'organizationId' in branch && branch.organizationId === 'org-1');
    const directlyAssigned =
      caseload &&
      'OR' in caseload &&
      Array.isArray(caseload.OR) &&
      caseload.OR.some((branch) => 'assignedToId' in branch && branch.assignedToId === 'doc-1');
    const onTreatmentTeam =
      caseload &&
      'OR' in caseload &&
      Array.isArray(caseload.OR) &&
      caseload.OR.some(
        (branch) =>
          'treatmentTeamMembers' in branch &&
          branch.treatmentTeamMembers?.some?.providerId === 'doc-1'
      );
    const unrelatedStaff =
      caseload &&
      'OR' in caseload &&
      Array.isArray(caseload.OR) &&
      caseload.OR.some((branch) => 'assignedToId' in branch && branch.assignedToId === 'other-staff');
    assert.equal(organizationMatch && directlyAssigned, true, `${role} direct assignment`);
    assert.equal(organizationMatch && onTreatmentTeam, true, `${role} treatment team`);
    assert.equal(Boolean(unrelatedStaff), false, `${role} unrelated staff`);
    assert.equal(JSON.stringify(where).includes('org-2'), false, `${role} cross-tenant`);
  }

  const otherTenant = clientAccessWhere({
    organizationId: 'org-2',
    actorUserId: 'doc-1',
    actorRole: 'THERAPIST',
  });
  assert.equal(JSON.stringify(otherTenant).includes('org-1'), false);
  assert.equal(JSON.stringify(otherTenant).includes('org-2'), true);
  assert.notDeepEqual(otherTenant, clientAccessWhere({
    organizationId: 'org-1',
    actorUserId: 'doc-1',
    actorRole: 'THERAPIST',
  }));

  const admin = clientAccessWhere({
    organizationId: 'org-1',
    actorUserId: 'admin-1',
    actorRole: 'ADMIN',
  });
  assert.deepEqual(admin, {
    OR: [
      { organizationId: 'org-1' },
      { location: { organizationId: 'org-1' } },
      {
        AND: [{ locationId: null }, { assignedTo: { organizationId: 'org-1' } }],
      },
    ],
  });
});

test('licensed clinicians can generate draft claims from locked notes; front desk cannot', () => {
  const { canGenerateDraftClaim, canMutateClaims } = require('../src/lib/billing/claims') as typeof import('../src/lib/billing/claims');
  assert.equal(canGenerateDraftClaim('THERAPIST'), true);
  assert.equal(canGenerateDraftClaim('BILLING'), true);
  assert.equal(canMutateClaims('THERAPIST'), false);
  assert.equal(canGenerateDraftClaim('FRONT_DESK'), false);
  assert.equal(canGenerateDraftClaim('HR'), false);
});

test('Peer Support cannot open Diagnoses (blocked + module 403)', () => {
  assert.equal(canAccessPath('PEER_SUPPORT', '/dashboard/ehr/diagnoses'), false);
  assert.equal(shouldBlockDashboardPath('PEER_SUPPORT', '/dashboard/ehr/diagnoses'), true);
  assert.equal(canUseClinicModule('PEER_SUPPORT', 'diagnoses'), false);
  assert.equal(canUseClinicModule('THERAPIST', 'diagnoses'), true);
});

test('Clinic B session does not match Clinic A client by id', () => {
  const clinicA = {
    locationId: 'loc-a',
    location: { organizationId: 'org-a' },
    assignedTo: { organizationId: 'org-a' },
  };
  assert.equal(clientBelongsToOrg(clinicA, 'org-a'), true);
  assert.equal(clientBelongsToOrg(clinicA, 'org-b'), false);

  const where = clientByIdWhere('client-from-clinic-a', 'org-b');
  assert.equal(where.id, 'client-from-clinic-a');
  assert.ok(where.AND);
  assert.deepEqual(where.AND, [
    {
      OR: [
        { organizationId: 'org-b' },
        { location: { organizationId: 'org-b' } },
        {
          AND: [{ locationId: null }, { assignedTo: { organizationId: 'org-b' } }],
        },
      ],
    },
  ]);
});

test('FRONT_DESK and BILLING sidebars are not the full clinic nav', () => {
  const nav = [
    {
      label: 'Clinical',
      items: [
        { href: '/dashboard' },
        { href: '/dashboard/clients' },
        { href: '/dashboard/ehr/notes' },
        { href: '/dashboard/billing/claims' },
        { href: '/dashboard/hr' },
      ],
    },
  ];
  const frontDesk = filterNavForRole(nav, 'FRONT_DESK');
  const fdHrefs = frontDesk.flatMap((s) => s.items.map((i) => i.href));
  assert.ok(fdHrefs.includes('/dashboard/clients'));
  assert.ok(!fdHrefs.includes('/dashboard/ehr/notes'));
  assert.ok(!fdHrefs.includes('/dashboard/billing/claims'));
  assert.ok(!fdHrefs.includes('/dashboard/hr'));

  const billing = filterNavForRole(nav, 'BILLING');
  const billingHrefs = billing.flatMap((s) => s.items.map((i) => i.href));
  assert.ok(billingHrefs.includes('/dashboard/clients'));
  assert.ok(!billingHrefs.includes('/dashboard/ehr/notes'));
});

test('MEDICAL_ASSISTANT has full access to Medical department and client roster but cannot prescribe', () => {
  // Medical department suite access
  assert.equal(canAccessPath('MEDICAL_ASSISTANT', '/dashboard/medical'), true);
  assert.equal(canAccessPath('MEDICAL_ASSISTANT', '/dashboard/medical/patients'), true);
  assert.equal(canAccessPath('MEDICAL_ASSISTANT', '/dashboard/medical/patients/intake'), true);
  assert.equal(canAccessPath('MEDICAL_ASSISTANT', '/dashboard/medical/visits'), true);
  assert.equal(canAccessPath('MEDICAL_ASSISTANT', '/dashboard/medical/history'), true);
  assert.equal(canAccessPath('MEDICAL_ASSISTANT', '/dashboard/medical/vitals'), true);
  assert.equal(canAccessPath('MEDICAL_ASSISTANT', '/dashboard/medical/labs'), true);

  // Restricted within medical:
  assert.equal(canAccessPath('MEDICAL_ASSISTANT', '/dashboard/medical/problem-list'), false);
  assert.equal(canAccessPath('MEDICAL_ASSISTANT', '/dashboard/medical/preventive-care'), false);

  // Shared / cross-department access:
  assert.equal(canAccessPath('MEDICAL_ASSISTANT', '/dashboard/clients'), true);
  assert.equal(canAccessPath('MEDICAL_ASSISTANT', '/dashboard/tasks'), true);
  assert.equal(canAccessPath('MEDICAL_ASSISTANT', '/dashboard/telehealth'), true);
  assert.equal(canAccessPath('MEDICAL_ASSISTANT', '/dashboard/communications'), true);
  assert.equal(canAccessClientRoster('MEDICAL_ASSISTANT'), true);

  // Blocked modules:
  assert.equal(canAccessPath('MEDICAL_ASSISTANT', '/dashboard/admin'), false);
  assert.equal(canAccessPath('MEDICAL_ASSISTANT', '/dashboard/hr'), false);
  assert.equal(canAccessPath('MEDICAL_ASSISTANT', '/dashboard/ehr/notes'), false);
});

test('CRISIS_RESPONDER has access to Mobile Crisis, Risk Alerts, Dashboard, Telehealth, and Communications', () => {
  assert.equal(canAccessPath('CRISIS_RESPONDER', '/dashboard'), true);
  assert.equal(canAccessPath('CRISIS_RESPONDER', '/dashboard/crisis'), true);
  assert.equal(canAccessPath('CRISIS_RESPONDER', '/dashboard/alerts'), true);
  assert.equal(canAccessPath('CRISIS_RESPONDER', '/dashboard/tasks'), true);
  assert.equal(canAccessPath('CRISIS_RESPONDER', '/dashboard/telehealth'), true);
  assert.equal(canAccessPath('CRISIS_RESPONDER', '/dashboard/communications'), true);

  // Blocked areas:
  assert.equal(canAccessPath('CRISIS_RESPONDER', '/dashboard/medical'), false);
  assert.equal(canAccessPath('CRISIS_RESPONDER', '/dashboard/admin'), false);
  assert.equal(canAccessPath('CRISIS_RESPONDER', '/dashboard/hr'), false);
  assert.equal(canAccessPath('CRISIS_RESPONDER', '/dashboard/ehr/notes'), false);
  assert.equal(canAccessPath('CRISIS_RESPONDER', '/dashboard/ehr/prescriptions'), false);
});

test('canEditClientProfile permits leadership, super admin, admin, front desk, and clinicians; blocks billing, hr, peer support', () => {
  // Allowed leadership & staff:
  assert.equal(canEditClientProfile('SUPER_ADMIN'), true);
  assert.equal(canEditClientProfile('ADMIN'), true);
  assert.equal(canEditClientProfile('PRACTICE_DIRECTOR'), true);
  assert.equal(canEditClientProfile('DIRECTOR'), true);
  assert.equal(canEditClientProfile('OFFICE_MANAGER'), true);
  assert.equal(canEditClientProfile('FRONT_DESK'), true);
  assert.equal(canEditClientProfile('THERAPIST'), true);
  assert.equal(canEditClientProfile('PSYCHIATRIST'), true);
  assert.equal(canEditClientProfile('NP'), true);
  assert.equal(canEditClientProfile('PHYSICIAN'), true);
  assert.equal(canEditClientProfile('MEDICAL_NP'), true);
  assert.equal(canEditClientProfile('MEDICAL_ASSISTANT'), true);
  assert.equal(canEditClientProfile('CASE_MANAGER'), true);

  // Assignment permissions for Super Admin & Admin:
  assert.equal(canAssignPatientToClinician('SUPER_ADMIN'), true);
  assert.equal(canAssignPatientToClinician('ADMIN'), true);
  assert.equal(canEditClinicMrn('SUPER_ADMIN'), true);
  assert.equal(canEditClinicMrn('ADMIN'), true);

  // Strictly blocked roles:
  assert.equal(canEditClientProfile('BILLING'), false);
  assert.equal(canEditClientProfile('HR'), false);
  assert.equal(canEditClientProfile('PEER_SUPPORT'), false);
  assert.equal(canEditClientProfile(null), false);
  assert.equal(canEditClientProfile(undefined), false);
});

test('staging minimum necessary: office manager loses clinical boards and scanner; primary care can open profile', () => {
  for (const href of ['/dashboard/crisis', '/dashboard/residential', '/dashboard/aot', '/dashboard/prp', '/dashboard/ehr/scanner']) {
    assert.equal(canAccessPath('OFFICE_MANAGER', href), false, href);
    assert.equal(canAccessPath('THERAPIST', href), true, href);
  }
  assert.equal(canAccessPath('ADMIN', '/dashboard/ehr/scanner'), false);
  assert.equal(canAccessPath('DIRECTOR', '/dashboard/ehr/scanner'), true);
  assert.equal(canAccessPath('PHYSICIAN', '/dashboard/settings'), true);
  assert.equal(canAccessPath('MEDICAL_NP', '/dashboard/settings'), true);
  assert.equal(canAccessPath('MEDICAL_ASSISTANT', '/dashboard/settings'), true);
  assert.equal(homePathForRole('PHYSICIAN'), '/dashboard/medical');
  assert.equal(homePathForRole('CRISIS_RESPONDER'), '/dashboard/crisis');
});


