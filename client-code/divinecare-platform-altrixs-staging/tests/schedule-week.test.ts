import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  appointmentsInWeek,
  formatWeekRange,
  mondayOfWeek,
  weekDaysForOffset,
} from '../src/features/analytics/scheduleWeek';

const WED_AUG_26 = new Date(2026, 7, 26, 15, 30, 0); // Wednesday
const SUN_AUG_30 = new Date(2026, 7, 30, 9, 0, 0);
const MON_AUG_31 = new Date(2026, 7, 31, 10, 0, 0);

test('weekDaysForOffset uses Monday–Friday of the week containing now', () => {
  const days = weekDaysForOffset(0, WED_AUG_26);
  assert.equal(days.length, 5);
  assert.deepEqual(
    days.map((d) => d.iso),
    ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28']
  );
  assert.equal(days[0].key, 'Mon');
  assert.equal(days[0].date, 'Aug 24');
  assert.equal(days[4].key, 'Fri');
  assert.equal(days[2].isToday, true);
  assert.equal(days[0].isPast, true);
  assert.equal(days[3].isPast, false);
});

test('weekDaysForOffset shifts by full weeks', () => {
  const prev = weekDaysForOffset(-1, WED_AUG_26);
  const next = weekDaysForOffset(1, WED_AUG_26);
  assert.equal(prev[0].iso, '2026-08-17');
  assert.equal(prev[4].iso, '2026-08-21');
  assert.equal(next[0].iso, '2026-08-31');
  assert.equal(next[4].iso, '2026-09-04');
  assert.equal(formatWeekRange(next), 'Aug 31 – Sep 4');
});

test('Sunday belongs to the week that started the previous Monday', () => {
  const days = weekDaysForOffset(0, SUN_AUG_30);
  assert.equal(days[0].iso, '2026-08-24');
  assert.equal(days.every((d) => d.isToday), false);
});

test('mondayOfWeek on Monday is that same day', () => {
  const monday = mondayOfWeek(MON_AUG_31, 0);
  assert.equal(monday.getFullYear(), 2026);
  assert.equal(monday.getMonth(), 7);
  assert.equal(monday.getDate(), 31);
});

test('appointmentsInWeek keeps only Mon–Fri dates of the selected week', () => {
  const week = weekDaysForOffset(0, WED_AUG_26);
  const rows = [
    { date: '2026-08-23', name: 'Sunday before' },
    { date: '2026-08-24', name: 'Monday' },
    { date: '2026-08-26', name: 'Wednesday' },
    { date: '2026-08-29', name: 'Saturday' },
    { date: '2026-08-31', name: 'Next Monday' },
  ];
  const inWeek = appointmentsInWeek(rows, week);
  assert.deepEqual(
    inWeek.map((r) => r.name),
    ['Monday', 'Wednesday']
  );
});
