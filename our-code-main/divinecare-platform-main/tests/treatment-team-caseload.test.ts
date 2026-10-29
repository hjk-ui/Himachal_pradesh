import test from 'node:test';
import assert from 'node:assert/strict';
import type { Client, StaffMember } from '../src/features/clients/types';
import {
  calculateClientAcuity,
  calculateSafeAcuityCeiling,
  calculateStaffCaseload,
  getDaysUntilLicenseExpiry,
  getThresholdStatus,
  getVisibleClientsForUser,
  isClientAssignedToStaff,
  isClientOnWaitlist,
  isLicenseExpiringSoon,
  ROLE_SLOT_MAP,
  scoreMatches,
} from '../src/features/caseload/algorithms';
import {
  INITIAL_CLIENTS,
  INITIAL_STAFF_MEMBERS,
} from '../src/features/caseload/staffCatalog';

test('Caseload - Acuity-Weighted dual metric calculations', () => {
  // Test High Risk + Complexity 3
  const highAcuityClient: Client = {
    id: 'test-1',
    name: 'High Risk Patient',
    email: 'test@example.com',
    phone: '555-0100',
    assignedSince: '2026-01-01',
    lastCheckIn: 'Today',
    avgMood: 3,
    avgStress: 8,
    streak: 5,
    risk: 'high',
    totalSessions: 10,
    diagnosisComplexity: 3,
    diagnosis: 'Bipolar disorder severe',
  };
  // 10 base + 15 (high risk) + 10 (complexity 3) = 35
  assert.equal(calculateClientAcuity(highAcuityClient), 35);

  // Test Medium Risk + Complexity 2
  const medAcuityClient: Client = {
    ...highAcuityClient,
    risk: 'medium',
    diagnosisComplexity: 2,
  };
  // 10 base + 5 (medium risk) + 5 (complexity 2) = 20
  assert.equal(calculateClientAcuity(medAcuityClient), 20);

  // Test Low Risk + Complexity 1
  const lowAcuityClient: Client = {
    ...highAcuityClient,
    risk: 'low',
    diagnosisComplexity: 1,
  };
  // 10 base + 0 (low risk) + 0 (complexity 1) = 10
  assert.equal(calculateClientAcuity(lowAcuityClient), 10);

  // Safe Acuity Ceiling
  const sampleStaff: StaffMember = {
    id: 'staff-1',
    name: 'Sample Therapist',
    role: 'therapist',
    credential: 'LCSW',
    color: '#00897B',
    maxCaseload: 20,
    specialties: ['cbt'],
    languages: ['English'],
    acceptedPayers: ['medicaid'],
  };
  // Safe ceiling = 20 * 15 = 300
  assert.equal(calculateSafeAcuityCeiling(sampleStaff), 300);
});

test('Caseload - Threshold status and color codes', () => {
  // Green (<65%)
  const green = getThresholdStatus(50);
  assert.equal(green.status, 'Available');
  assert.equal(green.color, 'green');

  // Amber (65% - 85%)
  const amber = getThresholdStatus(75);
  assert.equal(amber.status, 'Moderate');
  assert.equal(amber.color, 'amber');

  // Red (>85%)
  const red = getThresholdStatus(92);
  assert.equal(red.status, 'Near limit');
  assert.equal(red.color, 'red');
});

test('Caseload - Smart Matching Scoring Engine ranking & bonus calculations', () => {
  const staffList: StaffMember[] = [
    {
      id: 'staff-a',
      name: 'PTSD Expert Therapist',
      role: 'therapist',
      credential: 'LCSW',
      color: '#00897B',
      maxCaseload: 25,
      specialties: ['ptsd', 'trauma', 'cbt'],
      languages: ['English'],
      acceptedPayers: ['medicaid', 'commercial'],
      isSupervisee: false,
    },
    {
      id: 'staff-b',
      name: 'Intern Therapist Supervised',
      role: 'therapist',
      credential: 'MSW Intern',
      color: '#00897B',
      maxCaseload: 20,
      specialties: ['general', 'support'],
      languages: ['English'],
      acceptedPayers: ['commercial'],
      isSupervisee: true,
      supervisorId: 'staff-a',
    },
  ];

  const clientToMatch: Partial<Client> = {
    diagnosis: 'Severe PTSD with chronic trauma symptoms',
    insuranceType: 'medicaid',
  };

  const matches = scoreMatches(clientToMatch, staffList, []);

  assert.equal(matches.length, 2);
  // staff-a should be top match
  const topMatch = matches[0];
  assert.equal(topMatch.staff.id, 'staff-a');
  assert.equal(topMatch.isBestMatch, true);
  // staff-a points:
  // +20 (ptsd) + 20 (trauma) = 40
  // +30 (<50% capacity with 0 clients)
  // +15 (accepts medicaid)
  // Total = 85
  assert.equal(topMatch.score, 85);
  assert.equal(topMatch.payerMismatch, false);

  // staff-b points:
  // 0 specialty matches
  // +30 (<50% capacity)
  // payer mismatch (client medicaid vs staff commercial) -> 0 pts + payerMismatch flag
  // -5 supervision penalty
  // Total = 25
  const secondMatch = matches[1];
  assert.equal(secondMatch.staff.id, 'staff-b');
  assert.equal(secondMatch.score, 25);
  assert.equal(secondMatch.payerMismatch, true);
  assert.equal(secondMatch.isBestMatch, false);
});

test('Caseload - Compliance & License Expiry warning logic (<90 days)', () => {
  // Expiry in 40 days (<90)
  const expiringDate = new Date(Date.now() + 40 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0];
  assert.equal(isLicenseExpiringSoon(expiringDate), true);

  const days = getDaysUntilLicenseExpiry(expiringDate);
  assert.ok(days !== null && days >= 38 && days <= 41);

  // Expiry in 180 days (>90)
  const futureDate = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0];
  assert.equal(isLicenseExpiringSoon(futureDate), false);

  // David Kim in INITIAL_STAFF_MEMBERS should flag license expiry
  const david = INITIAL_STAFF_MEMBERS.find((s) => s.id === 'staff-therapist-2');
  assert.ok(david);
  assert.equal(isLicenseExpiringSoon(david.licenseExpiry), true);
});

test('Caseload - Role-based access control (RBAC) & Supervision visibility', () => {
  // Admin sees all clients
  const adminUser = { id: 'admin-1', role: 'ADMIN' };
  const adminView = getVisibleClientsForUser(adminUser, INITIAL_CLIENTS, INITIAL_STAFF_MEMBERS);
  assert.equal(adminView.length, INITIAL_CLIENTS.length);

  // Clinician Sarah Lin (staff-therapist-3) sees only clients assigned to her
  const sarahUser = { id: 'staff-therapist-3', role: 'THERAPIST' };
  const sarahView = getVisibleClientsForUser(sarahUser, INITIAL_CLIENTS, INITIAL_STAFF_MEMBERS);
  assert.ok(sarahView.length > 0);
  assert.ok(sarahView.every((c) => c.treatmentTeam?.primaryTherapistId === 'staff-therapist-3'));

  // Supervisor Marcus Reed (staff-therapist-1) sees clients assigned to him PLUS clients assigned to his supervisee David Kim (staff-therapist-2)
  const marcusUser = { id: 'staff-therapist-1', role: 'THERAPIST' };
  const marcusView = getVisibleClientsForUser(marcusUser, INITIAL_CLIENTS, INITIAL_STAFF_MEMBERS);

  // Client 4 (Aisha Johnson) is assigned to David Kim (supervisee)
  const aisha = marcusView.find((c) => c.id === 'client-4');
  assert.ok(aisha, 'Supervisor must see supervisee assigned clients in caseload');
});

test('Caseload - Waitlist identification', () => {
  // Client 7 and 8 have empty treatment teams
  const c7 = INITIAL_CLIENTS.find((c) => c.id === 'client-7');
  assert.ok(c7);
  assert.equal(isClientOnWaitlist(c7), true);

  // Client 1 has complete team
  const c1 = INITIAL_CLIENTS.find((c) => c.id === 'client-1');
  assert.ok(c1);
  assert.equal(isClientOnWaitlist(c1), false);
});
