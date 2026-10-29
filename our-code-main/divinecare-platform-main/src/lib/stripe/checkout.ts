import 'server-only';

import type Stripe from 'stripe';
import { prisma } from '@/lib/db/prisma';
import {
  normalizePlanId,
  type BillingCycle,
  type SubscriptionPlanId,
} from '@/lib/subscription/catalog';
import {
  getSubscriptionState,
  saveSubscriptionState,
  type SubscriptionState,
} from '@/lib/subscription/plans';
import { getStripe } from './client';
import {
  planFromStripePriceId,
  publicAppUrl,
  stripeConfigured,
  stripePriceIdFor,
} from './config';

function mergeState(
  organizationId: string,
  current: SubscriptionState,
  patch: Partial<SubscriptionState>
) {
  return saveSubscriptionState(organizationId, {
    plan: patch.plan ?? current.plan,
    billingCycle: patch.billingCycle ?? current.billingCycle,
    stripeCustomerId: patch.stripeCustomerId ?? current.stripeCustomerId,
    stripeSubscriptionId: patch.stripeSubscriptionId ?? current.stripeSubscriptionId,
    stripeStatus: patch.stripeStatus ?? current.stripeStatus,
  });
}

export async function createSubscriptionCheckoutUrl(input: {
  organizationId: string;
  plan: SubscriptionPlanId;
  billingCycle: BillingCycle;
  customerEmail?: string | null;
  request?: Request;
}): Promise<{ checkoutUrl: string } | { error: string; status: number }> {
  if (input.plan === 'free') {
    return { error: 'Free plan does not use Checkout', status: 400 };
  }
  const cycle: BillingCycle = 'monthly';
  const stripe = getStripe();
  const price = stripePriceIdFor(input.plan, cycle);
  if (!stripe || !stripeConfigured() || !price) {
    if (input.plan === 'enterprise') {
      return { error: 'Enterprise checkout is not configured. Contact sales.', status: 400 };
    }
    return { error: 'Stripe price ID missing for this plan', status: 503 };
  }

  const current = await getSubscriptionState(input.organizationId);
  if (current.stripeSubscriptionId && current.stripeCustomerId) {
    const portal = await createBillingPortalUrl({
      organizationId: input.organizationId,
      request: input.request,
    });
    if ('portalUrl' in portal) {
      return { checkoutUrl: portal.portalUrl };
    }
  }

  const base = publicAppUrl(input.request);
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price, quantity: 1 }],
    success_url: `${base}/dashboard/subscription?checkout=success`,
    cancel_url: `${base}/dashboard/subscription?checkout=canceled`,
    client_reference_id: input.organizationId,
    customer: current.stripeCustomerId || undefined,
    customer_email: current.stripeCustomerId ? undefined : input.customerEmail || undefined,
    metadata: {
      organizationId: input.organizationId,
      plan: input.plan,
      billingCycle: cycle,
    },
    subscription_data: {
      metadata: {
        organizationId: input.organizationId,
        plan: input.plan,
        billingCycle: cycle,
      },
    },
  });

  if (!session.url) {
    return { error: 'Stripe did not return a Checkout URL', status: 502 };
  }
  return { checkoutUrl: session.url };
}

export async function createBillingPortalUrl(input: {
  organizationId: string;
  request?: Request;
}): Promise<{ portalUrl: string } | { error: string; status: number }> {
  const stripe = getStripe();
  if (!stripe) {
    return { error: 'Stripe is not configured', status: 503 };
  }
  const current = await getSubscriptionState(input.organizationId);
  if (!current.stripeCustomerId) {
    const fallback = process.env.STRIPE_BILLING_PORTAL_URL?.trim();
    if (fallback) return { portalUrl: fallback };
    return { error: 'No Stripe customer on this clinic yet. Choose a paid plan first.', status: 409 };
  }
  const base = publicAppUrl(input.request);
  const session = await stripe.billingPortal.sessions.create({
    customer: current.stripeCustomerId,
    return_url: `${base}/dashboard/subscription`,
  });
  return { portalUrl: session.url };
}

export async function cancelStripeSubscriptionAtPeriodEnd(organizationId: string) {
  const stripe = getStripe();
  const current = await getSubscriptionState(organizationId);
  if (!stripe || !current.stripeSubscriptionId) {
    return saveSubscriptionState(organizationId, {
      plan: 'free',
      billingCycle: current.billingCycle,
      stripeCustomerId: current.stripeCustomerId,
      stripeSubscriptionId: current.stripeSubscriptionId,
      stripeStatus: current.stripeStatus,
    });
  }
  await stripe.subscriptions.update(current.stripeSubscriptionId, {
    cancel_at_period_end: true,
  });
  return mergeState(organizationId, current, { stripeStatus: 'cancel_at_period_end' });
}

function orgIdFrom(obj: { metadata?: Stripe.Metadata | null } | null | undefined) {
  return obj?.metadata?.organizationId?.trim() || '';
}

export async function applyCheckoutCompleted(session: Stripe.Checkout.Session) {
  const organizationId =
    orgIdFrom(session) || session.client_reference_id?.trim() || '';
  if (!organizationId) return;

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true },
  });
  if (!org) return;

  const plan = normalizePlanId(session.metadata?.plan);
  const billingCycle = (session.metadata?.billingCycle === 'annual' ? 'annual' : 'monthly') as BillingCycle;
  const customerId =
    typeof session.customer === 'string' ? session.customer : session.customer?.id;
  const subscriptionId =
    typeof session.subscription === 'string'
      ? session.subscription
      : session.subscription?.id;

  await saveSubscriptionState(organizationId, {
    plan,
    billingCycle,
    stripeCustomerId: customerId || null,
    stripeSubscriptionId: subscriptionId || null,
    stripeStatus: 'active',
  });
}

export async function applySubscriptionUpdated(subscription: Stripe.Subscription) {
  const organizationId = orgIdFrom(subscription);
  if (!organizationId) return;
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true },
  });
  if (!org) return;

  const priceId = subscription.items.data[0]?.price?.id;
  const mapped = planFromStripePriceId(priceId);
  const status = subscription.status;
  const canceled = status === 'canceled' || status === 'unpaid' || status === 'incomplete_expired';

  await saveSubscriptionState(organizationId, {
    plan: canceled
      ? 'free'
      : mapped?.plan || normalizePlanId(subscription.metadata?.plan),
    billingCycle:
      mapped?.billingCycle ||
      (subscription.metadata?.billingCycle === 'annual' ? 'annual' : 'monthly'),
    stripeCustomerId: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id,
    stripeSubscriptionId: canceled ? null : subscription.id,
    stripeStatus: status,
  });
}
