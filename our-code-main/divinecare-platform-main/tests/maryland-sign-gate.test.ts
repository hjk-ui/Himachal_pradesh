import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_GO_LIVE_DATE,
  goLiveTransitionEnd,
  isWithinGoLiveTransition,
  TREATMENT_PLAN_PENDING_LABEL,
  treatmentPlanReviewMaxDays,
} from '../src/lib/practice/clinical-settings';
import { validatePlanReviewDate, addCalendarDays, clinicDate } from '../src/lib/workflows/dates';

test('go-live defaults to 2026-11-01 and transition ends ~2026-12-01', () => {
  assert.equal(DEFAULT_GO_LIVE_DATE, '2026-11-01');
  assert.equal(goLiveTransitionEnd(DEFAULT_GO_LIVE_DATE), '2026-12-01');
  assert.equal(TREATMENT_PLAN_PENDING_LABEL, 'Treatment plan pending (go-live transition)');
});

test('within go-live transition before end date', () => {
  assert.equal(isWithinGoLiveTransition(DEFAULT_GO_LIVE_DATE, new Date('2026-11-15T12:00:00Z')), true);
  assert.equal(isWithinGoLiveTransition(DEFAULT_GO_LIVE_DATE, new Date('2026-12-02T12:00:00Z')), false);
});

test('ITP review max days adult 180 / under-18 90', () => {
  assert.equal(treatmentPlanReviewMaxDays(false), 180);
  assert.equal(treatmentPlanReviewMaxDays(true), 90);
  const today = clinicDate(new Date('2026-10-27T12:00:00Z'));
  const adultOk = validatePlanReviewDate(addCalendarDays(today, 120), new Date('2026-10-27T12:00:00Z'), 180);
  assert.equal(adultOk.ok, true);
  const minorReject = validatePlanReviewDate(addCalendarDays(today, 120), new Date('2026-10-27T12:00:00Z'), 90);
  assert.equal(minorReject.ok, false);
});
