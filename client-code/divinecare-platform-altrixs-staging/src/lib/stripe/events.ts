/**
 * Pure reducer: Stripe webhook event + current org record -> next org record.
 *
 * No I/O, so idempotency and ordering rules are unit-tested (tests/billing-webhook.test.ts).
 *  - Duplicate event ids are skipped (Stripe retries and may deliver twice).
 *  - Subscription events older than the newest one applied are skipped (out-of-order delivery).
 *  - Events for a different subscription than the one on file never downgrade the org.
 *  - A comped org keeps status 'comped' whatever Stripe says (ids are still recorded).
 */
import {
  MAX_PROCESSED_EVENT_IDS,
  emptyAddOns,
  statusFromStripe,
  type OrgSubscriptionRecord,
} from '@/lib/billing/subscriptionRecord';
import { billableSeatsOf, emptySeats, isTierId, type BillingInterval, type SeatQuantities } from '@/lib/billing/plans';
import type { PriceLookup } from './config';

/** The subset of a Stripe event we read (structurally compatible with Stripe.Event). */
export type StripeEventLike = {
  id: string;
  type: string;
  created: number;
  data: { object: Record<string, unknown> };
};

export type ReduceResult =
  | { outcome: 'applied'; record: OrgSubscriptionRecord }
  | { outcome: 'duplicate' | 'stale' | 'ignored'; record: OrgSubscriptionRecord; reason: string };

export const HANDLED_EVENT_TYPES = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
] as const;

function idOf(v: unknown): string | null {
  if (typeof v === 'string') return v || null;
  if (v && typeof v === 'object' && typeof (v as { id?: unknown }).id === 'string') return (v as { id: string }).id;
  return null;
}

function iso(unix: unknown): string | null {
  return typeof unix === 'number' && Number.isFinite(unix) ? new Date(unix * 1000).toISOString() : null;
}

function meta(obj: Record<string, unknown>): Record<string, string> {
  const m = obj.metadata;
  return m && typeof m === 'object' ? (m as Record<string, string>) : {};
}

/** Organization id carried by an event object (metadata, client_reference_id, invoice parent). */
export function organizationIdFromEvent(event: StripeEventLike): string | null {
  const obj = event.data.object;
  const direct = meta(obj).organizationId?.trim();
  if (direct) return direct;
  if (typeof obj.client_reference_id === 'string' && obj.client_reference_id.trim()) {
    return obj.client_reference_id.trim();
  }
  const parent = obj.parent as { subscription_details?: { metadata?: Record<string, string> } } | null | undefined;
  const fromInvoice = parent?.subscription_details?.metadata?.organizationId?.trim();
  return fromInvoice || null;
}

export function customerIdFromEvent(event: StripeEventLike): string | null {
  return idOf(event.data.object.customer);
}

function subscriptionIdOfInvoice(obj: Record<string, unknown>): string | null {
  const parent = obj.parent as { subscription_details?: { subscription?: unknown } } | null | undefined;
  return idOf(parent?.subscription_details?.subscription) || idOf(obj.subscription);
}

function remember(record: OrgSubscriptionRecord, eventId: string): string[] {
  return [...record.processedEventIds, eventId].slice(-MAX_PROCESSED_EVENT_IDS);
}

function applySubscription(
  record: OrgSubscriptionRecord,
  sub: Record<string, unknown>,
  event: StripeEventLike,
  lookup: (priceId: string | null) => PriceLookup | null,
  now: Date
): OrgSubscriptionRecord {
  const deleted = event.type === 'customer.subscription.deleted';
  const items = ((sub.items as { data?: unknown[] } | undefined)?.data || []) as Record<string, unknown>[];
  let tier = record.tier;
  let interval: BillingInterval = record.interval;
  let seats: number | null = record.seatsPaid;
  const byType: SeatQuantities = emptySeats();
  const addOns = emptyAddOns();
  let periodEnd: number | null = null;
  let sawTier = false;
  for (const item of items) {
    const priceId = idOf(item.price);
    const found = lookup(priceId);
    const qty = typeof item.quantity === 'number' ? item.quantity : 1;
    if (typeof item.current_period_end === 'number') {
      periodEnd = Math.max(periodEnd ?? 0, item.current_period_end);
    }
    if (found?.kind === 'seat') {
      tier = found.tier;
      interval = found.interval;
      byType[found.seat] += qty;
      sawTier = true;
    } else if (found?.kind === 'tier') {
      // Model v1 price: one per-seat line, treated as clinician seats.
      tier = found.tier;
      interval = found.interval;
      byType.clinician += qty;
      sawTier = true;
    } else if (found?.kind === 'addon') {
      addOns[found.addOn] += qty;
    } else if (found?.kind === 'legacy_addon') {
      addOns[found.addOn] += qty;
    }
  }
  if (sawTier) seats = billableSeatsOf(byType);
  if (!sawTier) {
    const m = meta(sub);
    if (isTierId(m.tier)) tier = m.tier;
    if (m.interval === 'year' || m.interval === 'month') interval = m.interval;
  }
  const stripeStatus = deleted ? 'canceled' : typeof sub.status === 'string' ? sub.status : null;
  let status = statusFromStripe(stripeStatus);
  if (record.status === 'comped') status = 'comped';
  const pastDueSince =
    status === 'past_due'
      ? record.pastDueSince || iso(event.created) || now.toISOString()
      : status === 'unpaid'
        ? record.pastDueSince
        : null;
  return {
    ...record,
    tier,
    interval,
    status,
    seatsPaid: seats,
    seatsByType: sawTier ? byType : record.seatsByType,
    addOns,
    trialEndsAt: iso(sub.trial_end) ?? (status === 'trialing' ? record.trialEndsAt : null),
    currentPeriodEnd: iso(deleted ? sub.ended_at ?? periodEnd : periodEnd) ?? record.currentPeriodEnd,
    cancelAtPeriodEnd: !deleted && (sub.cancel_at_period_end === true || typeof sub.cancel_at === 'number'),
    pastDueSince,
    stripeCustomerId: idOf(sub.customer) || record.stripeCustomerId,
    stripeSubscriptionId: idOf(sub.id) || record.stripeSubscriptionId,
    lastStripeEventAt: Math.max(record.lastStripeEventAt ?? 0, event.created),
  };
}

export function reduceStripeEvent(
  current: OrgSubscriptionRecord,
  event: StripeEventLike,
  lookup: (priceId: string | null) => PriceLookup | null,
  now: Date = new Date()
): ReduceResult {
  if (current.processedEventIds.includes(event.id)) {
    return { outcome: 'duplicate', record: current, reason: 'event already processed' };
  }
  const obj = event.data.object;
  const stamp = (r: OrgSubscriptionRecord): OrgSubscriptionRecord => ({
    ...r,
    processedEventIds: remember(r, event.id),
    updatedAt: now.toISOString(),
  });

  switch (event.type) {
    case 'checkout.session.completed': {
      if (obj.mode !== 'subscription') {
        return { outcome: 'ignored', record: stamp(current), reason: 'not a subscription checkout' };
      }
      const m = meta(obj);
      const subId = idOf(obj.subscription);
      const next: OrgSubscriptionRecord = {
        ...current,
        stripeCustomerId: idOf(obj.customer) || current.stripeCustomerId,
        stripeSubscriptionId: subId || current.stripeSubscriptionId,
        tier: isTierId(m.tier) ? m.tier : current.tier,
        interval: m.interval === 'year' ? 'year' : m.interval === 'month' ? 'month' : current.interval,
      };
      // Only move status if no subscription event has set it yet (they may arrive first).
      if (current.status !== 'comped' && current.lastStripeEventAt === null) {
        next.status = m.trial === 'true' ? 'trialing' : 'active';
        next.pastDueSince = null;
      }
      return { outcome: 'applied', record: stamp(next) };
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const subId = idOf(obj.id);
      if (
        current.stripeSubscriptionId &&
        subId &&
        subId !== current.stripeSubscriptionId &&
        ['active', 'trialing', 'past_due'].includes(current.status) &&
        event.type !== 'customer.subscription.created'
      ) {
        return { outcome: 'ignored', record: stamp(current), reason: 'event for a different subscription' };
      }
      if (current.lastStripeEventAt !== null && event.created < current.lastStripeEventAt) {
        return { outcome: 'stale', record: stamp(current), reason: 'older than last applied subscription event' };
      }
      return { outcome: 'applied', record: stamp(applySubscription(current, obj, event, lookup, now)) };
    }
    case 'invoice.paid': {
      const subId = subscriptionIdOfInvoice(obj);
      if (!subId || (current.stripeSubscriptionId && subId !== current.stripeSubscriptionId)) {
        return { outcome: 'ignored', record: stamp(current), reason: 'invoice is not for the current subscription' };
      }
      const next = { ...current };
      if (current.status === 'past_due' || current.status === 'unpaid' || current.status === 'incomplete') {
        next.status = 'active';
      }
      next.pastDueSince = null;
      return { outcome: 'applied', record: stamp(next) };
    }
    case 'invoice.payment_failed': {
      const subId = subscriptionIdOfInvoice(obj);
      if (!subId || (current.stripeSubscriptionId && subId !== current.stripeSubscriptionId)) {
        return { outcome: 'ignored', record: stamp(current), reason: 'invoice is not for the current subscription' };
      }
      const next = { ...current };
      if (current.status === 'active' || current.status === 'trialing') next.status = 'past_due';
      if (next.status === 'past_due' && !next.pastDueSince) next.pastDueSince = iso(event.created) || now.toISOString();
      return { outcome: 'applied', record: stamp(next) };
    }
    default:
      return { outcome: 'ignored', record: current, reason: `unhandled event type ${event.type}` };
  }
}
