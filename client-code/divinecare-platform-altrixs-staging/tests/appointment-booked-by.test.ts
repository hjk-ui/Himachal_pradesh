import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { bookedByText, slotTimeFromOffset } from '../src/features/appointments/calendarSlots';

const TZ = 'America/New_York';

test('double-click slot time: 80px per hour from 8 AM, rounded down to 15 minutes, kept in the day', () => {
  assert.equal(slotTimeFromOffset(0, 80, 8, 19), '08:00');
  assert.equal(slotTimeFromOffset(79, 80, 8, 19), '08:45');
  assert.equal(slotTimeFromOffset(120, 80, 8, 19), '09:30');
  assert.equal(slotTimeFromOffset(5000, 80, 8, 19), '18:45');
  assert.equal(slotTimeFromOffset(-10, 80, 8, 19), '08:00');
});

test('booked by text: staff name, online, portal, import, unknown', () => {
  assert.match(bookedByText({ bookedBy: { name: 'Front Desk One', via: 'staff', at: '2026-10-22T13:41:00.000Z' } }, TZ), /^Front Desk One · Oct 22, 2026, 9:41/);
  assert.match(bookedByText({ bookedBy: { name: null, via: 'online', at: '2026-10-22T13:41:00.000Z' } }, TZ), /^Client, online booking page/);
  assert.match(bookedByText({ bookedBy: { name: null, via: 'portal', at: null } }, TZ), /^Client, patient portal$/);
  assert.equal(bookedByText({ bookedBy: { name: null, via: 'import', at: '2026-10-16T00:00:00.000Z' } }, TZ), 'Imported from Valant');
  assert.match(bookedByText({ bookedBy: { name: null, via: null, at: null } }, TZ), /^Not recorded/);
});

test('server records who booked and who last changed the visit', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/lib/appointments/manage.ts'), 'utf8');
  assert.match(src, /createdById: actorUserId,\s*createdByName: actorName,\s*createdVia: 'staff'/);
  assert.match(src, /data\.lastChangedById = actor\.id;/);
  const sql = fs.readFileSync(path.join(__dirname, '..', 'prisma/migrations/20261022_appointment_booked_by.sql'), 'utf8');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "createdVia"/);
});
