import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseScheduledDate,
  normalizeIntakeStatus,
} from '../src/patient/application/medications/intakeService';

test('parseScheduledDate correctly parses 12-hour AM/PM formats', () => {
  const d1 = parseScheduledDate('8:00 AM');
  assert.equal(d1.getHours(), 8);
  assert.equal(d1.getMinutes(), 0);

  const d2 = parseScheduledDate('1:00 PM');
  assert.equal(d2.getHours(), 13);
  assert.equal(d2.getMinutes(), 0);

  const d3 = parseScheduledDate('12:00 PM');
  assert.equal(d3.getHours(), 12);
  assert.equal(d3.getMinutes(), 0);

  const d4 = parseScheduledDate('12:30 AM');
  assert.equal(d4.getHours(), 0);
  assert.equal(d4.getMinutes(), 30);

  const d5 = parseScheduledDate('8:00pm');
  assert.equal(d5.getHours(), 20);
  assert.equal(d5.getMinutes(), 0);
});

test('parseScheduledDate correctly parses 24-hour HH:MM formats', () => {
  const d1 = parseScheduledDate('08:00');
  assert.equal(d1.getHours(), 8);
  assert.equal(d1.getMinutes(), 0);

  const d2 = parseScheduledDate('13:00');
  assert.equal(d2.getHours(), 13);
  assert.equal(d2.getMinutes(), 0);

  const d3 = parseScheduledDate('20:30:00');
  assert.equal(d3.getHours(), 20);
  assert.equal(d3.getMinutes(), 30);
});

test('parseScheduledDate parses ISO datetime strings', () => {
  const d1 = parseScheduledDate('2026-09-16T14:30:00.000Z');
  assert.equal(isNaN(d1.getTime()), false);

  const d2 = parseScheduledDate('2026-09-16 14:30:00');
  assert.equal(isNaN(d2.getTime()), false);
});

test('parseScheduledDate falls back to doseTimes or current date safely', () => {
  const d1 = parseScheduledDate(null, ['08:00', '13:00']);
  assert.equal(d1.getHours(), 8);
  assert.equal(d1.getMinutes(), 0);

  const d2 = parseScheduledDate(undefined);
  assert.equal(isNaN(d2.getTime()), false);
});

test('normalizeIntakeStatus correctly resolves taken vs skipped across formats', () => {
  assert.deepEqual(normalizeIntakeStatus({ status: 'taken' }), { taken: true, skipped: false });
  assert.deepEqual(normalizeIntakeStatus({ status: 'skipped' }), { taken: false, skipped: true });
  assert.deepEqual(normalizeIntakeStatus({ action: 'take' }), { taken: true, skipped: false });
  assert.deepEqual(normalizeIntakeStatus({ action: 'skip' }), { taken: false, skipped: true });
  assert.deepEqual(normalizeIntakeStatus({ taken: true }), { taken: true, skipped: false });
  assert.deepEqual(normalizeIntakeStatus({ taken: false }), { taken: false, skipped: true });
  assert.deepEqual(normalizeIntakeStatus({ skipped: true }), { taken: false, skipped: true });
  assert.deepEqual(normalizeIntakeStatus({ is_taken: 'false' }), { taken: false, skipped: true });
  assert.deepEqual(normalizeIntakeStatus({}), { taken: true, skipped: false });
});
