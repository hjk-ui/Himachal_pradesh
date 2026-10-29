import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FEATURE_IDS, PAST_DUE_GRACE_DAYS, TRIAL_DAYS } from '../src/lib/billing/plans';
import {
  LAUNCH_CUSTOMER_ORG_IDS,
  compedOrgIds,
  hasFeature,
  resolveAccess,
} from '../src/lib/billing/entitlements';
import { emptyRecord, newTrialRecord, normalizeRecord, type OrgSubscriptionRecord } from '../src/lib/billing/subscriptionRecord';

const MDBH = 'cmva1hmq6000090ohpo38undp';
const NOW = new Date('2026-11-01T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const none = new Set<string>();

function rec(patch: Partial<OrgSubscriptionRecord>): OrgSubscriptionRecord {
  return { ...emptyRecord(NOW), ...patch };
}

test('MD Behavioral Health is always comped: every feature, never read-only, whatever the record says', () => {
  assert.ok(LAUNCH_CUSTOMER_ORG_IDS.includes(MDBH));
  const worst: Partial<OrgSubscriptionRecord>[] = [
    { status: 'canceled', tier: 'starter' },
    { status: 'unpaid', tier: 'starter' },
    { status: 'past_due', tier: 'starter', pastDueSince: new Date(NOW.getTime() - 90 * DAY).toISOString() },
    { status: 'trialing', tier: 'starter', trialEndsAt: new Date(NOW.getTime() - DAY).toISOString() },
    { status: 'incomplete', tier: null },
  ];
  for (const patch of worst) {
    const access = resolveAccess(MDBH, rec(patch), { now: NOW, comped: compedOrgIds({}) });
    assert.equal(access.status, 'comped');
    assert.equal(access.canWrite, true);
    assert.equal(access.mode, 'full');
    assert.equal(access.banner, null);
    for (const f of FEATURE_IDS) assert.equal(hasFeature(access, f), true, `MDBH ${f}`);
  }
});

test('comped via env list or record status is never locked', () => {
  const env = compedOrgIds({ BILLING_COMPED_ORG_IDS: ' org_a , org_b ' });
  assert.ok(env.has('org_a') && env.has('org_b') && env.has(MDBH));
  const viaEnv = resolveAccess('org_b', rec({ status: 'canceled', tier: 'starter' }), { now: NOW, comped: env });
  assert.equal(viaEnv.canWrite, true);
  const viaRecord = resolveAccess('org_c', rec({ status: 'comped', tier: null }), { now: NOW, comped: none });
  assert.equal(viaRecord.canWrite, true);
  assert.ok(FEATURE_IDS.every((f) => hasFeature(viaRecord, f)));
});

test('orgs with no record or a legacy record are grandfathered with full access', () => {
  for (const raw of [null, undefined, {}, [], 'junk', { plan: 'free', billingCycle: 'monthly' }, { plan: 'solo' }]) {
    const r = normalizeRecord(raw, NOW);
    assert.equal(r.status, 'grandfathered', JSON.stringify(raw));
    const access = resolveAccess('org_legacy', r, { now: NOW, comped: none });
    assert.equal(access.canWrite, true);
    assert.equal(access.unlimited, true);
    assert.ok(FEATURE_IDS.every((f) => hasFeature(access, f)));
  }
  // A legacy record that does carry a live Stripe subscription keeps its status.
  const paid = normalizeRecord({ plan: 'practice', stripeSubscriptionId: 'sub_1', stripeStatus: 'active', stripeCustomerId: 'cus_1' }, NOW);
  assert.equal(paid.status, 'active');
  assert.equal(paid.tier, 'professional');
});

test('trial: full tier access with AI Scribe, then read-only after the trial ends', () => {
  const trial = newTrialRecord('starter', NOW);
  assert.equal(new Date(trial.trialEndsAt!).getTime() - NOW.getTime(), TRIAL_DAYS * DAY);
  const during = resolveAccess('org_t', trial, { now: NOW, comped: none });
  assert.equal(during.canWrite, true);
  assert.equal(hasFeature(during, 'ai_scribe'), true, 'trial includes AI Scribe');
  assert.equal(hasFeature(during, 'programs'), false, 'Starter trial does not include Clinic programs');
  assert.equal(hasFeature(during, 'eprescribing'), true, 'e-prescribing comes with prescriber seats (v2)');
  const nearEnd = resolveAccess('org_t', trial, { now: new Date(NOW.getTime() + (TRIAL_DAYS - 3) * DAY), comped: none });
  assert.equal(nearEnd.banner?.tone, 'warning');
  const after = resolveAccess('org_t', trial, { now: new Date(NOW.getTime() + (TRIAL_DAYS + 1) * DAY), comped: none });
  assert.equal(after.mode, 'read_only');
  assert.equal(after.canWrite, false);
  assert.equal(after.banner?.tone, 'danger');
  // A Stripe-managed trial past its date follows Stripe (webhook lag must not lock the clinic).
  const stripeTrial = resolveAccess('org_t', { ...trial, stripeSubscriptionId: 'sub_1' }, { now: new Date(NOW.getTime() + (TRIAL_DAYS + 1) * DAY), comped: none });
  assert.equal(stripeTrial.canWrite, true);
});

test('past_due: full access during the grace period, read-only after it', () => {
  const since = NOW.toISOString();
  const r = rec({ status: 'past_due', tier: 'professional', pastDueSince: since });
  const inGrace = resolveAccess('org_p', r, { now: new Date(NOW.getTime() + (PAST_DUE_GRACE_DAYS - 1) * DAY), comped: none });
  assert.equal(inGrace.mode, 'grace');
  assert.equal(inGrace.canWrite, true);
  assert.equal(inGrace.banner?.tone, 'warning');
  const after = resolveAccess('org_p', r, { now: new Date(NOW.getTime() + (PAST_DUE_GRACE_DAYS + 1) * DAY), comped: none });
  assert.equal(after.mode, 'read_only');
  assert.equal(after.canWrite, false);
  // Read-only keeps feature visibility (view and export still work).
  assert.equal(hasFeature(after, 'claims_era'), true);
});

test('canceled and unpaid are read-only; active is full', () => {
  assert.equal(resolveAccess('o', rec({ status: 'canceled', tier: 'clinic' }), { now: NOW, comped: none }).canWrite, false);
  assert.equal(resolveAccess('o', rec({ status: 'unpaid', tier: 'clinic' }), { now: NOW, comped: none }).canWrite, false);
  const active = resolveAccess('o', rec({ status: 'active', tier: 'clinic' }), { now: NOW, comped: none });
  assert.equal(active.canWrite, true);
  assert.equal(active.banner, null);
  const ending = resolveAccess('o', rec({ status: 'active', tier: 'clinic', cancelAtPeriodEnd: true, currentPeriodEnd: NOW.toISOString() }), { now: NOW, comped: none });
  assert.equal(ending.banner?.tone, 'info');
});

test('tier and add-on gating (model v2)', () => {
  const starter = resolveAccess('o', rec({ status: 'active', tier: 'starter' }), { now: NOW, comped: none });
  assert.equal(hasFeature(starter, 'telehealth'), true);
  assert.equal(hasFeature(starter, 'claims_era'), true);
  assert.equal(hasFeature(starter, 'eprescribing'), true, 'e-prescribing comes with prescriber seats on every tier');
  assert.equal(hasFeature(starter, 'multi_location'), false);
  assert.equal(hasFeature(starter, 'ai_insights'), false);
  assert.equal(hasFeature(starter, 'ai_scribe'), false);
  const withScribe = resolveAccess('o', rec({ status: 'active', tier: 'starter', addOns: { eprescribing: 0, ai_scribe: 1, additional_location: 0 } }), { now: NOW, comped: none });
  assert.equal(hasFeature(withScribe, 'ai_scribe'), true);
  const pro = resolveAccess('o', rec({ status: 'active', tier: 'professional' }), { now: NOW, comped: none });
  assert.equal(hasFeature(pro, 'multi_location'), true, 'Professional includes 2 locations');
  assert.equal(hasFeature(pro, 'ai_insights'), true);
  assert.equal(hasFeature(pro, 'denials_prior_auth'), true);
  assert.equal(hasFeature(pro, 'programs'), false);
  assert.equal(hasFeature(pro, 'primary_care'), false);
  const clinic = resolveAccess('o', rec({ status: 'active', tier: 'clinic' }), { now: NOW, comped: none });
  assert.equal(hasFeature(clinic, 'programs'), true);
  assert.equal(hasFeature(clinic, 'primary_care'), true);
  assert.equal(hasFeature(clinic, 'part2_tools'), true);
  assert.equal(hasFeature(clinic, 'custom_integrations'), false);
  assert.equal(hasFeature(clinic, 'ai_scribe'), false, 'AI Scribe is per user even on Clinic');
  const enterprise = resolveAccess('o', rec({ status: 'active', tier: 'enterprise' }), { now: NOW, comped: none });
  assert.equal(hasFeature(enterprise, 'custom_integrations'), true);
  // Trials can evaluate AI Scribe without buying it.
  const trial = resolveAccess('o', newTrialRecord('clinic', NOW), { now: NOW, comped: none });
  assert.equal(hasFeature(trial, 'ai_scribe'), true);
});

test('MD Behavioral Health stays comped under model v2, even with a v2 record that has no add-ons', () => {
  const r = normalizeRecord({ schema: 2, tier: 'starter', status: 'canceled', seatsByType: { prescriber: 0, clinician: 1, paraprofessional: 0 } }, NOW);
  assert.deepEqual(r.addOns, { eprescribing: 0, ai_scribe: 0, additional_location: 0 });
  assert.deepEqual(r.seatsByType, { prescriber: 0, clinician: 1, paraprofessional: 0 });
  const access = resolveAccess(MDBH, r, { now: NOW, comped: compedOrgIds({}) });
  assert.equal(access.status, 'comped');
  assert.equal(access.canWrite, true);
  assert.ok(FEATURE_IDS.every((f) => hasFeature(access, f)));
});

test('records from before model v2 normalize without seatsByType and keep their add-ons', () => {
  const r = normalizeRecord({ schema: 2, tier: 'professional', status: 'active', seatsPaid: 4, addOns: { eprescribing: 2, ai_scribe: 4 } }, NOW);
  assert.equal(r.seatsByType, null);
  assert.deepEqual(r.addOns, { eprescribing: 2, ai_scribe: 4, additional_location: 0 });
});
