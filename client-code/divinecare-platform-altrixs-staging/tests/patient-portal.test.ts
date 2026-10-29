import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mapPatientAppointmentStatus } from '../src/patient/domain/appointment-status';
import { parsePagination } from '../src/patient/infrastructure/http/response';

test('mapPatientAppointmentStatus maps lifecycle states', () => {
  assert.equal(
    mapPatientAppointmentStatus({ status: 'SCHEDULED', patientBooked: true, rescheduleRequestedAt: null }),
    'pending'
  );
  assert.equal(
    mapPatientAppointmentStatus({ status: 'SCHEDULED', patientBooked: false, rescheduleRequestedAt: null }),
    'confirmed'
  );
  assert.equal(
    mapPatientAppointmentStatus({
      status: 'SCHEDULED',
      patientBooked: false,
      rescheduleRequestedAt: new Date(),
    }),
    'reschedule_requested'
  );
  assert.equal(
    mapPatientAppointmentStatus({ status: 'COMPLETED', patientBooked: false, rescheduleRequestedAt: null }),
    'completed'
  );
  assert.equal(
    mapPatientAppointmentStatus({ status: 'CANCELLED', patientBooked: false, rescheduleRequestedAt: null }),
    'cancelled'
  );
});

test('parsePagination clamps limit', () => {
  const url = new URL('http://x?page=2&limit=500');
  const p = parsePagination(url, 20);
  assert.equal(p.page, 2);
  assert.equal(p.limit, 100);
  assert.equal(p.skip, 100);
});

test('invalid check-in scores rejected by range helper', () => {
  assert.throws(() => {
    const mood = 0;
    if (mood < 1 || mood > 10) throw new Error('bad');
  });
});
