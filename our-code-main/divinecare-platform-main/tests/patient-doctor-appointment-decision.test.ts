import assert from 'node:assert/strict';
import { test } from 'node:test';
import Module from 'node:module';

const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load;
loader._load = function (id, ...args) {
  if (id === 'server-only') return {};
  return originalLoad.call(this, id, ...args);
};

test('Patient-Doctor Appointment Request & Decision Workflow', async (t) => {
  const { serializePatientAppointment } = await import('../src/patient/application/appointments/mapper');
  const { mapPatientAppointmentStatus } = await import('../src/patient/domain/appointment-status');
  const baseAppointment = {
    id: 'appt-123',
    clientId: 'client-abc',
    clientName: 'Jane Doe',
    clinicianId: 'doc-xyz',
    clinicianName: 'Dr. Sarah Jenkins',
    organizationId: 'org-1',
    type: 'Individual Therapy',
    startsAt: new Date('2026-10-25T10:00:00.000Z'),
    endsAt: new Date('2026-10-25T10:50:00.000Z'),
    status: 'SCHEDULED' as const,
    noteStatus: 'NOT_STARTED' as const,
    isVirtual: true,
    notes: null,
    patientBooked: true,
    createdVia: null,
    createdById: null,
    createdByName: null,
    lastChangedById: null,
    lastChangedByName: null,
    lastChangedAt: null,
    confirmationCode: null,
    insurancePayer: null,
    memberId: null,
    telehealthPlatform: null,
    joinUrl: null,
    rescheduleRequestedAt: null,
    rescheduleNote: null,
    source: null,
    externalKey: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    clinician: { id: 'doc-xyz', name: 'Dr. Sarah Jenkins' },
  };

  await t.test('1. When patient requests slot, status is pending for the patient app', () => {
    const status = mapPatientAppointmentStatus({
      status: 'SCHEDULED',
      patientBooked: true,
      rescheduleRequestedAt: null,
    });
    assert.equal(status, 'pending');

    const serialized = serializePatientAppointment(baseAppointment);
    assert.equal(serialized.status, 'pending');
    assert.equal(serialized.patientBooked, true);
    assert.equal(serialized.declineReason, null);
  });

  await t.test('2. When doctor confirms (YES), status transitions to confirmed and patientBooked becomes false', () => {
    const confirmedAppt = {
      ...baseAppointment,
      patientBooked: false, // Clinician approved
    };

    const status = mapPatientAppointmentStatus({
      status: 'SCHEDULED',
      patientBooked: false,
      rescheduleRequestedAt: null,
    });
    assert.equal(status, 'confirmed');

    const serialized = serializePatientAppointment(confirmedAppt);
    assert.equal(serialized.status, 'confirmed');
    assert.equal(serialized.patientBooked, false);
    assert.equal(serialized.declineReason, null);
  });

  await t.test('3. When doctor declines (NO with reason message), status becomes cancelled and declineReason is exposed', () => {
    const declineReasonText = 'Doctor is in an emergency psychiatric consultation. Please choose an afternoon slot.';
    const declinedAppt = {
      ...baseAppointment,
      status: 'CANCELLED' as const,
      patientBooked: false,
      rescheduleNote: declineReasonText,
    };

    const status = mapPatientAppointmentStatus({
      status: 'CANCELLED',
      patientBooked: false,
      rescheduleRequestedAt: null,
    });
    assert.equal(status, 'cancelled');

    const serialized = serializePatientAppointment(declinedAppt);
    assert.equal(serialized.status, 'cancelled');
    assert.equal(serialized.declineReason, declineReasonText);
  });
});
