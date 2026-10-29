import 'server-only';

import type Stripe from 'stripe';
import { prisma } from '@/lib/db/prisma';
import { updateSubscriptionRecord } from '@/lib/billing/entitlementsServer';
import { getStripe } from './client';
import { lookupPrice, stripeWebhookSecret } from './config';
import { organizationIdForCustomer } from './checkout';
import {
  HANDLED_EVENT_TYPES,
  customerIdFromEvent,
  organizationIdFromEvent,
  reduceStripeEvent,
  type ReduceResult,
  type StripeEventLike,
} from './events';
import { verifyStripeSignature } from './signature';

export function constructStripeEvent(rawBody: string, signature: string | null) {
  const stripe = getStripe();
  const secret = stripeWebhookSecret();
  if (!stripe || !secret) {
    return { ok: false as const, status: 503, error: 'Stripe webhook secret is not configured' };
  }
  const verified = verifyStripeSignature(stripe, rawBody, signature, secret);
  if (verified.ok === false) return { ok: false as const, status: 400, error: verified.error };
  return verified;
}

export async function handleStripeEvent(
  event: Stripe.Event
): Promise<{ outcome: ReduceResult['outcome'] | 'no_org'; organizationId: string | null; reason?: string }> {
  if (!(HANDLED_EVENT_TYPES as readonly string[]).includes(event.type)) {
    return { outcome: 'ignored', organizationId: null, reason: `unhandled ${event.type}` };
  }
  const like = event as unknown as StripeEventLike;
  let organizationId = organizationIdFromEvent(like);
  if (!organizationId) {
    const customer = customerIdFromEvent(like);
    organizationId = customer ? await organizationIdForCustomer(customer) : null;
  }
  if (!organizationId) return { outcome: 'no_org', organizationId: null, reason: 'no organization for event' };

  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
  if (!org) return { outcome: 'no_org', organizationId, reason: 'organization not found' };

  let result: ReduceResult | null = null;
  await updateSubscriptionRecord(organizationId, (current) => {
    result = reduceStripeEvent(current, like, (priceId) => lookupPrice(priceId));
    // Duplicates are not saved again; everything else records the event id for idempotency.
    return result.outcome === 'duplicate' ? null : result.record;
  });
  const r = result as ReduceResult | null;
  return { outcome: r?.outcome ?? 'ignored', organizationId, reason: r && 'reason' in r ? r.reason : undefined };
}
