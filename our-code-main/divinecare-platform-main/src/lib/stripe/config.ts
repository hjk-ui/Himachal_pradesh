import type { BillingCycle, SubscriptionPlanId } from '@/lib/subscription/catalog';

/** Secret key from the website owner's Stripe account (live or test). */
export function stripeSecretKey(): string | null {
  const key =
    process.env.STRIPE_SECRET_KEY?.trim() || process.env.STRIPE_SECRET?.trim() || '';
  return key || null;
}

export function stripeWebhookSecret(): string | null {
  const key = process.env.STRIPE_WEBHOOK_SECRET?.trim() || '';
  return key || null;
}

export function stripePublishableKey(): string | null {
  const key =
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim() ||
    process.env.STRIPE_PUBLISHABLE_KEY?.trim() ||
    '';
  return key || null;
}

export function stripeConfigured() {
  return Boolean(stripeSecretKey());
}

export function stripeKeyMode(): 'live' | 'test' | 'unknown' | null {
  const key = stripeSecretKey();
  if (!key) return null;
  if (key.startsWith('sk_live_')) return 'live';
  if (key.startsWith('sk_test_')) return 'test';
  return 'unknown';
}

export function publicAppUrl(request?: Request): string {
  const env = process.env.AUTH_URL?.trim().replace(/\/$/, '');
  if (env) return env;
  if (request) {
    const url = new URL(request.url);
    return `${url.protocol}//${url.host}`;
  }
  return 'http://localhost:3000';
}

function envPrice(name: string): string | null {
  const v = process.env[name]?.trim();
  return v || null;
}

export function stripePriceIdFor(
  plan: SubscriptionPlanId,
  cycle: BillingCycle
): string | null {
  if (plan === 'free') return null;
  const monthly =
    plan === 'solo'
      ? envPrice('STRIPE_SOLO_MONTHLY_PRICE_ID')
      : plan === 'practice'
        ? envPrice('STRIPE_PRACTICE_MONTHLY_PRICE_ID')
        : plan === 'enterprise'
          ? envPrice('STRIPE_ENTERPRISE_MONTHLY_PRICE_ID')
          : envPrice('STRIPE_PROFESSIONAL_MONTHLY_PRICE_ID') ||
            envPrice('STRIPE_GROWTH_MONTHLY_PRICE_ID');
  const annual =
    plan === 'solo'
      ? envPrice('STRIPE_SOLO_ANNUAL_PRICE_ID')
      : plan === 'practice'
        ? envPrice('STRIPE_PRACTICE_ANNUAL_PRICE_ID')
        : plan === 'enterprise'
          ? envPrice('STRIPE_ENTERPRISE_ANNUAL_PRICE_ID')
          : envPrice('STRIPE_PROFESSIONAL_ANNUAL_PRICE_ID') ||
            envPrice('STRIPE_GROWTH_ANNUAL_PRICE_ID');
  return cycle === 'annual' ? annual : monthly;
}

/** Checkout-ready when public monthly Solo + Practice Price IDs exist. Annual / Professional / Enterprise IDs stay optional. */
export function stripePriceIdsConfigured() {
  return Boolean(stripePriceIdFor('solo', 'monthly') && stripePriceIdFor('practice', 'monthly'));
}

export function planFromStripePriceId(
  priceId: string | null | undefined
): { plan: SubscriptionPlanId; billingCycle: BillingCycle } | null {
  if (!priceId) return null;
  const pairs: { plan: SubscriptionPlanId; billingCycle: BillingCycle }[] = [
    { plan: 'solo', billingCycle: 'monthly' },
    { plan: 'solo', billingCycle: 'annual' },
    { plan: 'professional', billingCycle: 'monthly' },
    { plan: 'professional', billingCycle: 'annual' },
    { plan: 'practice', billingCycle: 'monthly' },
    { plan: 'practice', billingCycle: 'annual' },
    { plan: 'enterprise', billingCycle: 'monthly' },
    { plan: 'enterprise', billingCycle: 'annual' },
  ];
  for (const pair of pairs) {
    if (stripePriceIdFor(pair.plan, pair.billingCycle) === priceId) return pair;
  }
  return null;
}

export function stripeCheckoutReady() {
  return stripeConfigured() && stripePriceIdsConfigured();
}
