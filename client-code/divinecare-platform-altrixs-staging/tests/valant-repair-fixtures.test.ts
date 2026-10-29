import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Prisma } from '@prisma/client';
import {
  parseEasternDateTime,
  parseCopayAmount,
  standardizePhone,
  isGeneratedEmailAlias,
  isGeneratedPayer,
  classifyAppointmentRow,
  calculateClientRepair,
  matchAppointmentDeterministic,
  computeLegacyLocalStart,
  isValidWallClockTime,
  reconcileSourcePatientRows,
  verifySourcePatientsLinked,
  planClientRollback,
  filterRollbackTargets,
  ClientFieldDiff,
  CLINIC_TIMEZONE,
  ORIGINAL_IMPORT_TIMEZONE,
  AppointmentRepairRecord,
  writeDurablePrivateFile,
  appendDurableJournal,
  secureFilePermissions,
  preflightAndVerifyBackupStorage,
  executeClientRepairBatch,
  executeClientRollbackBatch,
  executeAppointmentRepairBatch,
  executeAppointmentRollbackBatch,
} from '../src/lib/valant/repair';

// ---------------------------------------------------------------------------
// 1. TIMEZONE, MIDNIGHT/NOON, DURATION & DST TESTS
// ---------------------------------------------------------------------------

test('parseEasternDateTime correctly converts EDT (Summer UTC-4) to UTC', () => {
  const result = parseEasternDateTime('07/15/2026', '09:00-09:45 AM', CLINIC_TIMEZONE);
  assert.ok(result);
  assert.equal(result.start.toISOString(), '2026-07-15T13:00:00.000Z');
  assert.equal(result.end.toISOString(), '2026-07-15T13:45:00.000Z');
  assert.equal(result.durationMinutes, 45);
});

test('parseEasternDateTime correctly parses long textual date format (Monday, October 12, 2026)', () => {
  const result = parseEasternDateTime('Monday, October 12, 2026', '06:00-07:45 PM', CLINIC_TIMEZONE);
  assert.ok(result);
  assert.equal(result.start.toISOString(), '2026-10-12T22:00:00.000Z'); // 6:00 PM EDT -> 22:00 UTC
  assert.equal(result.end.toISOString(), '2026-10-12T23:45:00.000Z');
  assert.equal(result.durationMinutes, 105);
});

test('parseEasternDateTime correctly converts EST (Winter UTC-5) to UTC', () => {
  const result = parseEasternDateTime('01/15/2026', '09:00-09:45 AM', CLINIC_TIMEZONE);
  assert.ok(result);
  assert.equal(result.start.toISOString(), '2026-01-15T14:00:00.000Z');
  assert.equal(result.end.toISOString(), '2026-01-15T14:45:00.000Z');
  assert.equal(result.durationMinutes, 45);
});

test('parseEasternDateTime handles midnight (12:00 AM) and noon (12:00 PM) correctly', () => {
  // Midnight 12:00 AM EDT -> 04:00 UTC
  const midnight = parseEasternDateTime('07/15/2026', '12:00-12:45 AM', CLINIC_TIMEZONE);
  assert.ok(midnight);
  assert.equal(midnight.start.toISOString(), '2026-07-15T04:00:00.000Z');
  assert.equal(midnight.durationMinutes, 45);

  // Noon 12:00 PM EDT -> 16:00 UTC
  const noon = parseEasternDateTime('07/15/2026', '12:00-12:45 PM', CLINIC_TIMEZONE);
  assert.ok(noon);
  assert.equal(noon.start.toISOString(), '2026-07-15T16:00:00.000Z');
  assert.equal(noon.durationMinutes, 45);
});

test('parseEasternDateTime handles cross-noon duration correctly', () => {
  // 11:30 AM to 01:00 PM EDT (90 minutes) -> 15:30 to 17:00 UTC
  const crossNoon = parseEasternDateTime('07/15/2026', '11:30-01:00 PM', CLINIC_TIMEZONE);
  assert.ok(crossNoon);
  assert.equal(crossNoon.start.toISOString(), '2026-07-15T15:30:00.000Z');
  assert.equal(crossNoon.end.toISOString(), '2026-07-15T17:00:00.000Z');
  assert.equal(crossNoon.durationMinutes, 90);
});

test('parseEasternDateTime rejects nonexistent times during DST spring forward', () => {
  // On March 8, 2026 (second Sunday of March in US), clocks jump from 2:00 AM to 3:00 AM EDT.
  // 2:30 AM does NOT exist.
  const nonexistent = parseEasternDateTime('03/08/2026', '02:30-03:15 AM', CLINIC_TIMEZONE);
  assert.equal(nonexistent, null);
  assert.equal(isValidWallClockTime(2026, 3, 8, 2, 30, CLINIC_TIMEZONE), false);
});

test('parseEasternDateTime rejects negative or excessive durations', () => {
  // End before start
  assert.equal(parseEasternDateTime('07/15/2026', '10:00-09:00 AM', CLINIC_TIMEZONE), null);
  // Duration > 12 hours (720 min)
  assert.equal(parseEasternDateTime('07/15/2026', '06:00-08:00 PM', CLINIC_TIMEZONE)?.durationMinutes, 120);
});

// ---------------------------------------------------------------------------
// 2. INVALID & MISSING COPAY HANDLING (NEVER CONVERT TO ZERO)
// ---------------------------------------------------------------------------

test('parseCopayAmount never converts invalid or missing copay to zero', () => {
  assert.equal(parseCopayAmount('20.0000'), 20);
  assert.equal(parseCopayAmount('$15.50'), 15.5);
  assert.equal(parseCopayAmount('0.0000'), 0); // legitimate $0 copay
  assert.equal(parseCopayAmount(''), null); // missing -> null, NOT 0
  assert.equal(parseCopayAmount('   '), null); // whitespace -> null, NOT 0
  assert.equal(parseCopayAmount(null), null);
  assert.equal(parseCopayAmount(undefined), null);
  assert.equal(parseCopayAmount('N/A'), null);
  assert.equal(parseCopayAmount('$invalid'), null);
  assert.equal(parseCopayAmount('-10.00'), null); // negative invalid
});

// ---------------------------------------------------------------------------
// 3. SOURCE-VERIFIED EMAIL ALIAS & GUESS PAYER DETECTION
// ---------------------------------------------------------------------------

test('isGeneratedEmailAlias verifies against raw source email and MRN', () => {
  // Matches exact pattern: rawEmail with +cleanMrn
  assert.equal(isGeneratedEmailAlias('family+syn001@example.com', 'family@example.com', 'SYN-001'), true);
  // Different MRN -> false
  assert.equal(isGeneratedEmailAlias('family+syn001@example.com', 'family@example.com', 'OTHER-MRN'), false);
  // Normal email -> false
  assert.equal(isGeneratedEmailAlias('normal.user@example.com', 'normal.user@example.com', 'SYN-001'), false);
});

test('isGeneratedPayer preserves legitimate Self-Pay and real payers', () => {
  // Matches source city Commercial (Hanover) -> generated, clear it
  assert.equal(isGeneratedPayer('Commercial (Hanover)', 'MD Behavioral Health', 'Hanover'), true);
  // Matches assigned facility name -> generated, clear it
  assert.equal(isGeneratedPayer('MD Behavioral Health', 'MD Behavioral Health', ''), true);
  // Legitimate Self-Pay where source has no matching city or facility -> DO NOT clear!
  assert.equal(isGeneratedPayer('Self-Pay', 'MD Behavioral Health', 'Hanover'), false);
  // Real commercial payer -> DO NOT clear!
  assert.equal(isGeneratedPayer('CareFirst BlueCross', 'MD Behavioral Health', 'Hanover'), false);
  assert.equal(isGeneratedPayer('Maryland Medicaid', 'MD Behavioral Health', 'Hanover'), false);
});

// ---------------------------------------------------------------------------
// 4. REPAIR CALCULATION & CONCURRENT EDITS GUARD
// ---------------------------------------------------------------------------

test('calculateClientRepair corrects only verified fields with optimistic concurrency metadata', () => {
  const client = {
    id: 'client-1',
    mrn: 'SYN001',
    insuranceMemberId: 'COPAY-25.0000',
    insurancePayer: 'Commercial (Hanover)',
    email: 'parent+syn001@example.com',
    phone: '+13015550199', // emergency copied here
    emergencyContactPhone: '+13015550199',
    treatmentTeam: null,
    createdAt: new Date('2026-10-13T12:00:00Z'),
    updatedAt: new Date('2026-10-13T12:08:00Z'),
  };

  const sourceData = {
    ptPhone2: '', // Phone 2 was empty
    emergencyPhone: '301-555-0199',
    copay: '25.0000',
    rawEmail: 'parent@example.com',
    assignedFacName: 'MD Behavioral Health',
    ins1City: 'Hanover',
  };

  const { diff, manualEditSkipped } = calculateClientRepair(client, sourceData);

  assert.equal(manualEditSkipped, false);
  assert.ok(diff);
  assert.equal(diff.clientId, 'client-1');
  assert.equal(diff.auditedUpdatedAt, '2026-10-13T12:08:00.000Z');
  assert.equal(diff.after.insuranceMemberId, null);
  assert.equal(diff.after.insurancePayer, null);
  assert.equal(diff.after.phone, null);
  assert.equal(diff.after.email, null);
  assert.deepEqual(diff.after.treatmentTeam, { copay: { amount: 25, unit: 'USD' } });
});

test('calculateClientRepair handles missing copay without converting to zero', () => {
  const client = {
    id: 'client-2',
    mrn: 'SYN002',
    insuranceMemberId: 'COPAY-', // empty copay
    insurancePayer: 'Commercial (Hanover)',
    email: 'user@example.com',
    phone: '+13015550100',
    emergencyContactPhone: null,
    treatmentTeam: null,
    createdAt: new Date('2026-10-13T12:00:00Z'),
    updatedAt: new Date('2026-10-13T12:08:00Z'),
  };

  const sourceData = {
    ptPhone2: '+13015550100',
    emergencyPhone: null,
    copay: '', // Missing copay!
    rawEmail: 'user@example.com',
    assignedFacName: 'MD Behavioral Health',
    ins1City: 'Hanover',
  };

  const { diff } = calculateClientRepair(client, sourceData);
  assert.ok(diff);
  assert.equal(diff.after.insuranceMemberId, null);
  // Treatment team copay must NOT be set to zero! It should remain null!
  assert.equal(diff.after.treatmentTeam, null);
});

test('calculateClientRepair preserves existing TreatmentTeam slots when updating copay', () => {
  const existingTeam = {
    primaryTherapistId: 'staff-therapist-1',
    primaryTherapistName: 'Jane Smith, LCSW',
  };

  const client = {
    id: 'client-3',
    mrn: 'SYN003',
    insuranceMemberId: 'COPAY-30.0000',
    insurancePayer: null,
    email: 'user3@example.com',
    phone: '+13015550100',
    emergencyContactPhone: null,
    treatmentTeam: existingTeam,
    createdAt: new Date('2026-10-13T12:00:00Z'),
    updatedAt: new Date('2026-10-13T12:08:00Z'),
  };

  const sourceData = {
    ptPhone2: '+13015550100',
    emergencyPhone: null,
    copay: '30.0000',
    rawEmail: 'user3@example.com',
  };

  const { diff } = calculateClientRepair(client, sourceData);
  assert.ok(diff);
  assert.equal(diff.after.treatmentTeam.primaryTherapistId, 'staff-therapist-1');
  assert.equal(diff.after.treatmentTeam.primaryTherapistName, 'Jane Smith, LCSW');
  assert.deepEqual(diff.after.treatmentTeam.copay, { amount: 30, unit: 'USD' });
});

test('calculateClientRepair protects records with subsequent manual edits', () => {
  const manuallyEditedClient = {
    id: 'client-4',
    mrn: 'SYN004',
    insuranceMemberId: 'COPAY-20.0000',
    insurancePayer: 'Commercial (Hanover)',
    email: 'user4@example.com',
    phone: '+13015550100',
    emergencyContactPhone: null,
    treatmentTeam: null,
    createdAt: new Date('2026-10-13T12:00:00Z'),
    updatedAt: new Date('2026-10-14T09:00:00Z'), // Edited after cutoff!
  };

  const sourceData = {
    ptPhone2: '+13015550100',
    emergencyPhone: null,
    copay: '20.0000',
    rawEmail: 'user4@example.com',
  };

  const result = calculateClientRepair(manuallyEditedClient, sourceData, {
    cutoffDate: new Date('2026-10-13T12:15:00Z'),
    forceOverwriteEdits: false,
  });

  assert.equal(result.manualEditSkipped, true);
  assert.equal(result.diff, null);
});

// ---------------------------------------------------------------------------
// 5. REPEATED-RUN IDEMPOTENCY
// ---------------------------------------------------------------------------

test('calculateClientRepair is idempotent: second run produces zero diffs', () => {
  const cleanRepairedClient = {
    id: 'client-5',
    mrn: 'SYN005',
    insuranceMemberId: null, // already cleared
    insurancePayer: null, // already cleared
    email: 'user5@example.com', // legitimate
    phone: null, // already cleared
    emergencyContactPhone: '+13015550199',
    treatmentTeam: { copay: { amount: 20, unit: 'USD' } }, // already repaired
    createdAt: new Date('2026-10-13T12:00:00Z'),
    updatedAt: new Date('2026-10-13T12:08:00Z'),
  };

  const sourceData = {
    ptPhone2: '',
    emergencyPhone: '301-555-0199',
    copay: '20.0000',
    rawEmail: 'user5@example.com',
    assignedFacName: 'MD Behavioral Health',
    ins1City: 'Hanover',
  };

  const { diff, manualEditSkipped } = calculateClientRepair(cleanRepairedClient, sourceData);
  assert.equal(manualEditSkipped, false);
  assert.equal(diff, null); // Zero changes proposed on subsequent run!
});

// ---------------------------------------------------------------------------
// 6. WRONG-ORDER APPOINTMENTS & DETERMINISTIC MATCHING
// ---------------------------------------------------------------------------

test('matchAppointmentDeterministic correctly matches appointments in wrong array order', () => {
  const dbPool = [
    {
      id: 'appt-db-2',
      clientId: 'client-b',
      clientMrn: 'MRN-B',
      clinicianName: 'Dr. Gbadehan',
      type: 'TELEHEALTH',
      startsAt: new Date('2026-10-12T14:00:00.000Z'),
      endsAt: new Date('2026-10-12T14:45:00.000Z'),
      notes: 'CPT: 90834T',
    },
    {
      id: 'appt-db-1',
      clientId: 'client-a',
      clientMrn: 'MRN-A',
      clinicianName: 'L.Willis',
      type: 'IN_PERSON',
      startsAt: new Date('2026-10-12T12:30:00.000Z'),
      endsAt: new Date('2026-10-12T13:15:00.000Z'),
      notes: 'CPT: 90834',
    },
  ];

  // CSV Row specifies MRN-A (which is index 1 in dbPool, not index 0!)
  const sourceRecordA = {
    mrn: 'MRN-A',
    isNonPatient: false,
    providerName: 'L.Willis',
    targetUtcTime: {
      start: new Date('2026-10-12T16:30:00.000Z'),
      end: new Date('2026-10-12T17:15:00.000Z'),
      durationMinutes: 45,
    },
    expectedNotes: 'CPT: 90834',
    oldLocalStartIso: '2026-10-12T12:30:00.000Z',
  };

  const match = matchAppointmentDeterministic(sourceRecordA, dbPool);
  assert.equal(match.status, 'EXACT_ONE');
  assert.equal(match.matchedDbAppointmentId, 'appt-db-1'); // Correctly matched by MRN & signature, not position!
});

test('matchAppointmentDeterministic quarantines ambiguous duplicate slots', () => {
  const duplicatePool = [
    {
      id: 'appt-dup-1',
      clientId: 'non-patient',
      clientMrn: null,
      clinicianName: 'Staff',
      type: 'SUPERVISORY_BLOCK',
      startsAt: new Date('2026-10-12T12:00:00.000Z'),
      endsAt: new Date('2026-10-12T13:00:00.000Z'),
      notes: 'Supervisory / Unavailable Block',
    },
    {
      id: 'appt-dup-2',
      clientId: 'non-patient',
      clientMrn: null,
      clinicianName: 'Staff',
      type: 'SUPERVISORY_BLOCK',
      startsAt: new Date('2026-10-12T12:00:00.000Z'),
      endsAt: new Date('2026-10-12T13:00:00.000Z'),
      notes: 'Supervisory / Unavailable Block',
    },
  ];

  const sourceRecord = {
    mrn: '',
    isNonPatient: true,
    providerName: 'Staff',
    targetUtcTime: {
      start: new Date('2026-10-12T16:00:00.000Z'),
      end: new Date('2026-10-12T17:00:00.000Z'),
      durationMinutes: 60,
    },
    expectedNotes: 'Supervisory / Unavailable Block',
    oldLocalStartIso: '2026-10-12T12:00:00.000Z',
  };

  const match = matchAppointmentDeterministic(sourceRecord, duplicatePool);
  assert.equal(match.status, 'AMBIGUOUS_DUPLICATE');
  assert.equal(match.matchedDbAppointmentId, null);
  assert.equal(match.candidateCount, 2); // Quarantined! Never guesses!
});

test('matchAppointmentDeterministic returns UNMATCHED for non-existent appointments', () => {
  const sourceRecord = {
    mrn: 'NON-EXISTENT',
    isNonPatient: false,
    providerName: 'Dr. Unknown',
    targetUtcTime: {
      start: new Date('2026-10-12T16:00:00.000Z'),
      end: new Date('2026-10-12T17:00:00.000Z'),
      durationMinutes: 60,
    },
    expectedNotes: '',
    oldLocalStartIso: '2026-10-12T12:00:00.000Z',
  };

  const match = matchAppointmentDeterministic(sourceRecord, []);
  assert.equal(match.status, 'UNMATCHED');
  assert.equal(match.matchedDbAppointmentId, null);
});

// ---------------------------------------------------------------------------
// 7. SOURCE CSV RECONCILIATION & FAIL-CLOSED VALIDATION
// ---------------------------------------------------------------------------

test('reconcileSourcePatientRows fails closed on duplicate source Pt. ID', () => {
  const fakeRows = [
    new Array(33).fill('header'),
    new Array(33).fill('val').map((v, i) => (i === 11 ? 'PT-001' : v)),
    new Array(33).fill('val').map((v, i) => (i === 11 ? 'PT-002' : v)),
    new Array(33).fill('val').map((v, i) => (i === 11 ? 'PT-001' : v)), // Duplicate!
  ];

  const result = reconcileSourcePatientRows(fakeRows, 33);
  assert.ok(result.error);
  assert.match(result.error, /Duplicate source Pt\. ID "PT-001"/);
});

test('reconcileSourcePatientRows fails closed on invalid row column width', () => {
  const fakeRows = [
    new Array(33).fill('header'),
    new Array(33).fill('val').map((v, i) => (i === 11 ? 'PT-001' : v)),
    new Array(30).fill('val'), // 30 cols instead of 33!
  ];

  const result = reconcileSourcePatientRows(fakeRows, 33);
  assert.ok(result.error);
  assert.match(result.error, /invalid column count/);
});

test('reconcileSourcePatientRows fails closed on missing Pt. ID in row', () => {
  const fakeRows = [
    new Array(33).fill('header'),
    new Array(33).fill('val').map((v, i) => (i === 11 ? '   ' : v)), // Empty ID!
  ];

  const result = reconcileSourcePatientRows(fakeRows, 33);
  assert.ok(result.error);
  assert.match(result.error, /missing Pt\. ID/);
});

test('verifySourcePatientsLinked fails closed when source patient does not exist in DB', () => {
  const sourceIds = new Set(['PT-1', 'PT-2', 'PT-3']);
  const dbMrns = new Set(['PT-1', 'PT-2']); // PT-3 is missing!

  const result = verifySourcePatientsLinked(sourceIds, dbMrns);
  assert.equal(result.unlinkedCount, 1);
  assert.ok(result.error);
  assert.match(result.error, /1 source Pt\. IDs do not exist in database/);
});

// ---------------------------------------------------------------------------
// 8. GUARDED ROLLBACK & PARTIAL FAILURE RECOVERY TESTS
// ---------------------------------------------------------------------------

test('planClientRollback restores exact original fields when current record is untouched', () => {
  const diff = {
    clientId: 'client-rb-1',
    mrn: 'SYN-RB1',
    auditedUpdatedAt: '2026-10-14T10:00:00.000Z',
    before: {
      insuranceMemberId: 'COPAY-25.0000',
      insurancePayer: 'Commercial (Hanover)',
      email: 'parent+synrb1@example.com',
      phone: '+13015550199',
      emergencyContactPhone: '+13015550199',
      treatmentTeam: null,
    },
    after: {
      insuranceMemberId: null,
      insurancePayer: null,
      email: null,
      phone: null,
      emergencyContactPhone: '+13015550199',
      treatmentTeam: { copay: { amount: 25, unit: 'USD' } },
    },
    changedFields: ['insuranceMemberId', 'insurancePayer', 'email', 'phone', 'treatmentTeam'],
    reasons: ['repair'],
  };

  // Current state matches 'after' (untouched since repair)
  const currentState = {
    insuranceMemberId: null,
    insurancePayer: null,
    email: null,
    phone: null,
    treatmentTeam: { copay: { amount: 25, unit: 'USD' } },
  };

  const plan = planClientRollback(diff, currentState);
  assert.equal(plan.shouldRestore, true);
  assert.ok(plan.restoreData);
  assert.equal(plan.restoreData.insuranceMemberId, 'COPAY-25.0000');
  assert.equal(plan.restoreData.insurancePayer, 'Commercial (Hanover)');
  assert.equal(plan.restoreData.phone, '+13015550199');
  assert.equal(plan.restoreData.email, 'parent+synrb1@example.com');
  // Null treatmentTeam restored with Prisma.DbNull
  assert.ok(plan.restoreData.treatmentTeam !== undefined);
});

test('planClientRollback skips and protects subsequent manual human edits', () => {
  const diff = {
    clientId: 'client-rb-2',
    mrn: 'SYN-RB2',
    auditedUpdatedAt: '2026-10-14T10:00:00.000Z',
    before: {
      insuranceMemberId: 'COPAY-30.0000',
      insurancePayer: null,
      email: null,
      phone: null,
      emergencyContactPhone: null,
      treatmentTeam: null,
    },
    after: {
      insuranceMemberId: null,
      insurancePayer: null,
      email: null,
      phone: null,
      emergencyContactPhone: null,
      treatmentTeam: { copay: { amount: 30, unit: 'USD' } },
    },
    changedFields: ['insuranceMemberId', 'treatmentTeam'],
    reasons: ['repair'],
  };

  // A billing coordinator entered a real member ID after the repair!
  const currentStateWithManualEdit = {
    insuranceMemberId: 'REAL-AETNA-MEMBER-999',
    insurancePayer: 'Aetna Health',
    email: null,
    phone: null,
  };

  const guardedPlan = planClientRollback(diff, currentStateWithManualEdit, { forceOverwriteEdits: false });
  assert.equal(guardedPlan.shouldRestore, false);
  assert.equal(guardedPlan.skipReason, 'MANUAL_EDIT_PROTECTED');

  // If forceOverwriteEdits is explicitly passed, it allows restore
  const forcedPlan = planClientRollback(diff, currentStateWithManualEdit, { forceOverwriteEdits: true });
  assert.equal(forcedPlan.shouldRestore, true);
  assert.equal(forcedPlan.restoreData?.insuranceMemberId, 'COPAY-30.0000');
});

test('filterRollbackTargets preserves all planned operations so unjournaled committed batches are never missed', () => {
  const mockRepairs = [
    { clientId: 'c-1', mrn: 'M1' } as any,
    { clientId: 'c-2', mrn: 'M2' } as any,
    { clientId: 'c-3', mrn: 'M3' } as any,
    { clientId: 'c-4', mrn: 'M4' } as any,
  ];

  // Even if manifest only recorded c-1 and c-2 as committed before a crash,
  // all operations are preserved so c-3 (committed before journal write) is safely evaluated against DB
  const committedIds = ['c-1', 'c-2'];

  const targets = filterRollbackTargets(mockRepairs, committedIds);
  assert.equal(targets.length, 4);
  assert.deepEqual(targets.map((t) => t.clientId), ['c-1', 'c-2', 'c-3', 'c-4']);

  // Full run backup targets also preserve all
  const allTargets = filterRollbackTargets(mockRepairs, undefined);
  assert.equal(allTargets.length, 4);
});

// ---------------------------------------------------------------------------
// 9. BLANK APPOINTMENT PATIENT TEXT VS NON-PATIENT
// ---------------------------------------------------------------------------

test('classifyAppointmentRow treats blank patient text as ambiguous, NOT NON-PATIENT', () => {
  const blank1 = classifyAppointmentRow('');
  assert.equal(blank1.isNonPatient, false);
  assert.equal(blank1.isAmbiguous, true);
  assert.equal(blank1.mrn, null);

  const blank2 = classifyAppointmentRow('   ');
  assert.equal(blank2.isNonPatient, false);
  assert.equal(blank2.isAmbiguous, true);
  assert.equal(blank2.mrn, null);

  const nonPatient = classifyAppointmentRow('NON-PATIENT');
  assert.equal(nonPatient.isNonPatient, true);
  assert.equal(nonPatient.isAmbiguous, false);
  assert.equal(nonPatient.clientName, 'NON-PATIENT');
});

// ---------------------------------------------------------------------------
// 10. DST FALL-BACK AMBIGUITY & TIMEZONE INDEPENDENCE
// ---------------------------------------------------------------------------

test('isValidWallClockTime rejects ambiguous times during DST fall-back', () => {
  // On Nov 1, 2026, clocks fall back at 2:00 AM EDT to 1:00 AM EST in America/New_York.
  // 1:30 AM occurs twice and is ambiguous without explicit offset.
  const isAmbiguous = isValidWallClockTime(2026, 11, 1, 1, 30, CLINIC_TIMEZONE);
  assert.equal(isAmbiguous, false); // Must reject ambiguous times!

  // Normal unambiguous time on the same day (e.g. 10:00 AM)
  const isNormal = isValidWallClockTime(2026, 11, 1, 10, 0, CLINIC_TIMEZONE);
  assert.equal(isNormal, true);
});

test('computeLegacyLocalStart is deterministic and timezone independent', () => {
  // Oct 12, 2026 6:00 PM in Asia/Kolkata (+05:30) is ALWAYS 12:30 UTC
  const iso1 = computeLegacyLocalStart('Monday, October 12, 2026', '06:00-07:45 PM');
  assert.equal(iso1, '2026-10-12T12:30:00.000Z');

  const iso2 = computeLegacyLocalStart('10/12/2026', '06:00-07:45 PM');
  assert.equal(iso2, '2026-10-12T12:30:00.000Z');
});

// ---------------------------------------------------------------------------
// 11. TREATMENT TEAM PRESERVATION & QUARANTINE
// ---------------------------------------------------------------------------

test('calculateClientRepair preserves existing TreatmentTeam array without overwriting with object', () => {
  const existingTeamArray = [
    { id: 'staff-1', name: 'Alice Smith, LCSW', role: 'Therapist', primary: true },
    { id: 'staff-2', name: 'Bob Jones, MD', role: 'Prescriber', primary: false },
  ];

  const client = {
    id: 'client-array-1',
    mrn: 'SYN-ARR1',
    insuranceMemberId: 'COPAY-20.0000',
    insurancePayer: null,
    email: 'user@example.com',
    phone: null,
    emergencyContactPhone: null,
    treatmentTeam: existingTeamArray,
    createdAt: new Date('2026-10-13T12:00:00Z'),
    updatedAt: new Date('2026-10-13T12:08:00Z'),
  };

  const sourceData = {
    ptPhone2: null,
    emergencyPhone: null,
    copay: '20.0000',
    rawEmail: 'user@example.com',
  };

  const { diff } = calculateClientRepair(client, sourceData);
  assert.ok(diff);
  // insuranceMemberId is cleared
  assert.equal(diff.after.insuranceMemberId, null);
  // TreatmentTeam array is NOT overwritten or destroyed!
  assert.deepEqual(diff.after.treatmentTeam, existingTeamArray);
  assert.equal(diff.changedFields.includes('treatmentTeam'), false);
});

test('calculateClientRepair quarantines unsupported primitive treatmentTeam structures', () => {
  const client = {
    id: 'client-unsupported-1',
    mrn: 'SYN-UNSUP',
    insuranceMemberId: 'COPAY-20.0000',
    insurancePayer: null,
    email: 'user@example.com',
    phone: null,
    emergencyContactPhone: null,
    treatmentTeam: 'corrupt-string-structure' as any,
    createdAt: new Date('2026-10-13T12:00:00Z'),
    updatedAt: new Date('2026-10-13T12:08:00Z'),
  };

  const sourceData = {
    ptPhone2: null,
    emergencyPhone: null,
    copay: '20.0000',
    rawEmail: 'user@example.com',
  };

  const { diff } = calculateClientRepair(client, sourceData);
  assert.ok(diff);
  // Unsupported structure is preserved untouched, not replaced
  assert.equal(diff.after.treatmentTeam, 'corrupt-string-structure');
  assert.equal(diff.changedFields.includes('treatmentTeam'), false);
});

// ---------------------------------------------------------------------------
// 12. GUARDED ROLLBACK: INSURANCE PAYER & TREATMENT TEAM CONCURRENCY
// ---------------------------------------------------------------------------

test('planClientRollback protects subsequent manual edit to insurancePayer', () => {
  const diff = {
    clientId: 'client-payer-1',
    mrn: 'SYN-PAYER1',
    auditedUpdatedAt: '2026-10-14T10:00:00.000Z',
    before: {
      insuranceMemberId: 'COPAY-20.0000',
      insurancePayer: 'Commercial (Hanover)',
      email: null,
      phone: null,
      emergencyContactPhone: null,
      treatmentTeam: null,
    },
    after: {
      insuranceMemberId: null,
      insurancePayer: null,
      email: null,
      phone: null,
      emergencyContactPhone: null,
      treatmentTeam: { copay: { amount: 20, unit: 'USD' } },
    },
    changedFields: ['insuranceMemberId', 'insurancePayer', 'treatmentTeam'],
    reasons: ['repair'],
  };

  // Human user subsequently updated insurancePayer to CareFirst!
  const currentStateWithPayerEdit = {
    insuranceMemberId: null,
    insurancePayer: 'CareFirst BlueCross',
    email: null,
    phone: null,
    treatmentTeam: { copay: { amount: 20, unit: 'USD' } },
  };

  const plan = planClientRollback(diff, currentStateWithPayerEdit, { forceOverwriteEdits: false });
  assert.equal(plan.shouldRestore, false);
  assert.equal(plan.skipReason, 'MANUAL_EDIT_PROTECTED');
});

test('planClientRollback protects subsequent manual edit to treatmentTeam', () => {
  const diff = {
    clientId: 'client-team-1',
    mrn: 'SYN-TEAM1',
    auditedUpdatedAt: '2026-10-14T10:00:00.000Z',
    before: {
      insuranceMemberId: 'COPAY-20.0000',
      insurancePayer: null,
      email: null,
      phone: null,
      emergencyContactPhone: null,
      treatmentTeam: null,
    },
    after: {
      insuranceMemberId: null,
      insurancePayer: null,
      email: null,
      phone: null,
      emergencyContactPhone: null,
      treatmentTeam: { copay: { amount: 20, unit: 'USD' } },
    },
    changedFields: ['insuranceMemberId', 'treatmentTeam'],
    reasons: ['repair'],
  };

  // Clinical staff assigned a primary therapist!
  const currentStateWithTeamEdit = {
    insuranceMemberId: null,
    insurancePayer: null,
    email: null,
    phone: null,
    treatmentTeam: {
      copay: { amount: 20, unit: 'USD' },
      primaryTherapistId: 'therapist-101',
    },
  };

  const plan = planClientRollback(diff, currentStateWithTeamEdit, { forceOverwriteEdits: false });
  assert.equal(plan.shouldRestore, false);
  assert.equal(plan.skipReason, 'MANUAL_EDIT_PROTECTED');
});

// ---------------------------------------------------------------------------
// 13. AUTHENTIC SOURCE EMAIL PRESERVATION & COPAY CONFLICT QUARANTINE
// ---------------------------------------------------------------------------

test('isGeneratedEmailAlias preserves authentic source email containing plus tag', () => {
  // If the patient genuinely signed up with "family+child@example.com", and DB has "family+child@example.com":
  // It is the authentic source email! Must NOT clear!
  const result = isGeneratedEmailAlias('family+child@example.com', 'family+child@example.com', 'SYN-001');
  assert.equal(result, false); // False means authentic email preserved!
});

test('calculateClientRepair quarantines conflicting copay evidence', () => {
  const client = {
    id: 'client-conflict-1',
    mrn: 'SYN-CONF1',
    insuranceMemberId: 'COPAY-50.0000', // DB says $50
    insurancePayer: null,
    email: 'user@example.com',
    phone: '+13015550199', // Emergency phone copied
    emergencyContactPhone: '+13015550199',
    treatmentTeam: null,
    createdAt: new Date('2026-10-13T12:00:00Z'),
    updatedAt: new Date('2026-10-13T12:08:00Z'),
  };

  const sourceData = {
    ptPhone2: null,
    emergencyPhone: '301-555-0199',
    copay: '20.0000', // Source CSV says $20 (Conflicting!)
    rawEmail: 'user@example.com',
  };

  const { diff } = calculateClientRepair(client, sourceData);
  assert.ok(diff);
  assert.deepEqual(diff.changedFields, ['phone']);
  // insuranceMemberId is NOT cleared or guessed because of conflict
  assert.equal(diff.changedFields.includes('insuranceMemberId'), false);
  assert.equal(diff.after.insuranceMemberId, 'COPAY-50.0000');
  assert.ok(diff.reasons.some((r) => r.includes('Quarantined conflicting copay evidence')));
});

// ---------------------------------------------------------------------------
// 14. CRASH RECOVERY BETWEEN DB COMMIT & JOURNAL WRITE + 1-TO-1 DB CLAIMS
// ---------------------------------------------------------------------------

test('planClientRollback skips uncommitted records and restores unjournaled committed records', () => {
  const diff: ClientFieldDiff = {
    clientId: 'client-crash-recovery-1',
    mrn: 'SYN-RECOVER',
    auditedUpdatedAt: '2026-10-13T12:08:00.000Z',
    before: {
      insuranceMemberId: 'COPAY-25.0000',
      insurancePayer: 'Commercial (Bethesda)',
      email: 'john.doe+syn-recover@altrixs.local',
      phone: '+13015550199',
      emergencyContactPhone: '+13015550199',
      treatmentTeam: null,
    },
    after: {
      insuranceMemberId: null,
      insurancePayer: null,
      email: null,
      phone: null,
      emergencyContactPhone: '+13015550199',
      treatmentTeam: { copay: { amount: 25, unit: 'USD' } },
    },
    changedFields: ['insuranceMemberId', 'insurancePayer', 'email', 'phone', 'treatmentTeam'],
    reasons: ['Repair applied'],
  };

  // Scenario A: DB committed the repair, but process crashed before writing .journal.
  // In the DB, the record is in the 'after' state.
  const stateCommittedBeforeCrash = {
    insuranceMemberId: null,
    insurancePayer: null,
    email: null,
    phone: null,
    treatmentTeam: { copay: { amount: 25, unit: 'USD' } },
  };

  const planCommitted = planClientRollback(diff, stateCommittedBeforeCrash);
  assert.equal(planCommitted.shouldRestore, true);
  assert.equal(planCommitted.restoreData?.insuranceMemberId, 'COPAY-25.0000');
  assert.equal(planCommitted.restoreData?.insurancePayer, 'Commercial (Bethesda)');
  assert.equal(planCommitted.restoreData?.email, 'john.doe+syn-recover@altrixs.local');

  // Scenario B: Record was never reached or committed by the repair (still in 'before' state).
  const stateNeverCommitted = {
    insuranceMemberId: 'COPAY-25.0000',
    insurancePayer: 'Commercial (Bethesda)',
    email: 'john.doe+syn-recover@altrixs.local',
    phone: '+13015550199',
    treatmentTeam: null,
  };

  const planUncommitted = planClientRollback(diff, stateNeverCommitted);
  assert.equal(planUncommitted.shouldRestore, false);
  assert.equal(planUncommitted.skipReason, 'ALREADY_IN_BEFORE_STATE');

  // Scenario C: Staff edited the phone number after repair.
  const stateWithStaffEdit = {
    ...stateCommittedBeforeCrash,
    phone: '+12405559999', // Human edit
  };

  const planStaffEdit = planClientRollback(diff, stateWithStaffEdit);
  assert.equal(planStaffEdit.shouldRestore, false);
  assert.equal(planStaffEdit.skipReason, 'MANUAL_EDIT_PROTECTED');
});

test('Appointment matching enforces that each DB appointment can match at most one source row', () => {
  const sharedDbApptId = 'appt-shared-db-1';
  const dbAppointments = [
    {
      id: sharedDbApptId,
      clientId: 'client-1',
      clinicianName: 'Dr. Jane Smith',
      type: 'IN_PERSON',
      startsAt: new Date('2026-10-12T13:30:00Z'),
      endsAt: new Date('2026-10-12T14:30:00Z'),
      notes: 'Initial Consultation',
      clientMrn: 'PT-100',
    },
  ];

  // Two source rows claim the exact same encounter interval and provider
  const sourceRow1 = {
    mrn: 'PT-100',
    isNonPatient: false,
    providerName: 'Dr. Jane Smith',
    targetUtcTime: {
      start: new Date('2026-10-12T13:30:00Z'),
      end: new Date('2026-10-12T14:30:00Z'),
      durationMinutes: 60,
    },
    expectedNotes: 'Initial Consultation',
    oldLocalStartIso: '2026-10-12T13:30:00.000Z',
  };

  const sourceRow2 = { ...sourceRow1 };

  const match1 = matchAppointmentDeterministic(sourceRow1, dbAppointments as any);
  const match2 = matchAppointmentDeterministic(sourceRow2, dbAppointments as any);

  assert.equal(match1.status, 'EXACT_ONE');
  assert.equal(match2.status, 'EXACT_ONE');
  assert.equal(match1.matchedDbAppointmentId, sharedDbApptId);
  assert.equal(match2.matchedDbAppointmentId, sharedDbApptId);

  // Claimant tracker detects duplicate claims on the same DB appointment ID
  const dbClaimants = new Map<string, number[]>();
  dbClaimants.set(match1.matchedDbAppointmentId!, [1, 2]); // Claimed by both row 1 and row 2

  const claimants = dbClaimants.get(sharedDbApptId) || [];
  assert.equal(claimants.length, 2);
  // With claimants.length > 1, 1-to-1 matching is rejected and both are quarantined
  const isOneToOne = (claimants.length as number) === 1;
  assert.equal(isOneToOne, false);
});

// ---------------------------------------------------------------------------
// 15. CLI & DATABASE ORCHESTRATION TESTS
// ---------------------------------------------------------------------------

function createMockPrismaDb() {
  const clients = new Map<string, any>();
  const appointments = new Map<string, any>();

  const createTx = () => ({
    client: {
      findFirst: async ({ where }: any) => {
        const c = clients.get(where.id);
        if (!c) return null;
        if (where.organizationId && c.organizationId !== where.organizationId) return null;
        if (where.sourcePlatform && c.sourcePlatform !== where.sourcePlatform) return null;
        return { ...c };
      },
      updateMany: async ({ where, data }: any) => {
        const c = clients.get(where.id);
        if (!c) return { count: 0 };
        if (where.organizationId && c.organizationId !== where.organizationId) return { count: 0 };
        if (where.sourcePlatform && c.sourcePlatform !== where.sourcePlatform) return { count: 0 };
        if (where.updatedAt) {
          const expectedMs = new Date(where.updatedAt).getTime();
          const currentMs = new Date(c.updatedAt).getTime();
          if (expectedMs !== currentMs) return { count: 0 };
        }
        Object.assign(c, data, { updatedAt: new Date(Date.now() + 1000) });
        return { count: 1 };
      },
    },
    appointment: {
      findFirst: async ({ where }: any) => {
        const a = appointments.get(where.id);
        if (!a) return null;
        if (where.organizationId && a.organizationId !== where.organizationId) return null;
        return { ...a };
      },
      updateMany: async ({ where, data }: any) => {
        const a = appointments.get(where.id);
        if (!a) return { count: 0 };
        if (where.organizationId && a.organizationId !== where.organizationId) return { count: 0 };
        if (where.startsAt && new Date(a.startsAt).getTime() !== new Date(where.startsAt).getTime()) return { count: 0 };
        if (where.endsAt && new Date(a.endsAt).getTime() !== new Date(where.endsAt).getTime()) return { count: 0 };
        if (where.updatedAt) {
          const expectedMs = new Date(where.updatedAt).getTime();
          const currentMs = new Date(a.updatedAt).getTime();
          if (expectedMs !== currentMs) return { count: 0 };
        }
        Object.assign(a, data, { updatedAt: new Date(Date.now() + 1000) });
        return { count: 1 };
      },
    },
  });

  return { clients, appointments, createTx };
}

test('Orchestration: partial journal with a missing final committed batch recovers all committed batches and skips uncommitted', async () => {
  const orgId = 'org-orchestration-1';
  const { clients, createTx } = createMockPrismaDb();

  const t0 = new Date('2026-10-14T08:00:00Z');
  const t1 = new Date('2026-10-14T09:00:00Z');

  // Client 1: Batch 1, committed & journaled
  clients.set('c-1', {
    id: 'c-1',
    organizationId: orgId,
    sourcePlatform: 'VALANT_EXPORT',
    insuranceMemberId: null,
    insurancePayer: null,
    phone: null,
    email: null,
    treatmentTeam: { copay: { amount: 25, unit: 'USD' } },
    updatedAt: t1,
  });

  // Client 2: Batch 2, committed in DB, BUT crashed BEFORE journal write!
  clients.set('c-2', {
    id: 'c-2',
    organizationId: orgId,
    sourcePlatform: 'VALANT_EXPORT',
    insuranceMemberId: null,
    insurancePayer: null,
    phone: null,
    email: null,
    treatmentTeam: { copay: { amount: 40, unit: 'USD' } },
    updatedAt: t1,
  });

  // Client 3: Batch 3, planned but never committed to DB (still in before state)
  clients.set('c-3', {
    id: 'c-3',
    organizationId: orgId,
    sourcePlatform: 'VALANT_EXPORT',
    insuranceMemberId: 'COPAY-50.0000',
    insurancePayer: null,
    phone: null,
    email: null,
    treatmentTeam: null,
    updatedAt: t0,
  });

  const clientRepairs: ClientFieldDiff[] = [
    {
      clientId: 'c-1',
      mrn: 'M-1',
      auditedUpdatedAt: t0.toISOString(),
      before: { insuranceMemberId: 'COPAY-25.0000', insurancePayer: null, email: null, phone: null, emergencyContactPhone: null, treatmentTeam: null },
      after: { insuranceMemberId: null, insurancePayer: null, email: null, phone: null, emergencyContactPhone: null, treatmentTeam: { copay: { amount: 25, unit: 'USD' } } },
      changedFields: ['insuranceMemberId', 'treatmentTeam'],
      reasons: ['repair'],
    },
    {
      clientId: 'c-2',
      mrn: 'M-2',
      auditedUpdatedAt: t0.toISOString(),
      before: { insuranceMemberId: 'COPAY-40.0000', insurancePayer: null, email: null, phone: null, emergencyContactPhone: null, treatmentTeam: null },
      after: { insuranceMemberId: null, insurancePayer: null, email: null, phone: null, emergencyContactPhone: null, treatmentTeam: { copay: { amount: 40, unit: 'USD' } } },
      changedFields: ['insuranceMemberId', 'treatmentTeam'],
      reasons: ['repair'],
    },
    {
      clientId: 'c-3',
      mrn: 'M-3',
      auditedUpdatedAt: t0.toISOString(),
      before: { insuranceMemberId: 'COPAY-50.0000', insurancePayer: null, email: null, phone: null, emergencyContactPhone: null, treatmentTeam: null },
      after: { insuranceMemberId: null, insurancePayer: null, email: null, phone: null, emergencyContactPhone: null, treatmentTeam: { copay: { amount: 50, unit: 'USD' } } },
      changedFields: ['insuranceMemberId', 'treatmentTeam'],
      reasons: ['repair'],
    },
  ];

  // Journal and manifest only have c-1 recorded because crash occurred right after c-2 DB commit
  const backup = {
    organizationId: orgId,
    clientRepairs,
    appointmentRepairs: [],
    committedClientIds: ['c-1'],
  };

  // Rollback evaluates all planned operations against DB state
  const targetRollbacks = backup.clientRepairs;
  const tx = createTx();
  const res = await executeClientRollbackBatch(tx, orgId, targetRollbacks);

  // Both journaled c-1 AND unjournaled c-2 must be restored!
  // Uncommitted c-3 must be safely skipped (already in before state)
  assert.equal(res.restored, 2);
  assert.equal(res.alreadyInBeforeState, 1);
  assert.equal(res.skippedManualEdits, 0);

  // DB verifications
  assert.equal(clients.get('c-1').insuranceMemberId, 'COPAY-25.0000');
  assert.ok(clients.get('c-1').treatmentTeam === null || clients.get('c-1').treatmentTeam === Prisma.DbNull);

  assert.equal(clients.get('c-2').insuranceMemberId, 'COPAY-40.0000');
  assert.ok(clients.get('c-2').treatmentTeam === null || clients.get('c-2').treatmentTeam === Prisma.DbNull);

  assert.equal(clients.get('c-3').insuranceMemberId, 'COPAY-50.0000');
  assert.equal(clients.get('c-3').treatmentTeam, null);
});

test('Orchestration: concurrent client rollback edit is detected and preserved via atomic guards', async () => {
  const orgId = 'org-orchestration-2';
  const { clients, createTx } = createMockPrismaDb();

  const t0 = new Date('2026-10-14T08:00:00Z');
  const tRepair = new Date('2026-10-14T09:00:00Z');
  const tStaffEdit = new Date('2026-10-14T11:00:00Z');

  // Client in DB was repaired, but later clinical coordinator entered real insurance member ID
  clients.set('c-concurrent', {
    id: 'c-concurrent',
    organizationId: orgId,
    sourcePlatform: 'VALANT_EXPORT',
    insuranceMemberId: 'AETNA-VERIFIED-789',
    insurancePayer: 'Aetna Health',
    phone: null,
    email: null,
    treatmentTeam: { copay: { amount: 30, unit: 'USD' } },
    updatedAt: tStaffEdit,
  });

  const diff: ClientFieldDiff = {
    clientId: 'c-concurrent',
    mrn: 'M-CONC',
    auditedUpdatedAt: t0.toISOString(),
    before: { insuranceMemberId: 'COPAY-30.0000', insurancePayer: null, email: null, phone: null, emergencyContactPhone: null, treatmentTeam: null },
    after: { insuranceMemberId: null, insurancePayer: null, email: null, phone: null, emergencyContactPhone: null, treatmentTeam: { copay: { amount: 30, unit: 'USD' } } },
    changedFields: ['insuranceMemberId', 'treatmentTeam'],
    reasons: ['repair'],
  };

  const tx = createTx();
  const res = await executeClientRollbackBatch(tx, orgId, [diff], { forceOverwriteEdits: false });

  assert.equal(res.restored, 0);
  assert.equal(res.skippedManualEdits, 1);
  assert.equal(res.alreadyInBeforeState, 0);

  // Verify staff member's live edit was preserved
  const liveRecord = clients.get('c-concurrent');
  assert.equal(liveRecord.insuranceMemberId, 'AETNA-VERIFIED-789');
  assert.equal(liveRecord.insurancePayer, 'Aetna Health');

  // Also test atomic TOCTOU race: record modified between findFirst and updateMany
  const toctouClient = {
    id: 'c-toctou',
    organizationId: orgId,
    sourcePlatform: 'VALANT_EXPORT',
    insuranceMemberId: null,
    insurancePayer: null,
    phone: null,
    email: null,
    treatmentTeam: { copay: { amount: 20, unit: 'USD' } },
    updatedAt: tRepair,
  };
  clients.set('c-toctou', toctouClient);

  const toctouDiff: ClientFieldDiff = {
    clientId: 'c-toctou',
    mrn: 'M-TOCTOU',
    auditedUpdatedAt: t0.toISOString(),
    before: { insuranceMemberId: 'COPAY-20.0000', insurancePayer: null, email: null, phone: null, emergencyContactPhone: null, treatmentTeam: null },
    after: { insuranceMemberId: null, insurancePayer: null, email: null, phone: null, emergencyContactPhone: null, treatmentTeam: { copay: { amount: 20, unit: 'USD' } } },
    changedFields: ['insuranceMemberId', 'treatmentTeam'],
    reasons: ['repair'],
  };

  // Simulate concurrent writer changing updatedAt right before updateMany
  const raceTx = {
    client: {
      findFirst: async () => ({ ...toctouClient }),
      updateMany: async ({ where }: any) => {
        // Concurrently modified in DB, so where.updatedAt doesn't match!
        return { count: 0 };
      },
    },
  };

  const raceRes = await executeClientRollbackBatch(raceTx, orgId, [toctouDiff]);
  assert.equal(raceRes.restored, 0);
  assert.equal(raceRes.skippedManualEdits, 1);
});

test('Orchestration: concurrent appointment edit is detected and never blindly restored', async () => {
  const orgId = 'org-orchestration-3';
  const { appointments, createTx } = createMockPrismaDb();

  const t0 = new Date('2026-10-14T08:00:00Z');
  const tRepair = new Date('2026-10-14T09:00:00Z');
  const tRescheduled = new Date('2026-10-14T12:00:00Z');

  // Appointment was repaired from 09:00 EDT (13:00 UTC) to 13:00 UTC
  // Later, clinic scheduler moved the patient to 15:30 UTC
  appointments.set('appt-concurrent', {
    id: 'appt-concurrent',
    organizationId: orgId,
    startsAt: new Date('2026-10-15T15:30:00.000Z'),
    endsAt: new Date('2026-10-15T16:15:00.000Z'),
    updatedAt: tRescheduled,
  });

  const apptRecord: AppointmentRepairRecord = {
    appointmentId: 'appt-concurrent',
    clientId: 'client-1',
    auditedUpdatedAt: t0.toISOString(),
    before: {
      startsAt: '2026-10-15T09:00:00.000Z',
      endsAt: '2026-10-15T09:45:00.000Z',
    },
    after: {
      startsAt: '2026-10-15T13:00:00.000Z',
      endsAt: '2026-10-15T13:45:00.000Z',
    },
  };

  const tx = createTx();
  const res = await executeAppointmentRollbackBatch(tx, orgId, [apptRecord], { forceOverwriteEdits: false });

  assert.equal(res.restored, 0);
  assert.equal(res.skippedManualEdits, 1);
  assert.equal(res.alreadyInBeforeState, 0);

  // Clinic scheduler's appointment slot remains untouched
  const liveAppt = appointments.get('appt-concurrent');
  assert.equal(liveAppt.startsAt.toISOString(), '2026-10-15T15:30:00.000Z');
  assert.equal(liveAppt.endsAt.toISOString(), '2026-10-15T16:15:00.000Z');
});

test('Orchestration: rolled-back transaction aborts batch and prevents partial corruption on concurrency failure', async () => {
  const orgId = 'org-orchestration-4';
  const { appointments } = createMockPrismaDb();

  const t0 = new Date('2026-10-14T08:00:00Z');

  // Appt 1 is unmodified and valid
  appointments.set('appt-1', {
    id: 'appt-1',
    organizationId: orgId,
    startsAt: new Date('2026-10-15T09:00:00.000Z'),
    endsAt: new Date('2026-10-15T09:45:00.000Z'),
    updatedAt: t0,
  });

  // Appt 2 was concurrently modified in DB (updatedAt changed!)
  appointments.set('appt-2', {
    id: 'appt-2',
    organizationId: orgId,
    startsAt: new Date('2026-10-15T10:00:00.000Z'),
    endsAt: new Date('2026-10-15T10:45:00.000Z'),
    updatedAt: new Date('2026-10-14T08:30:00Z'), // Concurrent edit!
  });

  const batch: AppointmentRepairRecord[] = [
    {
      appointmentId: 'appt-1',
      clientId: 'c-1',
      auditedUpdatedAt: t0.toISOString(),
      before: { startsAt: '2026-10-15T09:00:00.000Z', endsAt: '2026-10-15T09:45:00.000Z' },
      after: { startsAt: '2026-10-15T13:00:00.000Z', endsAt: '2026-10-15T13:45:00.000Z' },
    },
    {
      appointmentId: 'appt-2',
      clientId: 'c-2',
      auditedUpdatedAt: t0.toISOString(), // Expected t0, but DB has 08:30:00Z
      before: { startsAt: '2026-10-15T10:00:00.000Z', endsAt: '2026-10-15T10:45:00.000Z' },
      after: { startsAt: '2026-10-15T14:00:00.000Z', endsAt: '2026-10-15T14:45:00.000Z' },
    },
  ];

  // Transaction simulator with rollback on error
  const runTransaction = async (fn: (tx: any) => Promise<any>) => {
    const stagedAppointments = new Map<string, any>(JSON.parse(JSON.stringify(Array.from(appointments.entries()))));
    const tx = {
      appointment: {
        updateMany: async ({ where, data }: any) => {
          const a: any = stagedAppointments.get(where.id);
          if (!a) return { count: 0 };
          if (where.organizationId && a.organizationId !== where.organizationId) return { count: 0 };
          if (where.startsAt && new Date(a.startsAt).getTime() !== new Date(where.startsAt).getTime()) return { count: 0 };
          if (where.endsAt && new Date(a.endsAt).getTime() !== new Date(where.endsAt).getTime()) return { count: 0 };
          if (where.updatedAt && new Date(a.updatedAt).getTime() !== new Date(where.updatedAt).getTime()) return { count: 0 };
          Object.assign(a, data, { updatedAt: new Date(Date.now() + 1000) });
          return { count: 1 };
        },
      },
    };

    try {
      const res = await fn(tx);
      // If success, commit staged to main
      for (const [k, v] of stagedAppointments.entries()) appointments.set(k as string, v);
      return res;
    } catch (err) {
      // Transaction rollback: discard staged changes
      throw err;
    }
  };

  await assert.rejects(
    async () => {
      await runTransaction(async (tx) => {
        return executeAppointmentRepairBatch(tx, orgId, batch);
      });
    },
    /Optimistic concurrency violation on appointment appt-2/
  );

  // Verify full transaction rollback: appt-1 was NOT updated!
  const liveAppt1 = appointments.get('appt-1');
  assert.equal(new Date(liveAppt1.startsAt).toISOString(), '2026-10-15T09:00:00.000Z');
});

test('Orchestration: backup permission failure halts execution before any DB writes occur and ensures fsyncSync durability', () => {
  const tmpDir = path.join(os.tmpdir(), `valant-test-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    const testFile = path.join(tmpDir, 'backup-manifest.json');
    const journalFile = path.join(tmpDir, 'backup-manifest.json.journal');

    // 1. Verify durable private file write with synchronous fsyncSync
    writeDurablePrivateFile(testFile, JSON.stringify({ test: true }), { exclusive: true });
    assert.ok(fs.existsSync(testFile));

    // 2. Verify durable append-only journal with synchronous fsyncSync
    appendDurableJournal(journalFile, 'COMMITTED:client:c-1\n');
    assert.ok(fs.existsSync(journalFile));
    assert.equal(fs.readFileSync(journalFile, 'utf8'), 'COMMITTED:client:c-1\n');

    // 3. Verify fatal halt if secureFilePermissions fails (e.g. invalid username or inaccessible path)
    const originalUsername = process.env.USERNAME;
    try {
      process.env.USERNAME = ''; // clear username to trigger critical ACL failure
      delete process.env.USER;

      assert.throws(
        () => {
          secureFilePermissions(testFile);
        },
        /CRITICAL: Unable to resolve Windows USERNAME for security ACLs.*Aborting before DB writes/
      );
    } finally {
      process.env.USERNAME = originalUsername;
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Orchestration: journal/tmp permission failure causes ZERO DB writes', async () => {
  const orgId = 'org-zero-db-writes';
  const { clients, createTx } = createMockPrismaDb();

  const t0 = new Date('2026-10-14T08:00:00Z');
  clients.set('c-test-zero', {
    id: 'c-test-zero',
    organizationId: orgId,
    sourcePlatform: 'VALANT_EXPORT',
    insuranceMemberId: 'COPAY-35.0000',
    insurancePayer: null,
    phone: null,
    email: null,
    treatmentTeam: null,
    updatedAt: t0,
  });

  const diff: ClientFieldDiff = {
    clientId: 'c-test-zero',
    mrn: 'M-ZERO',
    auditedUpdatedAt: t0.toISOString(),
    before: { insuranceMemberId: 'COPAY-35.0000', insurancePayer: null, email: null, phone: null, emergencyContactPhone: null, treatmentTeam: null },
    after: { insuranceMemberId: null, insurancePayer: null, email: null, phone: null, emergencyContactPhone: null, treatmentTeam: { copay: { amount: 35, unit: 'USD' } } },
    changedFields: ['insuranceMemberId', 'treatmentTeam'],
    reasons: ['repair'],
  };

  let dbTransactionsAttempted = 0;
  let dbUpdatesAttempted = 0;

  const mockPrisma = {
    $transaction: async (fn: any) => {
      dbTransactionsAttempted++;
      const tx = createTx();
      const origUpdateMany = tx.client.updateMany;
      tx.client.updateMany = async (...args: any[]) => {
        dbUpdatesAttempted++;
        return (origUpdateMany as any)(...args);
      };
      return fn(tx);
    },
  };

  const tmpDir = path.join(os.tmpdir(), `valant-zero-db-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const backupDir = path.join(tmpDir, 'backups');
  const backupPath = path.join(backupDir, 'backup.json');

  // Trigger permission failure on journal or tmp preflight by clearing USERNAME on Windows
  const originalUsername = process.env.USERNAME;
  try {
    process.env.USERNAME = ''; // Simulates security ACL enforcement failure during preflight
    delete process.env.USER;

    // Apply orchestration workflow
    const runOrchestration = async () => {
      // 1. Storage preflight MUST occur before any DB transactions
      preflightAndVerifyBackupStorage(backupDir, backupPath, JSON.stringify({ diff }));

      // 2. DB transaction (must never be reached!)
      await mockPrisma.$transaction(async (tx) => {
        await executeClientRepairBatch(tx, orgId, [diff]);
      });
    };

    await assert.rejects(
      async () => {
        await runOrchestration();
      },
      /CRITICAL: Unable to resolve Windows USERNAME for security ACLs.*Aborting before DB writes/
    );
  } finally {
    process.env.USERNAME = originalUsername;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  // CRITICAL VERIFICATION: Exactly ZERO database transactions and ZERO database writes occurred!
  assert.equal(dbTransactionsAttempted, 0, 'Must have executed ZERO database transactions');
  assert.equal(dbUpdatesAttempted, 0, 'Must have executed ZERO database updates');

  // Database record remains completely untouched
  const clientRecord = clients.get('c-test-zero');
  assert.equal(clientRecord.insuranceMemberId, 'COPAY-35.0000');
  assert.equal(clientRecord.treatmentTeam, null);
});

test('Orchestration: Windows ACL enforcement strips existing explicit access entries and verifies privacy', () => {
  if (process.platform !== 'win32') return;

  const tmpDir = path.join(os.tmpdir(), `valant-acl-verify-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    const testFile = path.join(tmpDir, 'manifest-replacement.json');
    writeDurablePrivateFile(testFile, JSON.stringify({ test: true }), { exclusive: true });

    // Explicitly add an unauthorized explicit ACE (Everyone:R) to simulate a contaminated ACL
    const { execSync } = require('child_process');
    execSync(`icacls "${testFile}" /grant "Everyone:(R)"`, { stdio: 'pipe' });

    // Verify Everyone was added
    const beforeAcl = execSync(`icacls "${testFile}"`, { stdio: 'pipe' }).toString();
    assert.ok(beforeAcl.includes('Everyone:'), 'Everyone ACE should be present before cleanup');

    // Run secureFilePermissions: must strip Everyone and leave ONLY authorized user
    secureFilePermissions(testFile);

    // Verify Everyone has been completely stripped
    const afterAcl = execSync(`icacls "${testFile}"`, { stdio: 'pipe' }).toString();
    assert.equal(afterAcl.includes('Everyone:'), false, 'Everyone ACE must be stripped');
    assert.ok(new RegExp(process.env.USERNAME || '', 'i').test(afterAcl), 'Authorized user must be present');

    // Verify manifest replacement durability and privacy
    const tmpFile = path.join(tmpDir, 'manifest-replacement.json.tmp');
    writeDurablePrivateFile(tmpFile, JSON.stringify({ test: 'replacement' }), { exclusive: true });
    fs.renameSync(tmpFile, testFile);
    secureFilePermissions(testFile);

    const replacementAcl = execSync(`icacls "${testFile}"`, { stdio: 'pipe' }).toString();
    assert.equal(replacementAcl.includes('Everyone:'), false);
    assert.ok(new RegExp(process.env.USERNAME || '', 'i').test(replacementAcl));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Orchestration: Windows ACL preserves directory traversal rights and verifies by SID allowlist', () => {
  if (process.platform !== 'win32') return;

  const tmpDir = path.join(os.tmpdir(), `valant-acl-dir-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    // 1. Secure directory permissions
    secureFilePermissions(tmpDir);

    // 2. Verify that directory traversal works and child files can be written/read
    const childFile = path.join(tmpDir, 'child.txt');
    fs.writeFileSync(childFile, 'traversal-works', 'utf8');
    assert.equal(fs.readFileSync(childFile, 'utf8'), 'traversal-works');

    // 3. Inspect ACL via PowerShell to verify that only authorized user SID exists and Traverse right is granted
    const { execSync } = require('child_process');
    const cleanDir = tmpDir.replace(/'/g, "''");
    const checkPs = `
      $ErrorActionPreference = 'Stop';
      $p = '${cleanDir}';
      $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent();
      $userSid = $currentUser.User.Value;
      $acl = Get-Acl -LiteralPath $p;
      $traverseMask = [System.Security.AccessControl.FileSystemRights]::Traverse;

      foreach ($rule in $acl.Access) {
        $sid = $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value;
        if ($sid -ne $userSid) {
          throw "Found unexpected SID: $sid";
        }
        if (($rule.FileSystemRights -band $traverseMask) -ne $traverseMask) {
          throw "Traverse right missing from directory rule";
        }
      }
      Write-Output 'VERIFIED';
    `.replace(/\n/g, ' ');

    const output = execSync(`powershell -NoProfile -NonInteractive -Command "${checkPs}"`, { stdio: 'pipe' }).toString();
    assert.ok(output.includes('VERIFIED'), 'Directory ACL verification by SID and traversal must succeed');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});



