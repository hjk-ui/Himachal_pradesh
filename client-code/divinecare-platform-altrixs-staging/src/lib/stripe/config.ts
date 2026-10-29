/**
 * Stripe configuration from env. Price IDs are NOT in code: the catalog (src/lib/stripe/catalog.ts)
 * names every product/price and the env var that holds its Stripe id. Create them with
 * scripts/stripe-sync-catalog.ts (test mode; live needs owner approval) and set the printed env vars.
 */
import {
  BILLABLE_SEAT_TYPES,
  SELF_SERVE_TIERS,
  TIERS,
  type BillableSeatType,
  type BillingInterval,
  type TierId,
} from '@/lib/billing/plans';
import {
  CATALOG_COUPONS,
  CATALOG_PRICES,
  addOnLookupKey,
  catalogPrice,
  minimumLookupKey,
  oneTimeLookupKey,
  seatLookupKey,
  usageLookupKey,
  type PriceLookup,
  type RecurringAddOnId,
  type UsageMeterId,
} from './catalog';

export type { PriceLookup } from './catalog';

/** Secret key from the website owner's Stripe account (live or test). */
export function stripeSecretKey(): string | null {
  const key = process.env.STRIPE_SECRET_KEY?.trim() || process.env.STRIPE_SECRET?.trim() || '';
  return key || null;
}

export function stripeWebhookSecret(): string | null {
  const key = process.env.STRIPE_WEBHOOK_SECRET?.trim() || '';
  return key || null;
}

export function stripePublishableKey(): string | null {
  const key =
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim() || process.env.STRIPE_PUBLISHABLE_KEY?.trim() || '';
  return key || null;
}

export function stripeConfigured() {
  return Boolean(stripeSecretKey());
}

export function stripeKeyMode(): 'live' | 'test' | 'unknown' | null {
  const key = stripeSecretKey();
  if (!key) return null;
  if (key.startsWith('sk_live_') || key.startsWith('rk_live_')) return 'live';
  if (key.startsWith('sk_test_') || key.startsWith('rk_test_')) return 'test';
  return 'unknown';
}

/** Automatic Stripe seat-quantity updates when clinicians are added/removed. Off unless 'true'. */
export function seatSyncEnabled(): boolean {
  return process.env.BILLING_SEAT_SYNC === 'true';
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

function envValue(name: string | null | undefined): string | null {
  if (!name) return null;
  const v = process.env[name]?.trim();
  return v || null;
}

/** Stripe price id for a catalog lookup key, from its env var. */
export function priceIdForLookupKey(lookupKey: string): string | null {
  return envValue(catalogPrice(lookupKey)?.envVar);
}

export function seatPriceId(tier: TierId, seat: BillableSeatType, interval: BillingInterval): string | null {
  return priceIdForLookupKey(seatLookupKey(tier, seat, interval));
}

/** Headline seat price (clinician) — kept for callers that only need "is this tier priced". */
export function tierPriceId(tier: TierId, interval: BillingInterval): string | null {
  return seatPriceId(tier, 'clinician', interval);
}

export function addOnPriceId(addOn: RecurringAddOnId, interval: BillingInterval): string | null {
  return priceIdForLookupKey(addOnLookupKey(addOn, interval));
}

export function minimumPriceId(interval: BillingInterval): string | null {
  return priceIdForLookupKey(minimumLookupKey(interval));
}

export function usagePriceId(meter: UsageMeterId): string | null {
  return priceIdForLookupKey(usageLookupKey(meter));
}

export function oneTimePriceId(kind: 'onboarding' | 'onboarding_location' | 'data_migration', tier: TierId): string | null {
  return priceIdForLookupKey(oneTimeLookupKey(kind, tier));
}

/** Stripe coupon id for a volume-discount percent (env), or null. */
export function volumeCouponId(percent: number): string | null {
  const c = CATALOG_COUPONS.find((x) => x.percentOff === percent);
  return c ? envValue(c.envVar) : null;
}

/** Can this tier/interval be sold through Checkout? Needs the key, every seat price and the minimum price. */
export function checkoutReadyFor(tier: TierId, interval: BillingInterval): boolean {
  if (!stripeConfigured() || !TIERS[tier].selfServe) return false;
  return BILLABLE_SEAT_TYPES.every((seat) => Boolean(seatPriceId(tier, seat, interval))) && Boolean(minimumPriceId(interval));
}

/** At least one self-serve tier is purchasable. */
export function stripeCheckoutReady(): boolean {
  return SELF_SERVE_TIERS.some((t) => checkoutReadyFor(t, 'month') || checkoutReadyFor(t, 'year'));
}

/** Every env var the billing system reads and whether it is set (never the value). */
export function stripeEnvReport(): { name: string; set: boolean; purpose: string }[] {
  const rows: { name: string; set: boolean; purpose: string }[] = [
    { name: 'STRIPE_SECRET_KEY', set: Boolean(stripeSecretKey()), purpose: 'Server API key (sk_test_… or sk_live_…)' },
    { name: 'STRIPE_WEBHOOK_SECRET', set: Boolean(stripeWebhookSecret()), purpose: 'Webhook signing secret (whsec_…)' },
  ];
  for (const p of CATALOG_PRICES) rows.push({ name: p.envVar, set: Boolean(envValue(p.envVar)), purpose: p.nickname });
  for (const c of CATALOG_COUPONS) rows.push({ name: c.envVar, set: Boolean(envValue(c.envVar)), purpose: c.name });
  return rows;
}

/** Model v1 env names (pricing never approved; kept so any test-mode subscription still resolves). */
const LEGACY_PRICE_ENV: [string, PriceLookup][] = [
  ['STRIPE_PRICE_STARTER_MONTHLY', { kind: 'tier', tier: 'starter', interval: 'month' }],
  ['STRIPE_PRICE_STARTER_ANNUAL', { kind: 'tier', tier: 'starter', interval: 'year' }],
  ['STRIPE_PRICE_PROFESSIONAL_MONTHLY', { kind: 'tier', tier: 'professional', interval: 'month' }],
  ['STRIPE_PRICE_PROFESSIONAL_ANNUAL', { kind: 'tier', tier: 'professional', interval: 'year' }],
  ['STRIPE_PRICE_CLINIC_MONTHLY', { kind: 'tier', tier: 'clinic', interval: 'month' }],
  ['STRIPE_PRICE_CLINIC_ANNUAL', { kind: 'tier', tier: 'clinic', interval: 'year' }],
  ['STRIPE_PRICE_ERX_MONTHLY', { kind: 'legacy_addon', addOn: 'eprescribing', interval: 'month' }],
  ['STRIPE_PRICE_ERX_ANNUAL', { kind: 'legacy_addon', addOn: 'eprescribing', interval: 'year' }],
  ['STRIPE_PRICE_AI_SCRIBE_MONTHLY', { kind: 'legacy_addon', addOn: 'ai_scribe', interval: 'month' }],
  ['STRIPE_PRICE_AI_SCRIBE_ANNUAL', { kind: 'legacy_addon', addOn: 'ai_scribe', interval: 'year' }],
  ['STRIPE_PRICE_ONBOARDING_PROFESSIONAL', { kind: 'onboarding', tier: 'professional' }],
  ['STRIPE_PRICE_ONBOARDING_CLINIC', { kind: 'onboarding', tier: 'clinic' }],
  ['STRIPE_SOLO_MONTHLY_PRICE_ID', { kind: 'tier', tier: 'starter', interval: 'month' }],
  ['STRIPE_SOLO_ANNUAL_PRICE_ID', { kind: 'tier', tier: 'starter', interval: 'year' }],
  ['STRIPE_PROFESSIONAL_MONTHLY_PRICE_ID', { kind: 'tier', tier: 'professional', interval: 'month' }],
  ['STRIPE_PROFESSIONAL_ANNUAL_PRICE_ID', { kind: 'tier', tier: 'professional', interval: 'year' }],
  ['STRIPE_GROWTH_MONTHLY_PRICE_ID', { kind: 'tier', tier: 'professional', interval: 'month' }],
  ['STRIPE_GROWTH_ANNUAL_PRICE_ID', { kind: 'tier', tier: 'professional', interval: 'year' }],
  ['STRIPE_PRACTICE_MONTHLY_PRICE_ID', { kind: 'tier', tier: 'professional', interval: 'month' }],
  ['STRIPE_PRACTICE_ANNUAL_PRICE_ID', { kind: 'tier', tier: 'professional', interval: 'year' }],
  ['STRIPE_ENTERPRISE_MONTHLY_PRICE_ID', { kind: 'tier', tier: 'clinic', interval: 'month' }],
  ['STRIPE_ENTERPRISE_ANNUAL_PRICE_ID', { kind: 'tier', tier: 'clinic', interval: 'year' }],
];

/** Map a Stripe Price id back to what it sells (catalog v2 first, then model v1 / older env names). */
export function lookupPrice(priceId: string | null | undefined): PriceLookup | null {
  if (!priceId) return null;
  for (const p of CATALOG_PRICES) {
    if (envValue(p.envVar) === priceId) return p.sells;
  }
  for (const [name, sells] of LEGACY_PRICE_ENV) {
    if (envValue(name) === priceId) return sells;
  }
  return null;
}
