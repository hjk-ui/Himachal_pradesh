import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CONSENT_REQUIRED_CODE,
  isCheckInStatus,
  CHECKIN_REQUIRED_CONSENT,
  CHECKIN_TELEHEALTH_CONSENT,
} from '../src/lib/consents/checkin-soft-stop';
import {
  NOTE_SIGN_DEADLINE_HOURS,
  NOTE_CLONE_WARN_SIMILARITY,
  isPastSignDeadline,
  noteCloneSimilarity,
  shouldWarnCloneSimilarity,
  requiresLateEntryReason,
} from '../src/lib/notes/notes-policy';

test('check-in status detection', () => {
  assert.equal(isCheckInStatus('CHECKED_IN'), true);
  assert.equal(isCheckInStatus('checked-in'), true);
  assert.equal(isCheckInStatus('SCHEDULED'), false);
});

test('consent soft-stop codes and required types', () => {
  assert.equal(CONSENT_REQUIRED_CODE, 'CONSENT_REQUIRED');
  assert.equal(CHECKIN_REQUIRED_CONSENT, 'informed-consent-treatment');
  assert.equal(CHECKIN_TELEHEALTH_CONSENT, 'telehealth-consent');
});

test('notes policy 72h deadline and clone warn at 85%', () => {
  assert.equal(NOTE_SIGN_DEADLINE_HOURS, 72);
  assert.equal(NOTE_CLONE_WARN_SIMILARITY, 0.85);
  const old = new Date(Date.now() - 80 * 60 * 60 * 1000);
  assert.equal(isPastSignDeadline(old), true);
  const late = requiresLateEntryReason(old, 'ab');
  assert.equal(late.ok, false);
  assert.equal(requiresLateEntryReason(old, 'Session note delayed due to coverage').ok, true);
  const a = 'Client reported low mood and used CBT thought records in session today carefully.';
  const b = 'Client reported low mood and used CBT thought records in session today carefully again.';
  assert.ok(noteCloneSimilarity(a, b) >= 0.85);
  assert.equal(shouldWarnCloneSimilarity(a, b), true);
});
