import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeToE164 } from '../src/lib/sms/phone';

test('normalizes US 10-digit and already-E.164 phones', () => {
  assert.equal(normalizeToE164('(410) 555-0100'), '+14105550100');
  assert.equal(normalizeToE164('14105550100'), '+14105550100');
  assert.equal(normalizeToE164('+1 410-555-0100'), '+14105550100');
  assert.equal(normalizeToE164(''), null);
  assert.equal(normalizeToE164('123'), null);
});
