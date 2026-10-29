/**
 * §15 acceptance smoke for Oct 21 owner decisions + key surfaces (unit-level).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { VISIT_KIND_LIST } from '../src/lib/visits/kinds';
import { CONFIRMED_BY_PRACTICE_BADGE } from '../src/lib/visits/guide-catalog';
import { DEFAULT_GO_LIVE_DATE, TREATMENT_PLAN_PENDING_LABEL } from '../src/lib/practice/clinical-settings';
import { STANDING_ORDER_SEED } from '../src/lib/medical/standing-orders';
import { defaultOvernightEligibilitySettings } from '../src/lib/eligibility/overnight-settings';
import { HUDDLE_CHECKLIST_LABELS } from '../src/lib/front-desk/huddle-checklist';
import { INTENSIVE_HUB_TABS } from '../src/lib/programs/intensive-hub';
import { PRODUCT_TTYS } from '../src/lib/rxnorm/rxnav-client';

const root = join(process.cwd());

test('§15: Visit Guide kinds + MD confirmation badge', () => {
  assert.ok(VISIT_KIND_LIST.length >= 23);
  assert.equal(CONFIRMED_BY_PRACTICE_BADGE, 'Confirmed by practice 2026-10-21');
});

test('§15: go-live Nov 1 + TP transition label', () => {
  assert.equal(DEFAULT_GO_LIVE_DATE, '2026-11-01');
  assert.equal(TREATMENT_PLAN_PENDING_LABEL, 'Treatment plan pending (go-live transition)');
});

test('§15: standing orders draft seed + nightly eligibility off', () => {
  assert.equal(STANDING_ORDER_SEED.length, 6);
  assert.ok(STANDING_ORDER_SEED.every((o) => o.status === 'draft'));
  assert.equal(defaultOvernightEligibilitySettings().enabled, false);
});

test('§15: Front Desk checklist + IOP hub tabs', () => {
  assert.equal(HUDDLE_CHECKLIST_LABELS.length, 20);
  assert.equal(INTENSIVE_HUB_TABS.length, 7);
});

test('§15: RxNorm product TTYs + deploy artifacts present', () => {
  assert.ok(PRODUCT_TTYS.has('SCD') && PRODUCT_TTYS.has('SBD'));
  assert.ok(existsSync(join(root, 'buildspec.staging.yml')));
  assert.ok(existsSync(join(root, 'deploy-prebuilt.staging.sh')));
  assert.ok(existsSync(join(root, 'deploy/codebuild/README.md')));
});
