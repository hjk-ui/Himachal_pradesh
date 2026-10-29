import type Stripe from 'stripe';

/** Verify a webhook payload against its Stripe-Signature header. No network. */
export function verifyStripeSignature(
  stripe: Pick<Stripe, 'webhooks'>,
  rawBody: string,
  signature: string | null,
  secret: string
): { ok: true; event: Stripe.Event } | { ok: false; error: string } {
  if (!signature) return { ok: false, error: 'Missing stripe-signature header' };
  try {
    return { ok: true, event: stripe.webhooks.constructEvent(rawBody, signature, secret) };
  } catch {
    return { ok: false, error: 'Invalid Stripe signature' };
  }
}
