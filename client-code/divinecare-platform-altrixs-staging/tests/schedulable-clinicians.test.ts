import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { SCHEDULABLE_STAFF_STATUSES } from '../src/lib/staff/schedulable';

/** Invited clinicians (e.g. imported from Valant, invite not yet accepted) can be booked; deactivated never. */
const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('schedulable statuses are ACTIVE and INVITED, never DEACTIVATED', () => {
  assert.deepEqual([...SCHEDULABLE_STAFF_STATUSES].sort(), ['ACTIVE', 'INVITED']);
});

test('booking, rescheduling and online booking all use the shared schedulable statuses', () => {
  const appts = read('src/lib/appointments/manage.ts');
  assert.equal((appts.match(/status: \{ in: SCHEDULABLE_STAFF_STATUSES \}/g) || []).length, 2);
  assert.doesNotMatch(appts, /clinicianId[^\n]*status: 'ACTIVE'/);
  const sched = read('src/lib/scheduling/manage.ts');
  assert.equal((sched.match(/status: \{ in: SCHEDULABLE_STAFF_STATUSES \}/g) || []).length, 2);
});

test('calendar lists invited clinicians in the Clinician dropdown and as columns', () => {
  const page = read('src/app/dashboard/appointments/page.tsx');
  assert.match(page, /SCHEDULABLE_STAFF_STATUSES as string\[\]\)\.includes\(staff\.status\)/);
  assert.doesNotMatch(page, /staff\.status === 'ACTIVE'/);
});
