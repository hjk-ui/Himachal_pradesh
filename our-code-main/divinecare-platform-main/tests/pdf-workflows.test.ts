import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assessmentSubmissionSchema, scoreAssessment } from '../src/lib/ehr/assessmentScoring';
import { addBusinessDays, addCalendarDays, clinicDate, parseDateOnly, validatePlanReviewDate } from '../src/lib/workflows/dates';
import { SaveQueue, type SaveState } from '../src/lib/modules/saveQueue';
import { appointmentConfirmationSms } from '../src/patient/infrastructure/notifications/templates';
import { canUseClinicModule } from '../src/lib/modules/access';
import { noteTransition } from '../src/lib/notes/transitions';

const base = { clientId: 'synthetic-client', submissionId: 'c3c2dd9d-b910-4e51-8764-281707331c68', type: 'PHQ-9' as const };
test('PHQ-9 item 9 triggers a safety event even when the total is only one', () => {
  const result = scoreAssessment(assessmentSubmissionSchema.parse({ ...base, responses: [0,0,0,0,0,0,0,0,1] }));
  assert.equal(result.score, 1); assert.equal(result.severity, 'Minimal'); assert.equal(result.suicidalIdeation, true);
  assert.equal(result.flags.length, 1);
});
test('PHQ-9 total severity does not fabricate a positive item 9 response', () => {
  const result = scoreAssessment(assessmentSubmissionSchema.parse({ ...base, responses: [3,3,3,3,3,3,3,3,0] }));
  assert.equal(result.score, 24); assert.equal(result.severity, 'Severe'); assert.equal(result.suicidalIdeation, false);
});
test('assessment submission rejects incomplete, fractional, out-of-range and spoofed results', () => {
  for (const responses of [[0], Array(9).fill(-1), Array(9).fill(4), Array(9).fill(0.5)]) {
    assert.equal(assessmentSubmissionSchema.safeParse({ ...base, responses }).success, false);
  }
  assert.equal(assessmentSubmissionSchema.safeParse({ ...base, responses: Array(9).fill(0), score: 1 }).success, false);
  assert.equal(assessmentSubmissionSchema.safeParse({ ...base, type: 'AUDIT', score: 10, interpretation: 'Reviewed', clinicianVerified: false }).success, false);
  assert.throws(() => scoreAssessment(assessmentSubmissionSchema.parse({ ...base, type: 'CAGE-AID', score: 5, interpretation: 'Reviewed', clinicianVerified: true })));
});
test('business deadlines cross weekends, holidays and DST without calendar-day drift', () => {
  assert.equal(addBusinessDays('2026-03-06', 2), '2026-03-10');
  assert.equal(addBusinessDays('2026-09-04', 2, ['2026-09-07']), '2026-09-09');
  assert.equal(addBusinessDays('2026-09-04', 10), '2026-09-18');
  assert.equal(clinicDate(new Date('2026-09-08T01:00:00Z')), '2026-09-07');
  assert.equal(addCalendarDays('2026-03-07', 2), '2026-03-09');
  assert.throws(() => parseDateOnly('2026-02-30'));
});
test('plan review date requires a real date in the inclusive 90-day window', () => {
  const now = new Date('2026-01-01T17:00:00Z');
  assert.equal(validatePlanReviewDate('2026-04-01', now).ok, true);
  for (const value of ['2026-04-02', '2025-12-31', '2026-02-30', '', null]) assert.equal(validatePlanReviewDate(value, now).ok, false);
});
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
test('rapid edits serialize writes and persist the latest draft last', async () => {
  const writes: number[] = []; let release!: () => void;
  const queue = new SaveQueue<number>(async (value) => { writes.push(value); if (value === 1) await new Promise<void>((resolve) => { release = resolve; }); }, () => {});
  queue.enqueue(1); queue.enqueue(2); queue.enqueue(3);
  assert.deepEqual(writes, [1]); assert.equal(queue.hasUnsavedChanges(), true);
  release(); await tick(); assert.deepEqual(writes, [1, 3]); assert.equal(queue.hasUnsavedChanges(), false);
});
test('failed writes retain newer drafts until an explicit successful retry', async () => {
  let fail = true; const writes: number[] = []; const states: SaveState[] = [];
  const queue = new SaveQueue<number>(async (value) => { writes.push(value); if (fail) throw new Error('Offline'); }, (state) => states.push(state));
  queue.enqueue(1); await tick(); queue.enqueue(2); await tick();
  assert.deepEqual(writes, [1]); assert.equal(states.at(-1)?.error, 'Offline'); assert.equal(queue.hasUnsavedChanges(), true);
  fail = false; queue.retry(); await tick(); assert.deepEqual(writes, [1, 2]); assert.deepEqual(states.at(-1), { pending: false, error: null });
});
test('appointment SMS only includes approved schedule/provider fields', () => {
  const input = { date: '2026-09-08', startTime: '10:00', endTime: '11:00', clinicianName: 'Dr. Example', clientName: 'Sensitive Patient', type: 'Trauma therapy', diagnosis: 'F43.1', joinUrl: 'https://private.example/token' };
  const sms = appointmentConfirmationSms(input);
  for (const sensitive of [input.clientName, input.type, input.diagnosis, input.joinUrl]) assert.equal(sms.includes(sensitive), false);
  assert.ok(sms.includes(input.date)); assert.ok(sms.includes(input.clinicianName));
});
test('unregistered module keys fail closed and office-manager duties remain with DIRECTOR', () => {
  for (const role of ['ADMIN', 'DIRECTOR', 'THERAPIST', 'FRONT_DESK', 'PEER_SUPPORT'] as const) assert.equal(canUseClinicModule(role, 'unregistered-sensitive-records'), false);
  assert.equal(canUseClinicModule('DIRECTOR', 'grievances'), true);
  assert.equal(canUseClinicModule('PEER_SUPPORT', 'grievances'), false);
  assert.equal(canUseClinicModule('FRONT_DESK', 'hr-training-staff'), false);
});
test('notes cannot regress or skip signature; retries are idempotent', () => {
  assert.deepEqual(noteTransition('LOCKED', 'SIGNED'), { allowed: false, changed: false });
  assert.equal(noteTransition('DRAFT', 'LOCKED').allowed, true);
  assert.equal(noteTransition('DRAFT', 'LOCKED').changed, true);
  assert.equal(noteTransition('DRAFT', 'SIGNED').changed, true);
  assert.equal(noteTransition('SIGNED', 'LOCKED').changed, true);
  assert.deepEqual(noteTransition('LOCKED', 'LOCKED'), { allowed: true, changed: false });
});
