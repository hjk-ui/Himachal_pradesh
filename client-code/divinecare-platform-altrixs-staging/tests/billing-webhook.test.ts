import assert from 'node:assert/strict';
import { test } from 'node:test';
import Stripe from 'stripe';
import { emptyRecord, newTrialRecord, type OrgSubscriptionRecord } from '../src/lib/billing/subscriptionRecord';
import { organizationIdFromEvent, reduceStripeEvent, type StripeEventLike } from '../src/lib/stripe/events';
import { verifyStripeSignature } from '../src/lib/stripe/signature';
import type { PriceLookup } from '../src/lib/stripe/config';

const NOW = new Date('2026-11-01T12:00:00Z');
const T0 = Math.floor(NOW.getTime() / 1000);

const PRICES: Record<string, PriceLookup> = {
  price_pro_m: { kind: 'seat', tier: 'professional', seat: 'clinician', interval: 'month' },
  price_pro_rx_m: { kind: 'seat', tier: 'professional', seat: 'prescriber', interval: 'month' },
  price_clinic_y: { kind: 'seat', tier: 'clinic', seat: 'clinician', interval: 'year' },
  price_ai_m: { kind: 'addon', addOn: 'ai_scribe', interval: 'month' },
  price_loc_m: { kind: 'addon', addOn: 'additional_location', interval: 'month' },
  price_legacy_erx: { kind: 'legacy_addon', addOn: 'eprescribing', interval: 'month' },
  price_legacy_pro: { kind: 'tier', tier: 'professional', interval: 'month' },
};
const lookup = (id: string | null) => (id ? PRICES[id] ?? null : null);

function ev(id: string, type: string, created: number, object: Record<string, unknown>): StripeEventLike {
  return { id, type, created, data: { object } };
}

function sub(status: string, items: { price: string; quantity: number }[], extra: Record<string, unknown> = {}) {
  return {
    id: 'sub_1',
    object: 'subscription',
    customer: 'cus_1',
    status,
    cancel_at_period_end: false,
    cancel_at: null,
    trial_end: null,
    metadata: { organizationId: 'org_1', tier: 'professional', interval: 'month' },
    items: { data: items.map((i, n) => ({ id: `si_${n}`, price: { id: i.price }, quantity: i.quantity, current_period_end: T0 + 30 * 86400 })) },
    ...extra,
  };
}

test('checkout + subscription.created sets tier, seats, add-ons, period end', () => {
  let r: OrgSubscriptionRecord = newTrialRecord('professional', NOW);
  r = reduceStripeEvent(r, ev('evt_1', 'checkout.session.completed', T0, {
    mode: 'subscription', customer: 'cus_1', subscription: 'sub_1', client_reference_id: 'org_1',
    metadata: { organizationId: 'org_1', tier: 'professional', interval: 'month', trial: 'false' },
  }), lookup, NOW).record;
  assert.equal(r.status, 'active');
  assert.equal(r.stripeSubscriptionId, 'sub_1');
  const created = reduceStripeEvent(r, ev('evt_2', 'customer.subscription.created', T0 + 1,
    sub('active', [
      { price: 'price_pro_m', quantity: 4 },
      { price: 'price_pro_rx_m', quantity: 2 },
      { price: 'price_ai_m', quantity: 3 },
      { price: 'price_loc_m', quantity: 1 },
    ])), lookup, NOW);
  assert.equal(created.outcome, 'applied');
  r = created.record;
  assert.equal(r.tier, 'professional');
  assert.equal(r.seatsPaid, 6, 'seats paid = all seat lines');
  assert.deepEqual(r.seatsByType, { prescriber: 2, clinician: 4, paraprofessional: 0 });
  assert.deepEqual(r.addOns, { eprescribing: 0, ai_scribe: 3, additional_location: 1 });
  assert.equal(r.currentPeriodEnd, new Date((T0 + 30 * 86400) * 1000).toISOString());
  assert.equal(r.trialEndsAt, null);
});

test('duplicate event ids are skipped (idempotent)', () => {
  const start = emptyRecord(NOW);
  const e = ev('evt_dup', 'customer.subscription.updated', T0, sub('past_due', [{ price: 'price_pro_m', quantity: 3 }]));
  const first = reduceStripeEvent(start, e, lookup, NOW);
  assert.equal(first.outcome, 'applied');
  assert.equal(first.record.status, 'past_due');
  const second = reduceStripeEvent(first.record, e, lookup, new Date(NOW.getTime() + 60_000));
  assert.equal(second.outcome, 'duplicate');
  assert.deepEqual(second.record, first.record, 'record unchanged by a replay');
});

test('out-of-order subscription events do not roll the state back', () => {
  let r = emptyRecord(NOW);
  r = reduceStripeEvent(r, ev('evt_new', 'customer.subscription.updated', T0 + 100, sub('active', [{ price: 'price_clinic_y', quantity: 9 }])), lookup, NOW).record;
  const old = reduceStripeEvent(r, ev('evt_old', 'customer.subscription.updated', T0 + 10, sub('past_due', [{ price: 'price_pro_m', quantity: 3 }])), lookup, NOW);
  assert.equal(old.outcome, 'stale');
  assert.equal(old.record.status, 'active');
  assert.equal(old.record.tier, 'clinic');
  assert.equal(old.record.seatsPaid, 9);
  assert.ok(old.record.processedEventIds.includes('evt_old'));
});

test('events for an old subscription never downgrade the current one', () => {
  let r = emptyRecord(NOW);
  r = reduceStripeEvent(r, ev('evt_a', 'customer.subscription.updated', T0, sub('active', [{ price: 'price_pro_m', quantity: 3 }])), lookup, NOW).record;
  const other = reduceStripeEvent(r, ev('evt_b', 'customer.subscription.deleted', T0 + 5, { ...sub('canceled', []), id: 'sub_OLD' }), lookup, NOW);
  assert.equal(other.outcome, 'ignored');
  assert.equal(other.record.status, 'active');
});

test('payment failed -> past_due with grace start; invoice paid -> active', () => {
  let r = emptyRecord(NOW);
  r = reduceStripeEvent(r, ev('evt_1', 'customer.subscription.updated', T0, sub('active', [{ price: 'price_pro_m', quantity: 3 }])), lookup, NOW).record;
  const invoice = { object: 'invoice', customer: 'cus_1', parent: { subscription_details: { subscription: 'sub_1', metadata: { organizationId: 'org_1' } } } };
  r = reduceStripeEvent(r, ev('evt_2', 'invoice.payment_failed', T0 + 10, invoice), lookup, NOW).record;
  assert.equal(r.status, 'past_due');
  assert.equal(r.pastDueSince, new Date((T0 + 10) * 1000).toISOString());
  // A second failure does not restart the grace period.
  r = reduceStripeEvent(r, ev('evt_3', 'invoice.payment_failed', T0 + 99999, invoice), lookup, NOW).record;
  assert.equal(r.pastDueSince, new Date((T0 + 10) * 1000).toISOString());
  r = reduceStripeEvent(r, ev('evt_4', 'invoice.paid', T0 + 100000, invoice), lookup, NOW).record;
  assert.equal(r.status, 'active');
  assert.equal(r.pastDueSince, null);
  assert.equal(organizationIdFromEvent(ev('x', 'invoice.paid', T0, invoice)), 'org_1');
});

test('subscription deleted -> canceled; comped org stays comped', () => {
  let r = emptyRecord(NOW);
  r = reduceStripeEvent(r, ev('evt_1', 'customer.subscription.updated', T0, sub('active', [{ price: 'price_pro_m', quantity: 3 }])), lookup, NOW).record;
  const del = reduceStripeEvent(r, ev('evt_2', 'customer.subscription.deleted', T0 + 5, sub('canceled', [{ price: 'price_pro_m', quantity: 3 }], { ended_at: T0 + 5 })), lookup, NOW);
  assert.equal(del.record.status, 'canceled');
  const comped = { ...emptyRecord(NOW), status: 'comped' as const };
  const c = reduceStripeEvent(comped, ev('evt_3', 'customer.subscription.updated', T0, sub('unpaid', [{ price: 'price_pro_m', quantity: 3 }])), lookup, NOW);
  assert.equal(c.record.status, 'comped');
  assert.equal(c.record.stripeSubscriptionId, 'sub_1');
});

test('webhook signature: valid accepted, tampered / wrong secret / missing rejected (no network)', () => {
  const stripe = new Stripe('sk_test_dummy_for_signature_only');
  const secret = 'whsec_test_secret';
  const payload = JSON.stringify({ id: 'evt_sig', object: 'event', type: 'invoice.paid', created: T0, data: { object: {} } });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
  const ok = verifyStripeSignature(stripe, payload, header, secret);
  assert.equal(ok.ok, true);
  assert.equal(verifyStripeSignature(stripe, payload.replace('invoice.paid', 'invoice.payment_failed'), header, secret).ok, false);
  assert.equal(verifyStripeSignature(stripe, payload, header, 'whsec_other').ok, false);
  assert.equal(verifyStripeSignature(stripe, payload, null, secret).ok, false);
  assert.equal(verifyStripeSignature(stripe, payload, 't=1,v1=deadbeef', secret).ok, false);
});

test('model v1 (legacy) prices still resolve: per-seat tier line = clinician seats, eRx add-on recorded', () => {
  const r = reduceStripeEvent(emptyRecord(NOW), ev('evt_v1', 'customer.subscription.updated', T0,
    sub('active', [{ price: 'price_legacy_pro', quantity: 5 }, { price: 'price_legacy_erx', quantity: 2 }])), lookup, NOW).record;
  assert.equal(r.tier, 'professional');
  assert.equal(r.seatsPaid, 5);
  assert.deepEqual(r.seatsByType, { prescriber: 0, clinician: 5, paraprofessional: 0 });
  assert.equal(r.addOns.eprescribing, 2);
});
