/**
 * Stripe product / price catalog for pricing model v2 — GENERATED FROM src/lib/billing/plans.ts.
 *
 * This file is definitions only. Nothing here talks to Stripe. scripts/stripe-sync-catalog.ts can
 * create these objects in a Stripe account, but only with --apply, and in live mode only with
 * --live: creating live products/prices needs the owner's explicit approval (see docs/pricing-model.md).
 *
 * Runtime code finds a price by its env var (STRIPE_PRICE_V2_...), whose value is the Stripe price id
 * printed by the sync script. Lookup keys are stable identifiers: never rename one; a price change
 * creates a new Stripe price and moves the lookup key to it (transfer_lookup_key).
 *
 * Client-safe (no Stripe SDK import).
 */
import {
  ADD_ONS,
  AI_SCRIBE_OVERAGE_PER_MINUTE,
  BILLABLE_SEAT_TYPES,
  CLAIM_OVERAGE_PER_CLAIM,
  PRICING_MODEL_VERSION,
  SEAT_TYPES,
  SELF_SERVE_TIERS,
  TIERS,
  VOLUME_DISCOUNTS,
  type BillableSeatType,
  type BillingInterval,
  type SelfServeTierId,
  type TierId,
} from '@/lib/billing/plans';

export type RecurringAddOnId = 'ai_scribe' | 'additional_location';
export type UsageMeterId = 'claims' | 'scribe_minutes';

/** What a Stripe price sells. */
export type PriceLookup =
  | { kind: 'seat'; tier: TierId; seat: BillableSeatType; interval: BillingInterval }
  | { kind: 'addon'; addOn: RecurringAddOnId; interval: BillingInterval }
  /** Plan-minimum top-up: quantity = shortfall in whole dollars per month. */
  | { kind: 'minimum'; interval: BillingInterval }
  | { kind: 'usage'; meter: UsageMeterId }
  | { kind: 'onboarding'; tier: TierId }
  | { kind: 'onboarding_location'; tier: TierId }
  | { kind: 'data_migration'; tier: TierId }
  /** Model v1 per-seat tier price (legacy env names); treated as clinician seats. */
  | { kind: 'tier'; tier: TierId; interval: BillingInterval }
  /** Model v1 e-prescribing add-on (legacy env names). */
  | { kind: 'legacy_addon'; addOn: 'eprescribing' | 'ai_scribe'; interval: BillingInterval };

export type CatalogProduct = {
  /** Used as the Stripe product id (Stripe allows custom ids), so re-running the sync finds it. */
  id: string;
  name: string;
  description: string;
};

export type CatalogPrice = {
  lookupKey: string;
  /** Env var holding the Stripe price id on the server. */
  envVar: string;
  productId: string;
  nickname: string;
  /** Integer cents per unit (per interval for recurring licensed prices). */
  unitAmount: number;
  currency: 'usd';
  recurring: { interval: BillingInterval; usageType: 'licensed' | 'metered'; meterEventName?: string } | null;
  sells: PriceLookup;
};

export type CatalogCoupon = {
  /** Used as the Stripe coupon id. */
  id: string;
  envVar: string;
  name: string;
  percentOff: number;
  minProviderSeats: number;
};

export type CatalogMeter = { id: UsageMeterId; eventName: string; displayName: string };

const V = PRICING_MODEL_VERSION;
const toCents = (usd: number) => Math.round(usd * 100);
const envFor = (lookupKey: string) => `STRIPE_PRICE_${lookupKey.replace(/^altrixs_/, '').toUpperCase()}`;
const intervalWord = (i: BillingInterval) => (i === 'year' ? 'annual' : 'monthly');

export const METERS: CatalogMeter[] = [
  { id: 'claims', eventName: `altrixs_${V}_claims_over_allowance`, displayName: 'Claims above allowance' },
  { id: 'scribe_minutes', eventName: `altrixs_${V}_scribe_minutes_over_allowance`, displayName: 'AI Scribe minutes above allowance' },
];

function build(): { products: CatalogProduct[]; prices: CatalogPrice[]; coupons: CatalogCoupon[] } {
  const products: CatalogProduct[] = [];
  const prices: CatalogPrice[] = [];
  const product = (p: CatalogProduct) => {
    products.push(p);
    return p.id;
  };
  const add = (p: Omit<CatalogPrice, 'envVar' | 'currency'>) => prices.push({ ...p, envVar: envFor(p.lookupKey), currency: 'usd' });

  for (const tier of SELF_SERVE_TIERS) {
    const t = TIERS[tier];
    for (const seat of BILLABLE_SEAT_TYPES) {
      const productId = product({
        id: `altrixs_${V}_${tier}_${seat}_seat`,
        name: `Altrixs ${t.name} — ${SEAT_TYPES[seat].name} seat`,
        description: SEAT_TYPES[seat].explain,
      });
      for (const interval of ['month', 'year'] as BillingInterval[]) {
        const perMonth = t.seatPrices![seat][interval];
        add({
          lookupKey: `altrixs_${V}_${tier}_${seat}_${interval}`,
          productId,
          nickname: `${t.name} ${SEAT_TYPES[seat].name} seat, ${intervalWord(interval)}`,
          unitAmount: toCents(interval === 'year' ? perMonth * 12 : perMonth),
          recurring: { interval, usageType: 'licensed' },
          sells: { kind: 'seat', tier, seat, interval },
        });
      }
    }
  }

  for (const addOn of ['ai_scribe', 'additional_location'] as RecurringAddOnId[]) {
    const a = ADD_ONS[addOn];
    const productId = product({ id: `altrixs_${V}_addon_${addOn}`, name: `Altrixs ${a.name}`, description: a.description });
    for (const interval of ['month', 'year'] as BillingInterval[]) {
      const perMonth = interval === 'year' ? a.annualPerUnitPerMonth! : a.monthlyPerUnit!;
      add({
        lookupKey: `altrixs_${V}_addon_${addOn}_${interval}`,
        productId,
        nickname: `${a.name}, ${intervalWord(interval)}`,
        unitAmount: toCents(interval === 'year' ? perMonth * 12 : perMonth),
        recurring: { interval, usageType: 'licensed' },
        sells: { kind: 'addon', addOn, interval },
      });
    }
  }

  const minProduct = product({
    id: `altrixs_${V}_plan_minimum`,
    name: 'Altrixs plan minimum adjustment',
    description: 'Tops the subscription up to the plan minimum. Quantity is the monthly shortfall in dollars.',
  });
  for (const interval of ['month', 'year'] as BillingInterval[]) {
    add({
      lookupKey: `altrixs_${V}_minimum_${interval}`,
      productId: minProduct,
      nickname: `Plan minimum adjustment, ${intervalWord(interval)} ($1 per unit per month)`,
      unitAmount: toCents(interval === 'year' ? 12 : 1),
      recurring: { interval, usageType: 'licensed' },
      sells: { kind: 'minimum', interval },
    });
  }

  const usage: { meter: UsageMeterId; name: string; description: string; perUnit: number }[] = [
    { meter: 'claims', name: 'Claims above allowance', description: 'Electronic claims above the pooled monthly allowance.', perUnit: CLAIM_OVERAGE_PER_CLAIM },
    { meter: 'scribe_minutes', name: 'AI Scribe minutes above allowance', description: 'Ambient session audio above the pooled AI Scribe allowance.', perUnit: AI_SCRIBE_OVERAGE_PER_MINUTE },
  ];
  for (const u of usage) {
    const productId = product({ id: `altrixs_${V}_usage_${u.meter}`, name: `Altrixs ${u.name}`, description: u.description });
    add({
      lookupKey: `altrixs_${V}_usage_${u.meter}`,
      productId,
      nickname: `${u.name} (per unit, billed monthly in arrears)`,
      unitAmount: toCents(u.perUnit),
      recurring: { interval: 'month', usageType: 'metered', meterEventName: METERS.find((m) => m.id === u.meter)!.eventName },
      sells: { kind: 'usage', meter: u.meter },
    });
  }

  const oneTime: { kind: 'onboarding' | 'onboarding_location' | 'data_migration'; label: string; amount: (tier: SelfServeTierId) => number }[] = [
    { kind: 'onboarding', label: 'onboarding', amount: (tier) => TIERS[tier].onboardingFee ?? 0 },
    { kind: 'onboarding_location', label: 'onboarding, additional site', amount: (tier) => TIERS[tier].onboardingPerExtraLocation },
    { kind: 'data_migration', label: 'data migration', amount: (tier) => TIERS[tier].dataMigrationFee ?? 0 },
  ];
  for (const o of oneTime) {
    for (const tier of SELF_SERVE_TIERS) {
      const amount = o.amount(tier);
      if (amount <= 0) continue;
      const productId = product({
        id: `altrixs_${V}_${o.kind}_${tier}`,
        name: `Altrixs ${TIERS[tier].name} ${o.label}`,
        description: o.kind === 'data_migration' ? TIERS[tier].dataMigrationIncludes : TIERS[tier].onboardingIncludes,
      });
      add({
        lookupKey: `altrixs_${V}_${o.kind}_${tier}`,
        productId,
        nickname: `${TIERS[tier].name} ${o.label} (one-time)`,
        unitAmount: toCents(amount),
        recurring: null,
        sells: { kind: o.kind, tier },
      });
    }
  }

  const coupons: CatalogCoupon[] = VOLUME_DISCOUNTS.map((v) => ({
    id: `altrixs_${V}_volume_${v.percent}`,
    envVar: `STRIPE_COUPON_${V.toUpperCase()}_VOLUME_${v.percent}`,
    name: `Volume discount ${v.percent}% (${v.minProviderSeats}+ providers)`,
    percentOff: v.percent,
    minProviderSeats: v.minProviderSeats,
  }));

  return { products, prices, coupons };
}

const CATALOG = build();

export const CATALOG_PRODUCTS: readonly CatalogProduct[] = CATALOG.products;
export const CATALOG_PRICES: readonly CatalogPrice[] = CATALOG.prices;
export const CATALOG_COUPONS: readonly CatalogCoupon[] = CATALOG.coupons;

export function catalogPrice(lookupKey: string): CatalogPrice | null {
  return CATALOG_PRICES.find((p) => p.lookupKey === lookupKey) ?? null;
}

export function seatLookupKey(tier: TierId, seat: BillableSeatType, interval: BillingInterval): string {
  return `altrixs_${V}_${tier}_${seat}_${interval}`;
}
export function addOnLookupKey(addOn: RecurringAddOnId, interval: BillingInterval): string {
  return `altrixs_${V}_addon_${addOn}_${interval}`;
}
export function minimumLookupKey(interval: BillingInterval): string {
  return `altrixs_${V}_minimum_${interval}`;
}
export function usageLookupKey(meter: UsageMeterId): string {
  return `altrixs_${V}_usage_${meter}`;
}
export function oneTimeLookupKey(kind: 'onboarding' | 'onboarding_location' | 'data_migration', tier: TierId): string {
  return `altrixs_${V}_${kind}_${tier}`;
}
