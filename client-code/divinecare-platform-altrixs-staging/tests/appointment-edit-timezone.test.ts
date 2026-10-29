import assert from 'node:assert/strict';
import { test } from 'node:test';
import Module, { createRequire } from 'node:module';
import {
  formatPracticeDate,
  formatPracticeDateTime,
  formatPracticeTime,
  fromPracticeWallTime,
  parseAppointmentDateTime,
  practiceToday,
  practiceZoneLabel,
  toPracticeWallTime,
  zonedWallTimeToUtc,
} from '../src/lib/time/practiceTime';
import { generateBookingSlots, practiceDayBounds, weekdayKey } from '../src/lib/scheduling/slots';
import {
  buildAppointmentEditPatch,
  formInstants,
  formValuesFromAppointment,
  saveAppointmentForm,
  type AppointmentFormApi,
} from '../src/features/appointments/appointmentForm';
import { duplicateAppointmentWhere } from '../src/lib/appointments/duplicates';
import { reinterpretUtcWallAsPractice } from '../scripts/fix-appointment-timezone';
import type { Appointment } from '../src/features/appointments/types';

const ET = 'America/New_York';
const iso = (d: Date | null) => d?.toISOString() ?? null;

// ─── Practice wall time <-> UTC ─────────────────────────────────────────────

test('wall time -> UTC uses the practice zone, not the server zone (owner case: 9:44 AM ET)', () => {
  // The bug stored 09:44 UTC (= 5:44 AM ET). 9:44 AM EDT is 13:44 UTC.
  assert.equal(iso(fromPracticeWallTime('2026-10-19', '09:44', ET)), '2026-10-19T13:44:00.000Z');
  assert.deepEqual(toPracticeWallTime(new Date('2026-10-19T09:44:00Z'), ET), { date: '2026-10-19', time: '05:44' });
  assert.deepEqual(toPracticeWallTime(new Date('2026-10-19T13:44:00Z'), ET), { date: '2026-10-19', time: '09:44' });
});

test('DST fall-back Nov 1 2026: offsets before/after and the repeated 1:30 AM', () => {
  assert.equal(iso(fromPracticeWallTime('2026-10-31', '09:00', ET)), '2026-10-31T13:00:00.000Z'); // EDT
  assert.equal(iso(fromPracticeWallTime('2026-11-01', '09:00', ET)), '2026-11-01T14:00:00.000Z'); // EST
  assert.equal(iso(fromPracticeWallTime('2026-11-02', '09:00', ET)), '2026-11-02T14:00:00.000Z');
  // 1:30 AM happens twice; the first (EDT) occurrence is used
  assert.equal(iso(fromPracticeWallTime('2026-11-01', '01:30', ET)), '2026-11-01T05:30:00.000Z');
  assert.equal(iso(fromPracticeWallTime('2026-11-01', '00:30', ET)), '2026-11-01T04:30:00.000Z');
  assert.equal(iso(fromPracticeWallTime('2026-11-01', '03:00', ET)), '2026-11-01T08:00:00.000Z');
});

test('DST spring-forward Mar 14 2027: offsets before/after and the skipped 2:30 AM', () => {
  assert.equal(iso(fromPracticeWallTime('2027-03-13', '09:00', ET)), '2027-03-13T14:00:00.000Z'); // EST
  assert.equal(iso(fromPracticeWallTime('2027-03-14', '09:00', ET)), '2027-03-14T13:00:00.000Z'); // EDT
  assert.equal(iso(fromPracticeWallTime('2027-03-14', '01:30', ET)), '2027-03-14T06:30:00.000Z');
  assert.equal(iso(fromPracticeWallTime('2027-03-14', '03:30', ET)), '2027-03-14T07:30:00.000Z');
  // 2:30 AM does not exist; it moves forward by the gap to 3:30 AM EDT
  assert.equal(iso(fromPracticeWallTime('2027-03-14', '02:30', ET)), '2027-03-14T07:30:00.000Z');
  // round trip every half hour across both change days
  for (const day of ['2026-11-01', '2027-03-14']) {
    for (let m = 0; m < 24 * 60; m += 30) {
      const hhmm = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      if (day === '2027-03-14' && hhmm.startsWith('02:')) continue;
      const back = toPracticeWallTime(fromPracticeWallTime(day, hhmm, ET)!, ET);
      assert.deepEqual(back, { date: day, time: hhmm }, `${day} ${hhmm}`);
    }
  }
});

test('zonedWallTimeToUtc works for other US zones', () => {
  assert.equal(zonedWallTimeToUtc(2026, 7, 1, 9, 0, 'America/Los_Angeles').toISOString(), '2026-07-01T16:00:00.000Z');
  assert.equal(zonedWallTimeToUtc(2026, 12, 1, 9, 0, 'America/Chicago').toISOString(), '2026-12-01T15:00:00.000Z');
  assert.equal(zonedWallTimeToUtc(2026, 7, 1, 9, 0, 'America/Phoenix').toISOString(), '2026-07-01T16:00:00.000Z');
});

test('malformed wall times are rejected', () => {
  assert.equal(fromPracticeWallTime('2026-02-31', '09:00', ET), null);
  assert.equal(fromPracticeWallTime('2026-10-19', '25:00', ET), null);
  assert.equal(fromPracticeWallTime('10/19/2026', '09:00', ET), null);
});

test('naive datetimes are practice time; offset datetimes are kept as instants', () => {
  assert.deepEqual(parseAppointmentDateTime('2026-10-19T09:44', ET), { at: new Date('2026-10-19T13:44:00Z'), naive: true });
  assert.deepEqual(parseAppointmentDateTime('2026-10-19 09:44:00', ET), { at: new Date('2026-10-19T13:44:00Z'), naive: true });
  assert.deepEqual(parseAppointmentDateTime('2026-10-19T13:44:00.000Z', ET), { at: new Date('2026-10-19T13:44:00Z'), naive: false });
  assert.deepEqual(parseAppointmentDateTime('2026-10-19T09:44:00-04:00', ET), { at: new Date('2026-10-19T13:44:00Z'), naive: false });
  assert.equal(parseAppointmentDateTime('not a date', ET), null);
  assert.equal(parseAppointmentDateTime('', ET), null);
});

test('display formatting is on the practice clock regardless of the process zone', () => {
  const at = new Date('2026-10-19T13:44:00Z');
  assert.equal(formatPracticeTime(at, ET), '9:44 AM');
  assert.equal(formatPracticeTime(at, ET, { withZone: true }), '9:44 AM ET');
  assert.equal(formatPracticeDate(at, ET), 'Mon, Oct 19, 2026');
  assert.equal(formatPracticeDateTime(at, ET), 'Mon, Oct 19, 2026, 9:44 AM ET');
  // 10:30 PM ET on Oct 19 is already Oct 20 in UTC
  assert.equal(toPracticeWallTime(new Date('2026-10-20T02:30:00Z'), ET).date, '2026-10-19');
  assert.equal(practiceToday(ET, new Date('2026-10-20T02:30:00Z')), '2026-10-19');
  assert.equal(practiceZoneLabel(ET), 'ET');
  // Imported Valant visit stored 13:00 UTC is 9:00 AM, not 1:00 PM
  assert.equal(formatPracticeTime('2026-10-19T13:00:00.000Z', ET), '9:00 AM');
});

// ─── Online booking slots ────────────────────────────────────────────────────

test('booking slots follow practice business hours (9-5 ET), across the fall-back change', () => {
  const hours = { mon: { enabled: true, start: '09:00', end: '17:00' }, sun: { enabled: true, start: '09:00', end: '11:00' } };
  const base = {
    timeZone: ET,
    hours,
    durationMin: 60,
    bufferMinutes: 0,
    minNoticeDays: 0,
    bookAheadDays: 60,
    booked: [],
    now: new Date('2026-10-01T00:00:00Z'),
  };
  const mon = generateBookingSlots({ ...base, from: new Date('2026-10-19T04:00:00Z'), to: new Date('2026-10-20T03:59:59Z') });
  assert.equal(mon.length, 8);
  assert.equal(mon[0].startsAt, '2026-10-19T13:00:00.000Z'); // 9:00 AM EDT
  assert.equal(mon[7].endsAt, '2026-10-19T21:00:00.000Z'); // 5:00 PM EDT
  // Sunday Nov 1 (fall-back day): 9 AM EST = 14:00 UTC
  const sun = generateBookingSlots({ ...base, from: new Date('2026-11-01T04:00:00Z'), to: new Date('2026-11-02T04:59:59Z') });
  assert.deepEqual(sun.map((s) => s.startsAt), ['2026-11-01T14:00:00.000Z', '2026-11-01T15:00:00.000Z']);
  // booked 10-11 AM ET is removed
  const busy = generateBookingSlots({
    ...base,
    from: new Date('2026-10-19T04:00:00Z'),
    to: new Date('2026-10-20T03:59:59Z'),
    booked: [{ startsAt: new Date('2026-10-19T14:00:00Z'), endsAt: new Date('2026-10-19T15:00:00Z'), clinicianId: null }],
  });
  assert.ok(!busy.some((s) => s.startsAt === '2026-10-19T14:00:00.000Z'));
  assert.equal(busy.length, 7);
  assert.equal(weekdayKey('2026-11-01'), 'sun');
  assert.deepEqual(
    Object.values(practiceDayBounds('2026-11-01', ET)!).map((d) => d.toISOString()),
    ['2026-11-01T04:00:00.000Z', '2026-11-02T05:00:00.000Z'] // 25-hour day
  );
});

// ─── Edit form: update, never create ─────────────────────────────────────────

const appt: Appointment = {
  id: 'appt_1',
  clientId: 'client_1',
  clientName: 'Test',
  clinicianId: 'clin_1',
  clinicianName: 'Dr A',
  type: 'Individual Therapy',
  date: '2026-10-19',
  startTime: '09:00',
  endTime: '09:50',
  startsAt: '2026-10-19T13:00:00.000Z',
  endsAt: '2026-10-19T13:50:00.000Z',
  timeZone: ET,
  status: 'scheduled',
  noteStatus: 'not-started',
  isVirtual: false,
  videoProvider: null,
  notes: 'bring forms',
  labelId: null,
};

function fakeApi() {
  const calls: { create: unknown[]; update: [string, unknown][]; setLabel: [string, string | null][] } = {
    create: [],
    update: [],
    setLabel: [],
  };
  const api: AppointmentFormApi = {
    create: async (input) => {
      calls.create.push(input);
      return { ...appt, id: 'new' };
    },
    update: async (id, patch) => {
      calls.update.push([id, patch]);
      return { ...appt, ...(patch as object) };
    },
    setLabel: async (id, labelId) => {
      calls.setLabel.push([id, labelId]);
      return { ...appt, labelId };
    },
  };
  return { api, calls };
}

test('edit mode saves through update (bound to the id) and never calls create', async () => {
  const { api, calls } = fakeApi();
  const values = { ...formValuesFromAppointment(appt), startTime: '10:00', endTime: '10:50', labelId: 'lbl_blue' };
  const res = await saveAppointmentForm({ kind: 'edit', appointment: appt }, values, api, ET);
  assert.equal(res.kind, 'updated');
  assert.equal(calls.create.length, 0);
  assert.equal(calls.update.length, 1);
  assert.equal(calls.update[0][0], 'appt_1');
  assert.deepEqual(calls.update[0][1], { startsAt: '2026-10-19T14:00:00.000Z', endsAt: '2026-10-19T14:50:00.000Z' });
  assert.deepEqual(calls.setLabel, [['appt_1', 'lbl_blue']]);
});

test('edit with nothing changed sends nothing; only changed fields are patched', async () => {
  const { api, calls } = fakeApi();
  const res = await saveAppointmentForm({ kind: 'edit', appointment: appt }, formValuesFromAppointment(appt), api, ET);
  assert.deepEqual(res, { kind: 'updated', appointment: appt, changed: false });
  assert.equal(calls.create.length + calls.update.length + calls.setLabel.length, 0);
  const patch = buildAppointmentEditPatch(appt, { ...formValuesFromAppointment(appt), notes: '  ', clinicianId: 'clin_2' });
  assert.deepEqual(patch, { clinicianId: 'clin_2', notes: null });
});

test('create mode sends explicit UTC instants computed on the practice clock', async () => {
  const { api, calls } = fakeApi();
  const values = { ...formValuesFromAppointment(appt), date: '2026-11-02', startTime: '09:44', endTime: '' };
  await saveAppointmentForm({ kind: 'create' }, values, api, ET);
  assert.equal(calls.update.length, 0);
  const sent = calls.create[0] as Record<string, unknown>;
  assert.equal(sent.startsAt, '2026-11-02T14:44:00.000Z'); // EST after fall-back
  assert.equal(sent.endsAt, '2026-11-02T15:34:00.000Z'); // 50 min default
  assert.equal(sent.date, undefined);
  assert.deepEqual(formInstants({ date: '2026-10-19', startTime: '09:44', endTime: '10:34' }, ET), {
    startsAt: '2026-10-19T13:44:00.000Z',
    endsAt: '2026-10-19T14:34:00.000Z',
  });
});

test('duplicate filter: same org + client + clinician + start, not cancelled, excluding self', () => {
  const where = duplicateAppointmentWhere({
    organizationId: 'org_1',
    clientId: 'c',
    clinicianId: 'u',
    startsAt: new Date('2026-10-19T13:00:00Z'),
    excludeId: 'appt_1',
  }) as { AND: Record<string, unknown>[] };
  assert.equal(where.AND.length, 3);
  assert.deepEqual(where.AND[1], {
    clientId: 'c',
    clinicianId: 'u',
    startsAt: new Date('2026-10-19T13:00:00Z'),
    status: { notIn: ['CANCELLED', 'LATE_CANCEL'] },
  });
  assert.deepEqual(where.AND[2], { id: { not: 'appt_1' } });
  const noSelf = duplicateAppointmentWhere({ organizationId: 'o', clientId: 'c', clinicianId: 'u', startsAt: new Date() }) as {
    AND: unknown[];
  };
  assert.equal(noSelf.AND.length, 2);
});

test('repair script reads the stored UTC wall clock as practice time', () => {
  assert.equal(iso(reinterpretUtcWallAsPractice(new Date('2026-10-19T09:44:00Z'), ET)), '2026-10-19T13:44:00.000Z');
  assert.equal(iso(reinterpretUtcWallAsPractice(new Date('2026-12-01T09:00:00Z'), ET)), '2026-12-01T14:00:00.000Z');
});

// ─── Server: createAppointment / updateAppointment / POST route with a fake database ─

type Row = {
  id: string;
  organizationId: string;
  clientId: string;
  clientName: string;
  clinicianId: string;
  clinicianName: string;
  type: string;
  startsAt: Date;
  endsAt: Date;
  status: string;
  noteStatus: string;
  isVirtual: boolean;
  notes: string | null;
  createdAt: Date;
  client: { name: string; image: null; assignedToId: string };
  clinician: { name: string };
};

function matches(row: Row, where: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (k === 'AND') {
      if (!(v as Record<string, unknown>[]).every((w) => matches(row, w))) return false;
    } else if (k === 'OR') {
      // org scoping: fake rows all belong to org_1
      continue;
    } else if (k === 'id' && v && typeof v === 'object' && 'not' in (v as object)) {
      if (row.id === (v as { not: string }).not) return false;
    } else if (k === 'status' && v && typeof v === 'object') {
      if (((v as { notIn: string[] }).notIn || []).includes(row.status)) return false;
    } else if (k === 'startsAt' && v instanceof Date) {
      if (row.startsAt.getTime() !== v.getTime()) return false;
    } else if (typeof v !== 'object' || v === null) {
      if ((row as Record<string, unknown>)[k] !== v) return false;
    }
  }
  return true;
}

/** Overlap queries (findMany): clinician + status.notIn + startsAt.lt / endsAt.gt + id.notIn. */
function overlapMatches(row: Row, where: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (k === 'AND') {
      if (!(v as Record<string, unknown>[]).every((w) => overlapMatches(row, w))) return false;
    } else if (k === 'OR') {
      continue;
    } else if (k === 'status' && v && typeof v === 'object') {
      if (((v as { notIn: string[] }).notIn || []).includes(row.status)) return false;
    } else if (k === 'startsAt' && v && typeof v === 'object' && 'lt' in (v as object)) {
      if (!(row.startsAt < (v as { lt: Date }).lt)) return false;
    } else if (k === 'endsAt' && v && typeof v === 'object' && 'gt' in (v as object)) {
      if (!(row.endsAt > (v as { gt: Date }).gt)) return false;
    } else if (k === 'id' && v && typeof v === 'object' && 'notIn' in (v as object)) {
      if ((v as { notIn: string[] }).notIn.includes(row.id)) return false;
    } else if (typeof v !== 'object' || v === null) {
      if ((row as Record<string, unknown>)[k] !== v) return false;
    }
  }
  return true;
}

function loadServer() {
  const rows: Row[] = [];
  const dupQueries: Record<string, unknown>[] = [];
  let seq = 0;
  const appointment = {
    findFirst: async ({ where }: { where: Record<string, unknown> }) => {
      const isDup = JSON.stringify(where).includes('notIn');
      if (isDup) dupQueries.push(where);
      return rows.filter((r) => matches(r, where)).sort((a, b) => +a.createdAt - +b.createdAt)[0] ?? null;
    },
    findUniqueOrThrow: async ({ where }: { where: { id: string } }) => rows.find((r) => r.id === where.id)!,
    findMany: async ({ where }: { where: Record<string, unknown> }) => rows.filter((r) => overlapMatches(r, where)),
    create: async ({ data }: { data: Partial<Row> }) => {
      const row = {
        ...data,
        id: `appt_${++seq}`,
        createdAt: new Date(Date.now() + seq),
        client: { name: 'Pat', image: null, assignedToId: 'u1' },
        clinician: { name: 'Dr A' },
      } as Row;
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
      const row = rows.find((r) => r.id === where.id)!;
      Object.assign(row, data);
      return row;
    },
  };
  const db = {
    client: {
      findFirst: async () => ({ id: 'c1', name: 'Pat', assignedToId: 'u1', status: 'ACTIVE', email: null, phone: null }),
    },
    user: { findFirst: async ({ where }: { where: { id: string } }) => ({ id: where.id, name: 'Dr ' + where.id }) },
    appointment,
    appointmentLabel: { findFirst: async () => null },
    practiceSettings: { findUnique: async () => null },
    $executeRaw: async () => 0,
    $transaction: async (fn: (tx: unknown) => unknown) => fn({ appointment, $executeRaw: async () => 0 }),
  };
  const audits: unknown[] = [];
  const gate = { ok: true, userId: 'u_admin', role: 'ADMIN', organizationId: 'org_1' };
  const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
  const originalLoad = loader._load;
  loader._load = function (id, ...args) {
    if (id === 'server-only') return {};
    if (id === '@/lib/db/prisma' || id === '@/lib/db') return { prisma: db };
    if (id === '@/lib/auth/tenant') return { requireOrgContext: async () => gate };
    if (id === '@/lib/time/practiceTimeServer') return { getPracticeTimeZone: async () => ET };
    if (id === '@/lib/audit/requestMeta')
      return { auditPhiAccess: async (a: unknown) => void audits.push(a), auditRequestMeta: () => ({}) };
    if (id === '@/patient') return { sendAppointmentCreatedEmail: async () => {}, sendAppointmentCreatedSms: async () => {} };
    if (id === '@/lib/notifications/pushService') return { sendToUser: async () => {} };
    if (id === '@/lib/telehealth/meeting') return { provisionTelehealthMeeting: async () => ({ roomId: 'r', joinUrl: 'j', hostUrl: 'h' }) };
    if (id === '@/app/api/drfirst/_lib/officeVisit') return { sendCompletedVisitToRcopia: async () => {} };
    if (id === '@/lib/scheduling/appointmentLabelsServer')
      return {
        autoApplySuggestedLabel: async () => null,
        writeAppointmentLabelId: async () => ({ ok: true }),
        withLabelFields: async (_o: string, _r: unknown[], dtos: object[]) =>
          dtos.map((d) => ({ ...d, labelId: null, label: null, suggestedLabelMeaning: null })),
      };
    return originalLoad.call(this, id, ...args);
  };
  const require = createRequire(import.meta.url);
  try {
    const manage = require('../src/lib/appointments/manage') as typeof import('../src/lib/appointments/manage');
    const route = require('../src/app/api/appointments/route') as { POST: (r: Request) => Promise<Response> };
    const idRoute = require('../src/app/api/appointments/[id]/route') as {
      PATCH: (r: Request, c: { params: Promise<{ id: string }> }) => Promise<Response>;
    };
    return { manage, route, idRoute, rows, dupQueries, audits };
  } finally {
    loader._load = originalLoad;
  }
}

const server = loadServer();
const post = (body: unknown) =>
  server.route.POST(
    new Request('http://localhost/api/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
const patch = (id: string, body: unknown) =>
  server.idRoute.PATCH(
    new Request(`http://localhost/api/appointments/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) }
  );

test('POST: a naive date + time is stored as practice time (9:44 AM ET = 13:44 UTC)', async () => {
  const res = await post({ clientId: 'c1', clinicianId: 'u1', type: 'Individual Therapy', date: '2026-10-19', startTime: '09:44' });
  assert.equal(res.status, 201);
  const json = await res.json();
  assert.equal(json.appointment.startsAt, '2026-10-19T13:44:00.000Z');
  assert.equal(json.appointment.startTime, '09:44');
  assert.equal(json.appointment.date, '2026-10-19');
  assert.equal(json.appointment.timeZone, ET);
});

test('POST: duplicate client + clinician + start answers 409 with the existing id; nothing is booked', async () => {
  const before = server.rows.length;
  const body = { clientId: 'c1', clinicianId: 'u1', type: 'Individual Therapy', startsAt: '2026-10-19T13:44:00.000Z' };
  const res = await post(body);
  assert.equal(res.status, 409);
  const json = await res.json();
  assert.equal(json.code, 'DUPLICATE_APPOINTMENT');
  assert.equal(json.existingAppointmentId, server.rows[0].id);
  assert.equal(server.rows.length, before);
});

test('POST: allowDuplicate books the same slot on purpose; a cancelled slot can be rebooked', async () => {
  const before = server.rows.length;
  const res = await post({ clientId: 'c1', clinicianId: 'u1', type: 'Group Therapy', startsAt: '2026-10-19T13:44:00.000Z', allowDuplicate: true });
  assert.equal(res.status, 201);
  assert.equal(server.rows.length, before + 1);

  const other = await post({ clientId: 'c1', clinicianId: 'u1', type: 'Individual Therapy', startsAt: '2026-10-20T13:00:00.000Z' });
  assert.equal(other.status, 201);
  const id = (await other.json()).appointment.id as string;
  server.rows.find((r) => r.id === id)!.status = 'CANCELLED';
  const rebook = await post({ clientId: 'c1', clinicianId: 'u1', type: 'Individual Therapy', startsAt: '2026-10-20T13:00:00.000Z' });
  assert.equal(rebook.status, 201);
});

test('PATCH reschedule: overlap/duplicate check excludes the appointment itself', async () => {
  const res = await post({ clientId: 'c1', clinicianId: 'u1', type: 'Individual Therapy', startsAt: '2026-10-21T13:00:00.000Z' });
  const id = (await res.json()).appointment.id as string;
  server.dupQueries.length = 0;

  // Move it 1 hour: the only row at the old time is itself; the check must exclude self
  const moved = await patch(id, { startsAt: '2026-10-21T14:00:00.000Z', endsAt: '2026-10-21T14:50:00.000Z' });
  assert.equal(moved.status, 200);
  const movedJson = await moved.json();
  assert.equal(movedJson.appointment.startsAt, '2026-10-21T14:00:00.000Z');
  assert.equal(movedJson.appointment.startTime, '10:00');
  assert.equal(server.dupQueries.length, 1);
  assert.match(JSON.stringify(server.dupQueries[0]), new RegExp(`"not":"${id}"`));

  // Notes-only edit: no duplicate query at all, telehealth-free notes saved
  server.dupQueries.length = 0;
  const notes = await patch(id, { notes: 'arrive early' });
  assert.equal(notes.status, 200);
  assert.equal(server.dupQueries.length, 0);

  // Moving onto another live appointment of the same client + clinician is a 409
  const clash = await patch(id, { startsAt: '2026-10-19T13:44:00.000Z', endsAt: '2026-10-19T14:34:00.000Z' });
  assert.equal(clash.status, 409);
  assert.equal((await clash.json()).existingAppointmentId, server.rows[0].id);

  // The edit is audited with field names only
  const audit = server.audits.find(
    (a) => (a as { action: string; resourceId: string }).action === 'UPDATE' && (a as { resourceId: string }).resourceId === id
  ) as { metadata: { fields: string[] } };
  assert.deepEqual(audit.metadata.fields, ['startsAt', 'endsAt']);
});

test('PATCH: completed visits cannot be rescheduled; notes keep the hidden telehealth block', async () => {
  const res = await post({ clientId: 'c1', clinicianId: 'u1', type: 'Individual Therapy', startsAt: '2026-10-22T13:00:00.000Z', isVirtual: true, videoProvider: 'in_app' });
  const id = (await res.json()).appointment.id as string;
  const row = server.rows.find((r) => r.id === id)!;
  assert.match(row.notes ?? '', /altrixs-telehealth/);
  await patch(id, { notes: 'visible note' });
  assert.match(row.notes ?? '', /^visible note\n<!--altrixs-telehealth:/);
  row.status = 'COMPLETED';
  const moved = await patch(id, { startsAt: '2026-10-22T15:00:00.000Z' });
  assert.equal(moved.status, 400);
});

test('POST: clinician overlap (not an exact duplicate) answers 409 CLINICIAN_OVERLAP; touching edges are fine', async () => {
  const first = await post({ clientId: 'c1', clinicianId: 'u1', type: 'Individual Therapy', startsAt: '2026-10-23T13:00:00.000Z', endsAt: '2026-10-23T13:50:00.000Z' });
  assert.equal(first.status, 201);
  const before = server.rows.length;
  const clash = await post({ clientId: 'c1', clinicianId: 'u1', type: 'Individual Therapy', startsAt: '2026-10-23T13:20:00.000Z', endsAt: '2026-10-23T14:10:00.000Z' });
  assert.equal(clash.status, 409);
  const json = await clash.json();
  assert.equal(json.code, 'CLINICIAN_OVERLAP');
  assert.equal(json.conflictIds.length, 1);
  assert.equal(server.rows.length, before);
  const edge = await post({ clientId: 'c1', clinicianId: 'u1', type: 'Individual Therapy', startsAt: '2026-10-23T13:50:00.000Z', endsAt: '2026-10-23T14:40:00.000Z' });
  assert.equal(edge.status, 201);
});

test('POST: intentional overbook needs a reason; the reason is stored and audited', async () => {
  const noReason = await post({ clientId: 'c1', clinicianId: 'u1', type: 'Individual Therapy', startsAt: '2026-10-23T13:10:00.000Z', allowOverbook: true });
  assert.equal(noReason.status, 400);
  const ok = await post({ clientId: 'c1', clinicianId: 'u1', type: 'Individual Therapy', startsAt: '2026-10-23T13:10:00.000Z', allowOverbook: true, overbookReason: 'Crisis add-on per director' });
  assert.equal(ok.status, 201);
  const id = (await ok.json()).appointment.id as string;
  assert.equal((server.rows.find((r) => r.id === id) as unknown as { overbookReason: string }).overbookReason, 'Crisis add-on per director');
  const audit = server.audits.find((a) => (a as { action: string }).action === 'APPOINTMENT_OVERBOOK') as { metadata: { reason: string } };
  assert.equal(audit.metadata.reason, 'Crisis add-on per director');
});
