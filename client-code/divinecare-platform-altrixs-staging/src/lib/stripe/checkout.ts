import 'server-only';

import type Stripe from 'stripe';
import { prisma } from '@/lib/db/prisma';
import { TIERS, pricingApproved, type BillingInterval, type TierId } from '@/lib/billing/plans';
import {
  countOrgLocations,
  countOrgSeats,
  loadSubscriptionRecord,
  updateSubscriptionRecord,
} from '@/lib/billing/entitlementsServer';
import { compedOrgIds } from '@/lib/billing/entitlements';
import { getStripe } from './client';
import { buildLineItems, type BuiltLineItems } from './lineItems';
import { lookupPrice, publicAppUrl, seatSyncEnabled, stripeKeyMode } from './config';

type Fail = { ok: false; error: string; status: number };

const MIN_STRIPE_TRIAL_SECONDS = 48 * 60 * 60 + 300; // Checkout requires trial_end ≥ 48h out

function liveModeBlocked(): Fail | null {
  if (stripeKeyMode() === 'live' && !pricingApproved()) {
    return {
      ok: false,
      status: 409,
      error:
        'Pricing has not been approved yet (NEXT_PUBLIC_PRICING_APPROVED is not true), so live-mode Checkout is disabled.',
    };
  }
  return null;
}

export type CheckoutInput = {
  organizationId: string;
  tier: TierId;
  interval: BillingInterval;
  /** Clinicians licensed for AI Scribe (0 = none). */
  aiScribeUsers: number;
  includeOnboarding: boolean;
  includeDataMigration: boolean;
  customerEmail?: string | null;
  request?: Request;
};

/** Line items for the org's current active seats and locations. */
async function orgLineItems(
  organizationId: string,
  tier: TierId,
  interval: BillingInterval,
  opts: { aiScribeUsers: number; includeOnboarding: boolean; includeDataMigration: boolean }
): Promise<BuiltLineItems | Fail> {
  const [seats, locations] = await Promise.all([countOrgSeats(organizationId), countOrgLocations(organizationId)]);
  return buildLineItems({
    tier,
    interval,
    seats: seats.byType,
    locations,
    aiScribeUsers: opts.aiScribeUsers,
    includeOnboarding: opts.includeOnboarding,
    includeDataMigration: opts.includeDataMigration,
  });
}

export async function createSubscriptionCheckout(
  input: CheckoutInput
): Promise<{ ok: true; url: string } | Fail> {
  const stripe = getStripe();
  if (!stripe) return { ok: false, status: 503, error: 'Stripe is not configured on this server (STRIPE_SECRET_KEY).' };
  const blocked = liveModeBlocked();
  if (blocked) return blocked;
  if (compedOrgIds().has(input.organizationId)) {
    return { ok: false, status: 409, error: 'This organization is on a complimentary plan and is not billed.' };
  }
  if (!TIERS[input.tier].selfServe) {
    return { ok: false, status: 400, error: `${TIERS[input.tier].name} is quoted by sales. Contact us.` };
  }

  const { record } = await loadSubscriptionRecord(input.organizationId);
  if (record.status === 'comped') {
    return { ok: false, status: 409, error: 'This organization is on a complimentary plan and is not billed.' };
  }
  if (record.stripeSubscriptionId && ['active', 'trialing', 'past_due'].includes(record.status)) {
    return { ok: false, status: 409, error: 'This clinic already has a subscription. Use Change plan or Manage billing.' };
  }

  const built = await orgLineItems(input.organizationId, input.tier, input.interval, input);
  if ('ok' in built) return built;

  // Carry the remaining local trial into Stripe so the clinic is not charged early.
  let trialEnd: number | undefined;
  if (record.status === 'trialing' && record.trialEndsAt) {
    const t = Math.floor(new Date(record.trialEndsAt).getTime() / 1000);
    if (t - Math.floor(Date.now() / 1000) > MIN_STRIPE_TRIAL_SECONDS) trialEnd = t;
  }

  const base = publicAppUrl(input.request);
  const metadata = {
    organizationId: input.organizationId,
    tier: input.tier,
    interval: input.interval,
    pricingModel: 'v2',
    trial: trialEnd ? 'true' : 'false',
  };
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: built.items,
    success_url: `${base}/dashboard/subscription?checkout=success`,
    cancel_url: `${base}/dashboard/subscription?checkout=canceled`,
    client_reference_id: input.organizationId,
    customer: record.stripeCustomerId || undefined,
    customer_email: record.stripeCustomerId ? undefined : input.customerEmail || undefined,
    // Stripe does not allow promotion codes together with an explicit discount.
    ...(built.couponId ? { discounts: [{ coupon: built.couponId }] } : { allow_promotion_codes: true }),
    billing_address_collection: 'required',
    metadata,
    subscription_data: {
      metadata,
      ...(trialEnd ? { trial_end: trialEnd } : {}),
    },
  });
  if (!session.url) return { ok: false, status: 502, error: 'Stripe did not return a Checkout URL.' };
  return { ok: true, url: session.url };
}

export async function createPortalSession(input: {
  organizationId: string;
  request?: Request;
}): Promise<{ ok: true; url: string } | Fail> {
  const stripe = getStripe();
  if (!stripe) return { ok: false, status: 503, error: 'Stripe is not configured on this server (STRIPE_SECRET_KEY).' };
  const { record } = await loadSubscriptionRecord(input.organizationId);
  if (!record.stripeCustomerId) {
    return { ok: false, status: 409, error: 'No Stripe customer for this clinic yet. Choose a plan first.' };
  }
  const session = await stripe.billingPortal.sessions.create({
    customer: record.stripeCustomerId,
    return_url: `${publicAppUrl(input.request)}/dashboard/subscription`,
  });
  return { ok: true, url: session.url };
}

/**
 * Reconcile the subscription's recurring items with the wanted items: update quantities of prices
 * already present, add new prices, delete recurring items no longer wanted. One-time prices are
 * never part of an existing subscription and are skipped.
 */
function reconcileItems(sub: Stripe.Subscription, wanted: { price: string; quantity?: number }[]): Stripe.SubscriptionUpdateParams.Item[] {
  const existing = new Map(sub.items.data.map((item) => [item.price?.id, item]));
  const out: Stripe.SubscriptionUpdateParams.Item[] = [];
  const keep = new Set<string>();
  for (const w of wanted) {
    const kind = lookupPrice(w.price)?.kind;
    if (kind === 'onboarding' || kind === 'onboarding_location' || kind === 'data_migration') continue;
    keep.add(w.price);
    const item = existing.get(w.price);
    if (item) {
      if (w.quantity !== undefined && item.quantity !== w.quantity) out.push({ id: item.id, quantity: w.quantity });
    } else {
      out.push(w.quantity === undefined ? { price: w.price } : { price: w.price, quantity: w.quantity });
    }
  }
  for (const item of sub.items.data) {
    if (item.price?.id && !keep.has(item.price.id)) out.push({ id: item.id, deleted: true });
  }
  return out;
}

/**
 * In-app plan change (upgrade / downgrade / interval / AI Scribe users) on an existing subscription,
 * prorated by Stripe. The webhook then updates our record.
 */
export async function changeSubscription(input: {
  organizationId: string;
  tier: TierId;
  interval: BillingInterval;
  aiScribeUsers: number;
}): Promise<{ ok: true } | Fail> {
  const stripe = getStripe();
  if (!stripe) return { ok: false, status: 503, error: 'Stripe is not configured on this server (STRIPE_SECRET_KEY).' };
  const blocked = liveModeBlocked();
  if (blocked) return blocked;
  if (!TIERS[input.tier].selfServe) {
    return { ok: false, status: 400, error: `${TIERS[input.tier].name} is quoted by sales. Contact us.` };
  }
  const { record } = await loadSubscriptionRecord(input.organizationId);
  if (!record.stripeSubscriptionId) return { ok: false, status: 409, error: 'No subscription to change. Choose a plan first.' };

  const built = await orgLineItems(input.organizationId, input.tier, input.interval, {
    aiScribeUsers: input.aiScribeUsers,
    includeOnboarding: false,
    includeDataMigration: false,
  });
  if ('ok' in built) return built;
  const sub = await stripe.subscriptions.retrieve(record.stripeSubscriptionId);
  await stripe.subscriptions.update(sub.id, {
    items: reconcileItems(sub, built.items),
    proration_behavior: 'create_prorations',
    ...(built.couponId ? { discounts: [{ coupon: built.couponId }] } : {}),
    metadata: { ...sub.metadata, organizationId: input.organizationId, tier: input.tier, interval: input.interval, pricingModel: 'v2' },
  });
  return { ok: true };
}

export type SeatSyncResult =
  | { ok: true; changed: boolean; seats: number; paid: number | null; note?: string }
  | Fail;

/**
 * Seat sync: set each seat-type line (and the plan-minimum top-up and extra locations) to the current
 * active counts, prorated. Behind BILLING_SEAT_SYNC=true. AI Scribe users are kept as purchased.
 */
export async function syncSeats(organizationId: string, opts: { force?: boolean } = {}): Promise<SeatSyncResult> {
  if (!seatSyncEnabled() && !opts.force) {
    return { ok: true, changed: false, seats: 0, paid: null, note: 'Seat sync is off (BILLING_SEAT_SYNC).' };
  }
  const stripe = getStripe();
  if (!stripe) return { ok: false, status: 503, error: 'Stripe is not configured on this server.' };
  const { record } = await loadSubscriptionRecord(organizationId);
  if (!record.stripeSubscriptionId || !record.tier || !['active', 'trialing', 'past_due'].includes(record.status)) {
    return { ok: true, changed: false, seats: 0, paid: record.seatsPaid, note: 'No active Stripe subscription.' };
  }
  const built = await orgLineItems(organizationId, record.tier, record.interval, {
    aiScribeUsers: record.addOns.ai_scribe,
    includeOnboarding: false,
    includeDataMigration: false,
  });
  if ('ok' in built) return built;
  const sub = await stripe.subscriptions.retrieve(record.stripeSubscriptionId);
  const items = reconcileItems(sub, built.items);
  const seats = built.quote.billableSeats;
  if (items.length === 0) return { ok: true, changed: false, seats, paid: record.seatsPaid };
  await stripe.subscriptions.update(sub.id, { items, proration_behavior: 'create_prorations' });
  await updateSubscriptionRecord(organizationId, (r) => ({
    ...r,
    seatsPaid: seats,
    seatsByType: built.quote.seats,
    updatedAt: new Date().toISOString(),
  }));
  return { ok: true, changed: true, seats, paid: seats };
}

/** Fire-and-forget hook for staff add/remove routes. Never throws into the caller. */
export function syncSeatsInBackground(organizationId: string) {
  if (!seatSyncEnabled()) return;
  void syncSeats(organizationId).catch((err) => {
    console.error('[billing seat sync]', organizationId, err instanceof Error ? err.message : err);
  });
}

export type InvoiceRow = {
  id: string;
  number: string | null;
  createdAt: string;
  total: number;
  amountDue: number;
  currency: string;
  status: string | null;
  hostedUrl: string | null;
  pdfUrl: string | null;
};

export async function listBilling(organizationId: string): Promise<
  | { ok: true; invoices: InvoiceRow[]; upcoming: { amountDue: number; currency: string; date: string | null } | null }
  | Fail
> {
  const stripe = getStripe();
  if (!stripe) return { ok: false, status: 503, error: 'Stripe is not configured on this server.' };
  const { record } = await loadSubscriptionRecord(organizationId);
  if (!record.stripeCustomerId) return { ok: true, invoices: [], upcoming: null };
  const list = await stripe.invoices.list({ customer: record.stripeCustomerId, limit: 24 });
  const invoices: InvoiceRow[] = list.data.map((inv) => ({
    id: inv.id ?? '',
    number: inv.number ?? null,
    createdAt: new Date(inv.created * 1000).toISOString(),
    total: inv.total / 100,
    amountDue: inv.amount_due / 100,
    currency: inv.currency,
    status: inv.status ?? null,
    hostedUrl: inv.hosted_invoice_url ?? null,
    pdfUrl: inv.invoice_pdf ?? null,
  }));
  let upcoming: { amountDue: number; currency: string; date: string | null } | null = null;
  if (record.stripeSubscriptionId && ['active', 'trialing', 'past_due'].includes(record.status) && !record.cancelAtPeriodEnd) {
    try {
      const preview = await stripe.invoices.createPreview({
        customer: record.stripeCustomerId,
        subscription: record.stripeSubscriptionId,
      });
      const date = preview.next_payment_attempt ?? preview.period_end ?? null;
      upcoming = {
        amountDue: preview.amount_due / 100,
        currency: preview.currency,
        date: date ? new Date(date * 1000).toISOString() : null,
      };
    } catch {
      upcoming = null; // no upcoming invoice (e.g. subscription ending)
    }
  }
  return { ok: true, invoices, upcoming };
}

/** Org lookup by Stripe customer id (fallback when an event has no organizationId metadata). */
export async function organizationIdForCustomer(customerId: string): Promise<string | null> {
  const row = await prisma.clinicModuleState.findFirst({
    where: { module: 'subscription-state', data: { path: ['stripeCustomerId'], equals: customerId } },
    select: { organizationId: true },
  });
  return row?.organizationId ?? null;
}
