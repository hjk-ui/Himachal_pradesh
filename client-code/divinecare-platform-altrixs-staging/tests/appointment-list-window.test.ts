import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { appointmentListWindow, defaultListRange } from '../src/lib/appointments/listWindow';

const TZ = 'America/New_York';
const NOW = new Date('2026-10-19T03:30:00Z'); // 11:30 PM Oct 18 in New York

test('default window: 90 days back through 365 ahead on the practice calendar', () => {
  assert.deepEqual(defaultListRange(TZ, NOW), { from: '2026-07-20', to: '2027-10-18' });
  const r = appointmentListWindow({}, TZ, NOW);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.window!.from, '2026-07-20');
    assert.equal(r.window!.to, '2027-10-18');
    // starts at New York midnight (EDT, UTC-4), ends at midnight after the last day (EDT in Oct 2027)
    assert.equal(r.window!.start.toISOString(), '2026-07-20T04:00:00.000Z');
    assert.equal(r.window!.end.toISOString(), '2027-10-19T04:00:00.000Z');
  }
});

test('clientId with no dates has no cap (chart history)', () => {
  assert.deepEqual(appointmentListWindow({ clientId: 'c1' }, TZ, NOW), { ok: true, window: null });
});

test('date= is one practice day; from/to inclusive; DST-safe', () => {
  const d = appointmentListWindow({ date: '2026-11-01' }, TZ, NOW);
  assert.equal(d.ok, true);
  if (d.ok) {
    assert.equal(d.window!.start.toISOString(), '2026-11-01T04:00:00.000Z');
    assert.equal(d.window!.end.toISOString(), '2026-11-02T05:00:00.000Z', '25-hour fall-back day');
  }
  const w = appointmentListWindow({ from: '2026-10-19', to: '2026-10-25', clientId: 'c1' }, TZ, NOW);
  assert.equal(w.ok, true);
  if (w.ok) assert.equal(w.window!.end.toISOString(), '2026-10-26T04:00:00.000Z');
});

test('bad ranges are refused', () => {
  assert.equal(appointmentListWindow({ from: '2026-10-25', to: '2026-10-19' }, TZ, NOW).ok, false);
  assert.equal(appointmentListWindow({ from: '10/19/2026' }, TZ, NOW).ok, false);
  assert.equal(appointmentListWindow({ from: '2020-01-01', to: '2026-12-31' }, TZ, NOW).ok, false);
});

test('calendar pages send their visible range', () => {
  const root = path.join(__dirname, '..');
  const page = fs.readFileSync(path.join(root, 'src/app/dashboard/appointments/page.tsx'), 'utf8');
  assert.match(page, /useAppointments\(visibleRange[,)]/);
  const sched = fs.readFileSync(path.join(root, 'src/app/dashboard/analytics/schedule/page.tsx'), 'utf8');
  assert.match(sched, /fetchAppointmentsWithZone\(rangeFrom && rangeTo/);
  assert.match(sched, /\[rangeFrom, rangeTo\]/);
});
