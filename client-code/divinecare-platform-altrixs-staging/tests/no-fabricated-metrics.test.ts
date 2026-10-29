import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  completedInYear,
  computeReadiness,
  expiryFromFrequency,
  incidentTimeliness,
  isInQuarter,
  isOverdueCalendarItem,
  practiceQuarter,
  trainingStatusFromDates,
} from '../src/lib/compliance/metrics';
import { computeCarfScorecard } from '../src/lib/compliance/carfScorecard';
import { addBusinessDays } from '../src/lib/workflows/dates';
import {
  computeClinicianDocMetrics,
  deriveAppointmentNoteStatus,
  lastDaysWindow,
  type VisitRow,
} from '../src/lib/analytics/visitDocumentation';
import { isDemoRecord, stripDemoModuleData } from '../src/lib/modules/demoData';

const H = 3_600_000;

// ─── Quarter (practice time, America/New_York) ────────────────────────────────

test('practice quarter is the current quarter on the New York clock', () => {
  const q = practiceQuarter(new Date('2026-10-18T15:00:00Z'));
  assert.equal(q.label, 'Q4 2026');
  assert.equal(q.startIso, '2026-10-01');
  assert.equal(q.endIso, '2026-12-31');
  assert.equal(q.rangeLabel, 'Oct 1 – Dec 31, 2026');
});

test('quarter boundary uses New York time, not UTC', () => {
  // 2026-10-01T02:00Z is still Sep 30 at 10 PM in New York → Q3
  assert.equal(practiceQuarter(new Date('2026-10-01T02:00:00Z')).label, 'Q3 2026');
  assert.equal(practiceQuarter(new Date('2027-01-01T03:00:00Z')).label, 'Q4 2026');
  assert.equal(practiceQuarter(new Date('2027-01-01T06:00:00Z')).label, 'Q1 2027');
});

test('isInQuarter accepts dates and datetimes', () => {
  const q = practiceQuarter(new Date('2026-11-05T12:00:00Z'));
  assert.equal(isInQuarter('2026-10-01', q), true);
  assert.equal(isInQuarter('2026-12-31T23:00:00Z', q), true);
  assert.equal(isInQuarter('2026-09-30', q), false);
  assert.equal(isInQuarter(undefined, q), false);
});

// ─── Readiness scoring ────────────────────────────────────────────────────────

const EMPTY = { safetyPlans: [], trainingStaff: [], qiMeetings: [], incidents: [], grievances: [], dischargeCases: [] };

test('readiness with no source data is "no data", never 100%', () => {
  const r = computeReadiness({ ...EMPTY, now: new Date('2026-10-18T15:00:00Z') });
  assert.equal(r.overall, null);
  assert.equal(r.factorsWithData, 0);
  assert.ok(r.factors.every((f) => f.score === null));
  const card = computeCarfScorecard(EMPTY);
  assert.equal(card.overall, null);
});

test('readiness only weights factors that have data', () => {
  const r = computeReadiness({
    ...EMPTY,
    safetyPlans: [{ withoutPlan: false, reviewDue: false }, { withoutPlan: true }],
    now: new Date('2026-10-18T15:00:00Z'),
  });
  assert.equal(r.factorsWithData, 1);
  assert.equal(r.overall, 50);
});

test('QI meeting counts only within the last 90 days', () => {
  const now = new Date('2026-10-18T15:00:00Z');
  const old = computeReadiness({ ...EMPTY, qiMeetings: [{ date: '2026-05-01' }], now });
  assert.equal(old.factors.find((f) => f.key === 'qi')!.score, 0);
  const recent = computeReadiness({ ...EMPTY, qiMeetings: [{ date: '2026-09-15' }], now });
  assert.equal(recent.factors.find((f) => f.key === 'qi')!.score, 100);
});

test('open serious incident older than 48h uses the real statuses and reportedAt', () => {
  const now = new Date('2026-10-18T15:00:00Z');
  const r = computeReadiness({
    ...EMPTY,
    incidents: [{ status: 'investigating', severity: 'serious', reportedAt: '2026-10-10' }],
    now,
  });
  assert.equal(r.factors.find((f) => f.key === 'incidents')!.score, 0);
  const closed = computeReadiness({
    ...EMPTY,
    incidents: [{ status: 'closed', severity: 'critical', reportedAt: '2026-10-10' }],
    now,
  });
  assert.equal(closed.factors.find((f) => f.key === 'incidents')!.score, 100);
});

test('grievance overdue after 10 business days from submittedAt', () => {
  const now = new Date('2026-10-18T15:00:00Z');
  const overdue = computeReadiness({ ...EMPTY, grievances: [{ status: 'submitted', submittedAt: '2026-10-01' }], now });
  assert.equal(overdue.factors.find((f) => f.key === 'grievances')!.score, 0);
  const fine = computeReadiness({ ...EMPTY, grievances: [{ status: 'acknowledged', submittedAt: '2026-10-14' }], now });
  assert.equal(fine.factors.find((f) => f.key === 'grievances')!.score, 100);
});

// ─── Training status from dates ───────────────────────────────────────────────

test('training status comes from dates; expiry from the course frequency', () => {
  assert.equal(trainingStatusFromDates({ status: 'complete', completedDate: '2025-01-01', expiresDate: '2026-01-01' }, '2026-10-18'), 'overdue');
  assert.equal(trainingStatusFromDates({ completedDate: '2026-01-01', expiresDate: '2026-11-01' }, '2026-10-18'), 'expiring');
  assert.equal(trainingStatusFromDates({ completedDate: '2026-01-01' }, '2026-10-18'), 'complete');
  assert.equal(trainingStatusFromDates({}, '2026-10-18'), 'not-started');
  assert.equal(expiryFromFrequency('2026-10-18', 'Annual'), '2027-10-18');
  assert.equal(expiryFromFrequency('2026-10-18', '2yr'), '2028-10-18');
  assert.equal(expiryFromFrequency('2026-10-18', 'One-time'), undefined);
  assert.equal(expiryFromFrequency('2026-10-18', ''), undefined);
});

// ─── Compliance calendar ──────────────────────────────────────────────────────

test('overdue = any open item past due; completed YTD counts completedAt this year', () => {
  assert.equal(isOverdueCalendarItem({ status: 'upcoming', dueDate: '2026-10-01' }, '2026-10-18'), true);
  assert.equal(isOverdueCalendarItem({ status: 'upcoming', dueDate: '2026-10-30' }, '2026-10-18'), false);
  assert.equal(isOverdueCalendarItem({ status: 'completed', dueDate: '2026-10-01' }, '2026-10-18'), false);
  const items = [
    { status: 'completed', dueDate: '2026-02-01', completedAt: '2026-02-01' },
    { status: 'completed', dueDate: '2025-12-01', completedAt: '2025-12-02' },
    { status: 'completed', dueDate: '2026-03-01' },
    { status: 'upcoming', dueDate: '2026-12-01' },
  ];
  assert.equal(completedInYear(items, 2026), 1);
});

// ─── Incident timeliness ──────────────────────────────────────────────────────

test('timeliness needs both occurred and reported date+time', () => {
  assert.equal(incidentTimeliness('2026-10-17T14:00:00Z', '2026-10-18T13:00:00Z'), 'within_24h');
  assert.equal(incidentTimeliness('2026-10-16T14:00:00Z', '2026-10-18T13:00:00Z'), 'late');
  assert.equal(incidentTimeliness(undefined, '2026-10-18T13:00:00Z'), null);
  assert.equal(incidentTimeliness('2026-10-17', '2026-10-18T13:00:00Z'), null, 'date only = time unknown');
  assert.equal(incidentTimeliness('2026-10-19T10:00:00Z', '2026-10-18T13:00:00Z'), null, 'report before occurrence');
});

// ─── Business days ────────────────────────────────────────────────────────────

test('grievance deadlines skip weekends (receipt day is day zero)', () => {
  assert.equal(addBusinessDays('2026-10-16', 2), '2026-10-20'); // Fri → Tue
  assert.equal(addBusinessDays('2026-10-16', 10), '2026-10-30');
  assert.equal(addBusinessDays('2026-10-17', 1), '2026-10-19'); // Sat → Mon
});

// ─── Visit documentation (productivity + appointment note status) ─────────────

function visit(p: Partial<VisitRow> & { startsAt: string }): VisitRow {
  return {
    appointmentId: p.appointmentId ?? `a-${p.startsAt}`,
    clinicianId: p.clinicianId ?? 'u1',
    clinicianName: 'Pat Lee',
    clinicianRole: 'THERAPIST',
    clientName: 'Client A',
    type: 'Individual Therapy',
    endsAt: p.endsAt ?? new Date(new Date(p.startsAt).getTime() + H).toISOString(),
    notes: p.notes ?? [],
    ...p,
  };
}

test('note status is signed only with a linked signed note', () => {
  assert.equal(deriveAppointmentNoteStatus([]), 'NOT_STARTED');
  assert.equal(deriveAppointmentNoteStatus([{ status: 'Draft', signedAt: null, lockedAt: null }]), 'IN_PROGRESS');
  assert.equal(deriveAppointmentNoteStatus([{ status: 'Locked', signedAt: null, lockedAt: '2026-10-18T00:00:00Z' }]), 'SIGNED');
});

test('productivity: sessions = completed visits in window; compliance = signed within 72h', () => {
  const now = new Date('2026-10-18T20:00:00Z').getTime();
  const rows = computeClinicianDocMetrics(
    [
      visit({ startsAt: '2026-10-16T14:00:00Z', notes: [{ status: 'Signed', signedAt: '2026-10-16T18:00:00Z', lockedAt: null }] }),
      visit({ startsAt: '2026-10-13T14:00:00Z', notes: [{ status: 'Signed', signedAt: '2026-10-17T18:00:00Z', lockedAt: null }] }),
      visit({ startsAt: '2026-10-12T14:00:00Z' }),
      visit({ startsAt: '2026-09-01T14:00:00Z', notes: [{ status: 'Signed', signedAt: '2026-09-01T16:00:00Z', lockedAt: null }] }),
    ],
    lastDaysWindow(7, now)
  );
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.sessions, 3);
  assert.equal(r.signedWithin24h, 1);
  assert.equal(r.signedWithin72h, 1);
  assert.equal(r.complianceRate, 33);
  assert.equal(r.overdue, 1);
  assert.equal(r.lateNotes[0].sessionDate, '2026-10-12');
});

test('productivity with no visits returns no rows (no invented clinicians)', () => {
  assert.deepEqual(computeClinicianDocMetrics([], lastDaysWindow(7)), []);
});

// ─── Demo filter: explicit marker only ────────────────────────────────────────

test('real records with demo-looking values are never hidden', () => {
  const real = [{ id: 'D-1', email: 'x@example.com' }, { id: 'p1' }];
  assert.equal(isDemoRecord(real[0]), false);
  assert.deepEqual(stripDemoModuleData(real), real);
  assert.deepEqual(stripDemoModuleData([{ id: 'x', __demo: true }, { id: 'y' }]), [{ id: 'y' }]);
});
