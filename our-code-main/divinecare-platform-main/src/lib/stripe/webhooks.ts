import 'server-only';

import type Stripe from 'stripe';
import { getStripe } from './client';
import { stripeWebhookSecret } from './config';
import { applyCheckoutCompleted, applySubscriptionUpdated } from './checkout';

export function constructStripeEvent(rawBody: string, signature: string | null) {
  const stripe = getStripe();
  const secret = stripeWebhookSecret();
  if (!stripe || !secret) {
    return { ok: false as const, error: 'Stripe webhook secret is not configured' };
  }
  if (!signature) {
    return { ok: false as const, error: 'Missing stripe-signature header' };
  }
  try {
    const event = stripe.webhooks.constructEvent(rawBody, signature, secret);
    return { ok: true as const, event };
  } catch {
    return { ok: false as const, error: 'Invalid Stripe signature' };
  }
}

export async function handleStripeEvent(event: Stripe.Event) {
  switch (event.type) {
    case 'checkout.session.completed':
      await applyCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
      break;
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      await applySubscriptionUpdated(event.data.object as Stripe.Subscription);
      break;
    default:
      break;
  }
}
