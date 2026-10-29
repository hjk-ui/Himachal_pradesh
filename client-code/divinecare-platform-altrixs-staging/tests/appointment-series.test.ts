import assert from 'node:assert/strict';
import { test } from 'node:test';
import Module, { createRequire } from 'node:module';
import {
  addMonthsYmd,
  describeRecurrence,
  occurrenceDates,
  occurrenceInstants,
  seriesHardEnd,
  validateRecurrence,
  type RecurrenceRule,
} from '../src/lib/scheduling/recurrence';
import { overlaps, parseOverbook } from '../src/lib/appointments/overlap';
import { rankWaitlist, serviceMatches } from '../src/lib/scheduling/waitlistSuggest';

const ET = 'America/New_York';
const base: RecurrenceRule = { frequency: 'weekly', startDate: '2026-10-19', startTime: '09:00', durationMinutes: 50, count: 4 };

test('weekly: same weekday, count respected', () => {
  assert.deepEqual(occurrenceDates(base), ['2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09']);
});

test('DST: 9:00 AM stays 9:00 AM across the Nov 1 fall-back (13:00Z -> 14:00Z)', () => {
  const occ = occurrenceInstants(base, ET);
  assert.equal(occ[0].start.toISOString(), '2026-10-19T13:00:00.000Z');
  assert.equal(occ[1].start.toISOString(), '2026-10-26T13:00:00.000Z');
  assert.equal(occ[2].start.toISOString(), '2026-11-02T14:00:00.000Z');
  assert.equal(occ[2].end.getTime() - occ[2].start.getTime(), 50 * 60_000);
  // spring forward (Mar 14 2027)
  const spring = occurrenceInstants({ ...base, startDate: '2027-03-08', count: 2 }, ET);
  assert.equal(spring[0].start.toISOString(), '2027-03-08T14:00:00.000Z');
  assert.equal(spring[1].start.toISOString(), '2027-03-15T13:00:00.000Z');
});

test('biweekly on two weekdays; first week days before start are skipped', () => {
  const dates = occurrenceDates({ ...base, frequency: 'biweekly', byWeekday: [1, 3], startDate: '2026-10-21', count: 5 });
  // start Wed Oct 21: Wed 21, (skip Mon 19), then 2 weeks later Mon Nov 2, Wed Nov 4, Mon Nov 16, Wed Nov 18
  assert.deepEqual(dates, ['2026-10-21', '2026-11-02', '2026-11-04', '2026-11-16', '2026-11-18']);
  assert.equal(describeRecurrence({ frequency: 'biweekly', byWeekday: [1, 3], startDate: '2026-10-21' }), 'Every 2 weeks on Mon, Wed');
});

test('monthly: day 31 clamps to the month end', () => {
  assert.deepEqual(occurrenceDates({ ...base, frequency: 'monthly', startDate: '2026-10-31', count: 4 }), [
    '2026-10-31', '2026-11-30', '2026-12-31', '2027-01-31',
  ]);
  assert.equal(addMonthsYmd('2027-01-31', 1), '2027-02-28');
});

test('caps: never more than 26 visits or past 6 months', () => {
  assert.equal(seriesHardEnd('2026-10-19'), '2027-04-18');
  const weeklyNoCount = occurrenceDates({ ...base, count: null, endDate: '2027-04-18', byWeekday: [1, 3] });
  assert.equal(weeklyNoCount.length, 26);
  const sixMonths = occurrenceDates({ ...base, count: 26, frequency: 'biweekly' });
  assert.ok(sixMonths.every((d) => d <= '2027-04-18'));
  assert.equal(sixMonths.length, 13);
  assert.match(validateRecurrence({ ...base, count: 27 }) ?? '', /1 to 26/);
  assert.match(validateRecurrence({ ...base, count: null, endDate: '2027-05-01' }) ?? '', /6 months/);
  assert.match(validateRecurrence({ ...base, count: null }) ?? '', /end date or a number/);
  assert.equal(validateRecurrence(base), null);
});

test('overlap: [start, end) semantics, touching edges do not overlap', () => {
  const a = { start: new Date('2026-10-19T13:00:00Z'), end: new Date('2026-10-19T13:50:00Z') };
  assert.equal(overlaps(a, { startsAt: new Date('2026-10-19T13:49:00Z'), endsAt: new Date('2026-10-19T14:30:00Z') }), true);
  assert.equal(overlaps(a, { startsAt: new Date('2026-10-19T13:50:00Z'), endsAt: new Date('2026-10-19T14:40:00Z') }), false);
  assert.equal(overlaps(a, { startsAt: new Date('2026-10-19T12:10:00Z'), endsAt: new Date('2026-10-19T13:00:00Z') }), false);
  assert.deepEqual(parseOverbook({ allowOverbook: true, overbookReason: ' ok ' }).ok, false);
  assert.deepEqual(parseOverbook({ allowOverbook: true, overbookReason: 'Group overflow' }), { ok: true, reason: 'Group overflow' });
  assert.deepEqual(parseOverbook({}), { ok: true, reason: null });
});

test('waitlist: same clinician first by urgency, then same service; nothing else', () => {
  const slot = { id: 'a1', clinicianId: 'u1', type: 'Individual Therapy', startsAt: new Date('2026-10-30T13:00:00Z') };
  const entries = [
    { id: 'w1', name: 'A', urgency: 'ROUTINE', specialty: 'Therapy', clinicianId: null, createdAt: new Date('2026-09-01') },
    { id: 'w2', name: 'B', urgency: 'URGENT', specialty: 'Psychiatry', clinicianId: 'u1', createdAt: new Date('2026-10-01') },
    { id: 'w3', name: 'C', urgency: 'ROUTINE', specialty: 'Psychiatry', clinicianId: null, createdAt: new Date('2026-08-01') },
    { id: 'w4', name: 'D', urgency: 'ROUTINE', specialty: 'Therapy', clinicianId: 'u9', createdAt: new Date('2026-08-01') },
  ];
  const r = rankWaitlist(entries, slot);
  assert.deepEqual(r.map((x) => x.entryId), ['w2', 'w1']);
  assert.equal(r[0].match, 'same_clinician');
  assert.ok(serviceMatches('Psychiatry', 'Psychiatric Evaluation'));
  assert.ok(!serviceMatches('Psychiatry', 'Individual Therapy'));
});

// ── createSeries / editSeries with mocked DB + createAppointment ──────────────

function loadSeries(opts: { conflictDates: string[]; updateConflictDates?: string[] }) {
  const createdCalls: any[] = [];
  const updateCalls: any[] = [];
  const seriesRows: any[] = [];
  const appts: any[] = [];
  const db = {
    client: { findFirst: async () => ({ id: 'c1', assignedToId: 'u1', status: 'ACTIVE' }) },
    appointmentSeries: {
      create: async ({ data }: any) => { const row = { id: `s${seriesRows.length + 1}`, ...data, createdAt: new Date(), updatedAt: new Date() }; seriesRows.push(row); return row; },
      delete: async ({ where }: any) => { seriesRows.splice(seriesRows.findIndex((s) => s.id === where.id), 1); },
      findFirst: async ({ where }: any) => seriesRows.find((s) => s.id === where.id) ?? null,
      update: async ({ where, data }: any) => Object.assign(seriesRows.find((s) => s.id === where.id), data),
    },
    appointment: {
      findFirst: async ({ where }: any) => {
        const a = appts.find((x) => x.id === where.id && x.seriesId === where.seriesId);
        return a ? { ...a, client: { assignedToId: 'u1' } } : null;
      },
      findMany: async ({ where }: any) => appts.filter((x) => x.seriesId === where.seriesId && x.status === 'SCHEDULED' && x.startsAt >= where.startsAt.gte),
    },
  };
  const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
  const originalLoad = loader._load;
  loader._load = function (id, ...args) {
    if (id === 'server-only') return {};
    if (id === '@/lib/db/prisma' || id === '@/lib/db') return { prisma: db };
    if (id === '@/lib/time/practiceTimeServer') return { getPracticeTimeZone: async () => ET };
    if (id === '@/lib/appointments/manage')
      return {
        createAppointment: async (input: any) => {
          createdCalls.push(input);
          const date = input.startsAt.slice(0, 10);
          if (opts.conflictDates.includes(date)) {
            return { ok: false, status: 409, code: 'CLINICIAN_OVERLAP', conflictIds: ['x1'], existingId: 'x1', error: 'overlap' };
          }
          const row = { id: `a${appts.length + 1}`, seriesId: input.seriesId, status: 'SCHEDULED', startsAt: new Date(input.startsAt), endsAt: new Date(input.endsAt) };
          appts.push(row);
          return { ok: true, appointment: { id: row.id, startsAt: input.startsAt } };
        },
        updateAppointment: async (id: string, patch: any) => {
          updateCalls.push({ id, patch });
          if ((opts.updateConflictDates ?? []).some((d) => patch.startsAt?.startsWith(d))) return { ok: false, status: 409, code: 'CLINICIAN_OVERLAP', conflictIds: ['x2'], error: 'overlap' };
          return { ok: true, appointment: { id }, changedFields: ['startsAt'] };
        },
      };
    return originalLoad.call(this, id, ...args);
  };
  const require = createRequire(import.meta.url);
  // Fresh module per harness: each loads its own mocked prisma / createAppointment
  delete require.cache[require.resolve('../src/lib/scheduling/series')];
  try {
    const series = require('../src/lib/scheduling/series') as typeof import('../src/lib/scheduling/series');
    return { series, createdCalls, updateCalls, seriesRows, appts };
  } finally {
    loader._load = originalLoad;
  }
}

const ACTOR = { id: 'u_admin', role: 'ADMIN' as const, organizationId: 'org_1' };
const FUTURE: RecurrenceRule = { frequency: 'weekly', startDate: '2099-10-19', startTime: '09:00', durationMinutes: 50, count: 4 };

test('series: conflicts are skipped and reported; only the first booked visit notifies', async () => {
  const h = loadSeries({ conflictDates: ['2099-10-26'] });
  const r = await h.series.createSeries({ clientId: 'c1', clinicianId: 'u1', type: 'Individual Therapy', rule: FUTURE }, ACTOR as any);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.created.length, 3);
    assert.deepEqual(r.skipped.map((s) => [s.date, s.reason]), [['2099-10-26', 'clinician_overlap']]);
  }
  assert.equal(h.createdCalls.length, 4);
  assert.deepEqual(h.createdCalls.map((c) => c.suppressNotifications), [false, true, true, true]);
  assert.ok(h.createdCalls.every((c) => c.seriesId === 's1'));
});

test('series: all occurrences conflicting books nothing and removes the empty series', async () => {
  const h = loadSeries({ conflictDates: ['2099-10-19', '2099-10-26', '2099-11-02', '2099-11-09'] });
  const r = await h.series.createSeries({ clientId: 'c1', clinicianId: 'u1', type: 'Individual Therapy', rule: FUTURE }, ACTOR as any);
  assert.equal(r.ok, false);
  assert.equal(h.seriesRows.length, 0);
});

test('series edit "this and following": splits the series, keeps wall time per date, reports conflicts', async () => {
  const h = loadSeries({ conflictDates: [] });
  await h.series.createSeries({ clientId: 'c1', clinicianId: 'u1', type: 'Individual Therapy', rule: FUTURE }, ACTOR as any);
  const anchor = h.appts[1]; // 2099-10-26
  const r = await h.series.editSeries('s1', anchor.id, 'following', { startTime: '10:30' }, ACTOR as any);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.seriesId, 's2', 'following edits move to a split series');
    assert.equal(r.updated.length, 3);
  }
  assert.equal(h.seriesRows.find((s) => s.id === 's1').endDate.toISOString().slice(0, 10), '2099-10-25');
  // 10:30 ET wall time each date (EDT before Nov 1 is UTC-4, EST after)
  const moved = h.updateCalls.map((c) => c.patch.startsAt);
  assert.deepEqual(moved, ['2099-10-26T14:30:00.000Z', '2099-11-02T15:30:00.000Z', '2099-11-09T15:30:00.000Z']);
  assert.ok(h.updateCalls.every((c) => c.patch.overlapExcludeIds.length === 3 && c.patch.seriesId === 's2'));
});

test('series edit reports occurrences that would conflict and leaves them unchanged', async () => {
  const h = loadSeries({ conflictDates: [], updateConflictDates: ['2099-11-09'] });
  await h.series.createSeries({ clientId: 'c1', clinicianId: 'u1', type: 'Individual Therapy', rule: FUTURE }, ACTOR as any);
  const r = await h.series.editSeries('s1', h.appts[0].id, 'all', { durationMinutes: 60 }, ACTOR as any);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.seriesId, 's1', 'entire-series edits keep the series');
    assert.equal(r.updated.length, 3);
    assert.deepEqual(r.unchanged.map((u) => [u.date, u.reason]), [['2099-11-09', 'clinician_overlap']]);
  }
  assert.equal(h.seriesRows[0].durationMinutes, 60);
  const call = h.updateCalls[0].patch;
  assert.equal(Date.parse(call.endsAt) - Date.parse(call.startsAt), 60 * 60_000);
});

test('series cancel scopes: "following" ends the series the day before', async () => {
  const h = loadSeries({ conflictDates: [] });
  await h.series.createSeries({ clientId: 'c1', clinicianId: 'u1', type: 'Individual Therapy', rule: FUTURE }, ACTOR as any);
  const r = await h.series.cancelSeries('s1', h.appts[2].id, 'following', ACTOR as any);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.cancelled.length, 2);
  assert.ok(h.updateCalls.every((c) => c.patch.visitStatus === 'cancelled'));
  assert.equal(h.seriesRows[0].endDate.toISOString().slice(0, 10), '2099-11-01');
});
