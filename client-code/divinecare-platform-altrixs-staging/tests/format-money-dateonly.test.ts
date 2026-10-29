import test from 'node:test';
import assert from 'node:assert/strict';
import { formatUsd, formatUsdCents } from '../src/lib/format/money';
import { formatDateOnly, parseDateOnly, weekdayOfDateOnly } from '../src/lib/time/dateOnly';

const DASH = '—';

test('formatUsd formats dollars en-US', () => {
  assert.equal(formatUsd(1234.5), '$1,234.50');
  assert.equal(formatUsd(0), '$0.00');
  assert.equal(formatUsd(150), '$150.00');
  assert.equal(formatUsd(150, { trimWholeDollars: true }), '$150');
  assert.equal(formatUsd(150.25, { trimWholeDollars: true }), '$150.25');
  assert.equal(formatUsd(-20), '-$20.00');
  assert.equal(formatUsd('1,200.10'), '$1,200.10');
  assert.equal(formatUsd(0.1 + 0.2), '$0.30');
  assert.equal(formatUsd(-0.001), '$0.00');
});

test('formatUsd falls back on missing or bad input', () => {
  assert.equal(formatUsd(null), DASH);
  assert.equal(formatUsd(undefined), DASH);
  assert.equal(formatUsd('abc'), DASH);
  assert.equal(formatUsd(Number.NaN, { fallback: 'N/A' }), 'N/A');
});

test('formatUsdCents takes integer cents', () => {
  assert.equal(formatUsdCents(123450), '$1,234.50');
  assert.equal(formatUsdCents(15000, { trimWholeDollars: true }), '$150');
  assert.equal(formatUsdCents(99.6), '$1.00');
  assert.equal(formatUsdCents(null), DASH);
});

test('formatDateOnly never shifts the day', () => {
  // new Date('2026-10-19') would render as Oct 18 in America/New_York
  assert.equal(formatDateOnly('2026-10-19'), 'Oct 19, 2026');
  assert.equal(formatDateOnly('2026-10-19', 'long'), 'Monday, October 19, 2026');
  assert.equal(formatDateOnly('2026-10-19', 'weekday'), 'Mon, Oct 19, 2026');
  assert.equal(formatDateOnly('2026-01-01', 'numeric'), '01/01/2026');
  assert.equal(formatDateOnly('1990-03-05', 'long'), 'Monday, March 5, 1990');
  assert.equal(formatDateOnly('2024-02-29', 'long'), 'Thursday, February 29, 2024');
  assert.equal(formatDateOnly('2000-01-01', 'long'), 'Saturday, January 1, 2000');
});

test('formatDateOnly matches Intl for a range of dates', () => {
  for (const iso of ['1970-01-01', '1999-12-31', '2026-03-08', '2026-11-01', '2030-07-04']) {
    const [y, m, d] = iso.split('-').map(Number);
    const intl = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
      timeZone: 'UTC',
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
    assert.equal(formatDateOnly(iso, 'long'), intl, iso);
  }
});

test('formatDateOnly rejects non-date-only input', () => {
  assert.equal(parseDateOnly('2026-02-30'), null);
  assert.equal(parseDateOnly('2026-13-01'), null);
  assert.equal(parseDateOnly('2026-10-19T04:00:00Z'), null);
  assert.equal(formatDateOnly('2026-02-30'), '2026-02-30');
  assert.equal(formatDateOnly(''), '');
  assert.equal(formatDateOnly(null), '');
  assert.equal(weekdayOfDateOnly({ year: 2026, month: 10, day: 18 }), 0);
});
