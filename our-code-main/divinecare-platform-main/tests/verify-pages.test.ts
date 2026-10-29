import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getSuggestedFrequency } from '../src/features/caseload';

test('Frequency Engine exported from caseload feature package', () => {
  assert.equal(typeof getSuggestedFrequency, 'function');
  const s = getSuggestedFrequency({
    diagnosis: 'Major Depressive Disorder',
    risk: 'low',
    totalSessions: 10,
  });
  assert.equal(s.sessionsPerMonth, 4);
  assert.equal(s.label, 'Weekly');
});
