import test from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import {
  appointmentWallTime,
  formatSessionTiming,
  practiceDayRange,
  practiceWeekRange,
  sessionDateValue,
  sessionDateYmd,
} from '../src/lib/telehealth/practiceTiming';
import { appointmentConfirmationSms } from '../src/patient/infrastructure/notifications/templates';
import { formatPracticeTime } from '../src/lib/time/practiceTime';

// Intercept 'server-only' before loading server modules (static imports are hoisted).
const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load;
loader._load = function (id: string, ...args: unknown[]) {
  if (id === 'server-only') return {};
  return originalLoad.call(this, id, ...args);
};
const require = createRequire(import.meta.url);
const { sessionStartAt } = require('../src/lib/telehealth/meeting') as typeof import('../src/lib/telehealth/meeting');
const { formatWhen } = require('../src/lib/telehealth/email') as typeof import('../src/lib/telehealth/email');
const { serializePatientAppointment } = require('../src/patient/application/appointments/mapper') as typeof import('../src/patient/application/appointments/mapper');
const { parseSlot } = require('../src/patient/application/appointments/service') as typeof import('../src/patient/application/appointments/service');

const ET = 'America/New_York';

test('telehealth list: appointment at 13:00Z is 2026-10-19 09:00 on the ET clock', () => {
  assert.deepEqual(appointmentWallTime(new Date('2026-10-19T13:00:00Z'), ET), {
    sessionDate: '2026-10-19',
    startTime: '09:00',
  });
});

test('telehealth list: 01:30Z on Oct 20 is still an Oct 19 evening visit in ET', () => {
  assert.deepEqual(appointmentWallTime(new Date('2026-10-20T01:30:00Z'), ET), {
    sessionDate: '2026-10-19',
    startTime: '21:30',
  });
});

test('telehealth session date column round-trips the practice wall date', () => {
  assert.equal(sessionDateValue('2026-10-19').toISOString(), '2026-10-19T12:00:00.000Z');
  assert.equal(sessionDateYmd(sessionDateValue('2026-10-19')), '2026-10-19');
});

test('practice "today" at 9 PM ET (01:00Z next UTC day) is the ET date, with ET-midnight bounds', () => {
  const r = practiceDayRange(ET, new Date('2026-10-20T01:00:00Z'));
  assert.equal(r.today, '2026-10-19');
  assert.equal(r.apptStart.toISOString(), '2026-10-19T04:00:00.000Z');
  assert.equal(r.apptEnd.toISOString(), '2026-10-20T03:59:59.999Z');
  assert.equal(r.sessionStart.toISOString(), '2026-10-19T00:00:00.000Z');
  assert.equal(r.sessionEnd.toISOString(), '2026-10-19T23:59:59.999Z');
});

test('practice week is Monday..Sunday on the ET clock, across the Nov 1 DST change', () => {
  // Thu Oct 29 2026, 10 PM ET
  const w = practiceWeekRange(ET, new Date('2026-10-30T02:00:00Z'));
  assert.equal(w.apptStart.toISOString(), '2026-10-26T04:00:00.000Z'); // Mon 00:00 EDT
  assert.equal(w.apptEnd.toISOString(), '2026-11-02T04:59:59.999Z'); // Sun 23:59:59.999 EST
  assert.equal(w.sessionStart.toISOString(), '2026-10-26T00:00:00.000Z');
  assert.equal(w.sessionEnd.toISOString(), '2026-11-01T23:59:59.999Z');
});

test('sessionStartAt reads date + HH:mm on the practice clock (Zoom / Meet start time)', () => {
  assert.equal(sessionStartAt('2026-10-19', '09:00', ET).toISOString(), '2026-10-19T13:00:00.000Z');
  assert.equal(sessionStartAt('2026-12-01', '09:00', ET).toISOString(), '2026-12-01T14:00:00.000Z');
  assert.throws(() => sessionStartAt('2026-10-19', 'bad', ET));
});

test('push/SMS timing: "Today" uses the ET date, time carries the zone label', () => {
  const now = new Date('2026-10-20T01:00:00Z'); // Oct 19, 9 PM ET
  assert.deepEqual(formatSessionTiming('2026-10-19', '21:30', ET, now), {
    formattedDate: 'Today',
    formattedTime: '9:30 PM ET',
    isToday: true,
  });
  assert.deepEqual(formatSessionTiming('2026-10-20', '09:00', ET, now), {
    formattedDate: 'Oct 20, 2026',
    formattedTime: '9:00 AM ET',
    isToday: false,
  });
});

test('telehealth join email: practice wall date/time printed as is, with ET', () => {
  assert.equal(formatWhen('2026-10-19', '09:00', ET), 'Monday, October 19, 2026 at 9:00 AM ET');
});

test('24h reminder text: 13:00Z renders 9:00 AM ET', () => {
  assert.equal(formatPracticeTime(new Date('2026-10-19T13:00:00Z'), ET, { withZone: true }), '9:00 AM ET');
});

test('patient app mapper: date/startTime/endTime on the ET clock, not the UTC server clock', () => {
  const row = {
    id: 'a1',
    organizationId: 'org1',
    clientId: 'c1',
    clinicianId: 'u1',
    clinicianName: 'Dr. Example',
    type: 'Individual Therapy',
    startsAt: new Date('2026-10-19T13:00:00Z'),
    endsAt: new Date('2026-10-19T13:50:00Z'),
    status: 'SCHEDULED',
    isVirtual: false,
    notes: null,
    patientBooked: false,
    rescheduleRequestedAt: null,
    clinician: { id: 'u1', name: 'Dr. Example' },
  } as unknown as Parameters<typeof serializePatientAppointment>[0];
  const out = serializePatientAppointment(row, ET);
  assert.equal(out.date, '2026-10-19');
  assert.equal(out.startTime, '09:00');
  assert.equal(out.endTime, '09:50');
  assert.equal(out.startsAt, '2026-10-19T13:00:00.000Z');
  assert.equal(out.timeZone, ET);
  assert.equal(out.timeZoneLabel, 'ET');
});

test('patient booking: "2026-10-19" + "09:00" from the app is stored as 13:00Z (9 AM ET)', () => {
  const { start, end } = parseSlot('2099-10-19', '09:00', '09:50', ET);
  assert.equal(start.toISOString(), '2099-10-19T13:00:00.000Z');
  assert.equal(end.toISOString(), '2099-10-19T13:50:00.000Z');
  const noEnd = parseSlot('2099-12-01', '09:00', null, ET);
  assert.equal(noEnd.start.toISOString(), '2099-12-01T14:00:00.000Z');
  assert.equal(noEnd.end.toISOString(), '2099-12-01T14:50:00.000Z');
  assert.throws(() => parseSlot('2099-10-19', '25:00', null, ET));
});

test('appointment confirmation SMS labels the practice zone', () => {
  const sms = appointmentConfirmationSms({ date: '2026-10-19', startTime: '09:00', endTime: '09:50' });
  assert.ok(sms.includes('2026-10-19 09:00–09:50 ET'), sms);
});
