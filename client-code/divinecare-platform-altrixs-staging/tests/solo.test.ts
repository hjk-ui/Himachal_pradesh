import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rangesOverlap, slugifyPracticeName, uniqueSlugCandidate } from '../src/lib/solo/slug';

test('slugify maps practice names to public booking slugs', () => {
  assert.equal(slugifyPracticeName('Dr. Anita Patel Therapy'), 'dr-anita-patel-therapy');
  assert.equal(slugifyPracticeName('  Hello---World  '), 'hello-world');
});

test('slug collisions append -1 then -2', () => {
  assert.equal(uniqueSlugCandidate('dr-anita-patel-therapy', []), 'dr-anita-patel-therapy');
  assert.equal(uniqueSlugCandidate('dr-anita-patel-therapy', ['dr-anita-patel-therapy']), 'dr-anita-patel-therapy-1');
  assert.equal(uniqueSlugCandidate('dr-anita-patel-therapy', ['dr-anita-patel-therapy', 'dr-anita-patel-therapy-1']), 'dr-anita-patel-therapy-2');
});

test('appointment ranges overlap when they intersect', () => {
  const aStart = new Date('2026-08-18T10:00:00');
  const aEnd = new Date('2026-08-18T10:50:00');
  const bStart = new Date('2026-08-18T10:40:00');
  const bEnd = new Date('2026-08-18T11:30:00');
  const cStart = new Date('2026-08-18T10:50:00');
  const cEnd = new Date('2026-08-18T11:40:00');
  assert.equal(rangesOverlap(aStart, aEnd, bStart, bEnd), true);
  assert.equal(rangesOverlap(aStart, aEnd, cStart, cEnd), false);
});
