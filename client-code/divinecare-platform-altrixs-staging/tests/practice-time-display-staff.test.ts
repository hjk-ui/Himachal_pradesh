import test from 'node:test';
import assert from 'node:assert/strict';
import { apptInstant, formatApptWhenStaff } from '../src/lib/clients/appointmentDisplay';
import { addDaysYmd, practiceDayBounds, practiceTodayBounds, weekdayOfYmd } from '../src/lib/dashboard/practiceDay';
import { practiceAnchor, weekDaysForOffset } from '../src/features/analytics/scheduleWeek';
import { loadChartBanner, type BannerClientRow, type ChartBanner, type ChartBannerSource } from '../src/lib/clients/chartBanner';

const ET = 'America/New_York';

test('staff appointment label: 13:00Z renders 9:00 AM ET on the practice clock', () => {
  assert.equal(formatApptWhenStaff({ startsAt: '2026-10-19T13:00:00Z', timeZone: ET }), 'Mon, Oct 19, 9:00 AM ET');
});

test('staff appointment label: 02:30Z next UTC day is still Oct 19 evening in ET', () => {
  assert.equal(formatApptWhenStaff({ startsAt: '2026-10-20T02:30:00Z', timeZone: ET }), 'Mon, Oct 19, 10:30 PM ET');
});

test('staff appointment label: the mis-booked 09:44Z appointment reads 5:44 AM ET everywhere', () => {
  assert.equal(
    formatApptWhenStaff({ startsAt: '2026-10-19T09:44:00Z', timeZone: ET }, { dateOpts: { month: 'short', day: 'numeric' } }),
    'Oct 19, 5:44 AM ET'
  );
});

test('staff appointment label: missing zone defaults to the practice default (ET), not UTC', () => {
  assert.equal(formatApptWhenStaff({ startsAt: new Date('2026-10-19T23:00:00Z') }), 'Mon, Oct 19, 7:00 PM ET');
});

test('staff appointment label: falls back to practice-clock date + startTime when startsAt is absent', () => {
  const at = apptInstant({ date: '2026-10-19', startTime: '09:00', timeZone: ET });
  assert.equal(at?.toISOString(), '2026-10-19T13:00:00.000Z');
  assert.equal(formatApptWhenStaff({ date: '2026-10-19', startTime: '09:00', timeZone: ET }), 'Mon, Oct 19, 9:00 AM ET');
  assert.equal(formatApptWhenStaff({ date: 'bad', startTime: '09:00' }), 'bad · 09:00');
});

test('staff appointment label: other practice zone gets its own label', () => {
  assert.equal(formatApptWhenStaff({ startsAt: '2026-10-19T16:00:00Z', timeZone: 'America/Chicago' }), 'Mon, Oct 19, 11:00 AM CT');
});

test('practice day bounds: Oct 19 ET is 04:00Z to 04:00Z next day', () => {
  const b = practiceDayBounds('2026-10-19', ET);
  assert.equal(b.start.toISOString(), '2026-10-19T04:00:00.000Z');
  assert.equal(b.end.toISOString(), '2026-10-20T04:00:00.000Z');
  const evening = new Date('2026-10-20T02:30:00Z');
  assert.ok(evening >= b.start && evening < b.end, '10:30 PM ET belongs to Oct 19');
});

test('practice today: 02:30Z on Oct 20 is still Oct 19 at the practice', () => {
  const t = practiceTodayBounds(ET, new Date('2026-10-20T02:30:00Z'));
  assert.equal(t.ymd, '2026-10-19');
  assert.equal(t.start.toISOString(), '2026-10-19T04:00:00.000Z');
});

test('practice day bounds: fall-back DST day is 25 hours long', () => {
  const b = practiceDayBounds('2026-11-01', ET);
  assert.equal(b.start.toISOString(), '2026-11-01T04:00:00.000Z');
  assert.equal(b.end.toISOString(), '2026-11-02T05:00:00.000Z');
});

test('calendar helpers', () => {
  assert.equal(addDaysYmd('2026-10-31', 1), '2026-11-01');
  assert.equal(addDaysYmd('2026-10-19', -6), '2026-10-13');
  assert.equal(weekdayOfYmd('2026-10-19'), 'Mon');
});

test('schedule week: practice zone decides "today" (Sunday 10:30 PM ET is not Monday)', () => {
  const now = new Date('2026-10-19T02:30:00Z'); // Sun Oct 18, 10:30 PM ET; Mon Oct 19 in UTC
  const anchor = practiceAnchor(now, ET);
  assert.equal(anchor.getDate(), 18);
  const days = weekDaysForOffset(0, now, ET);
  assert.equal(days[0].iso, '2026-10-12');
  assert.equal(days.some((d) => d.isToday), false);

  const mondayEvening = new Date('2026-10-20T02:30:00Z'); // Mon Oct 19, 10:30 PM ET
  const wk = weekDaysForOffset(0, mondayEvening, ET);
  assert.equal(wk[0].iso, '2026-10-19');
  assert.equal(wk[0].isToday, true);
});

test('chart banner: next appointment carries the practice time zone', async () => {
  const client: BannerClientRow = {
    id: 'c1',
    organizationId: 'org-a',
    name: 'Test Patient',
    status: 'ACTIVE',
    assignedToId: null,
    assignedToName: null,
  } as unknown as BannerClientRow;
  const source = {
    async findClient() {
      return client;
    },
    async sensitiveState() {
      return 'none';
    },
    async sensitiveAlias() {
      return null;
    },
    async hasForwardedThread() {
      return false;
    },
    async allergies() {
      return [];
    },
    async priorAuths() {
      return [];
    },
    async riskAlerts() {
      return [];
    },
    async latestCssrs() {
      return null;
    },
    async nextAppointment() {
      return { id: 'a1', startsAt: new Date('2026-10-19T13:00:00Z'), type: 'Therapy', clinicianName: null, isVirtual: false };
    },
    async practiceTimeZone() {
      return 'America/Chicago';
    },
    async balanceCents() {
      return null;
    },
    async sessionFrequency() {
      return null;
    },
  } as unknown as ChartBannerSource;
  const r = await loadChartBanner(source, { organizationId: 'org-a', userId: 'u', role: 'ADMIN', billingVisible: false }, 'c1');
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error('expected a banner');
  const b = r.banner as ChartBanner;
  if (b.locked) throw new Error('expected an unlocked banner');
  assert.equal(b.nextAppointment?.startsAt, '2026-10-19T13:00:00.000Z');
  assert.equal(b.nextAppointment?.timeZone, 'America/Chicago');

  const noTz = { ...(source as object), practiceTimeZone: undefined } as unknown as ChartBannerSource;
  const r2 = await loadChartBanner(noTz, { organizationId: 'org-a', userId: 'u', role: 'ADMIN', billingVisible: false }, 'c1');
  if (!r2.ok) throw new Error('expected a banner');
  const b2 = r2.banner as ChartBanner;
  if (b2.locked) throw new Error('expected an unlocked banner');
  assert.equal(b2.nextAppointment?.timeZone, ET);
});
