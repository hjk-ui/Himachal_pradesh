import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  HUDDLE_CHECKLIST_LABELS,
  HUDDLE_TAB_LABELS,
  HUDDLE_TABS,
  HUDDLE_EOD_TILES,
  readinessBadgeText,
  readinessFromDone,
} from '../src/lib/front-desk/huddle-checklist';
import { INTENSIVE_HUB_TABS } from '../src/lib/programs/intensive-hub';
import { defaultOvernightEligibilitySettings } from '../src/lib/eligibility/overnight-settings';

test('front desk huddle tabs and exact checklist labels', () => {
  assert.deepEqual([...HUDDLE_TABS], ['today', 'tomorrow', 'end_of_day']);
  assert.equal(HUDDLE_TAB_LABELS.today, 'Today');
  assert.equal(HUDDLE_TAB_LABELS.tomorrow, 'Tomorrow');
  assert.equal(HUDDLE_TAB_LABELS.end_of_day, 'End of day');
  assert.equal(HUDDLE_CHECKLIST_LABELS.length, 20);
  assert.equal(HUDDLE_CHECKLIST_LABELS[0], 'Appointment confirmed');
  assert.equal(HUDDLE_CHECKLIST_LABELS[19], 'Outreach logged');
  assert.ok(HUDDLE_CHECKLIST_LABELS.includes('Carelon attestation (Medicaid)'));
  assert.ok(HUDDLE_CHECKLIST_LABELS.includes('Photo ID and insurance card checked'));
});

test('readiness badges Ready / N to do / Resolve first / Cancelled', () => {
  assert.equal(readinessFromDone(20, 20, false), 'Ready');
  assert.equal(readinessFromDone(0, 20, false), 'Resolve first');
  assert.equal(readinessFromDone(5, 20, false), 'N to do');
  assert.equal(readinessFromDone(5, 20, true), 'Cancelled');
  assert.equal(readinessBadgeText('N to do', 3), '3 to do');
  assert.equal(HUDDLE_EOD_TILES.map((t) => t.label).join('|'), [
    'Seen',
    'No-shows/late cancels',
    'Not closed',
    'Notes not signed',
    'Copays posted',
    'Copays not posted',
  ].join('|'));
});

test('IOP/PHP hub tabs exact labels', () => {
  assert.equal(INTENSIVE_HUB_TABS.length, 7);
  assert.equal(INTENSIVE_HUB_TABS[0].label, "Today's roster");
  assert.equal(INTENSIVE_HUB_TABS[5].label, 'Program director');
  assert.equal(INTENSIVE_HUB_TABS[6].label, 'Program setup');
  assert.equal(INTENSIVE_HUB_TABS[5].leadershipOnly, true);
  assert.equal(INTENSIVE_HUB_TABS[6].leadershipOnly, true);
});

test('nightly eligibility defaults OFF', () => {
  const s = defaultOvernightEligibilitySettings();
  assert.equal(s.enabled, false);
  assert.equal(s.allowTestClearinghouse, false);
});
