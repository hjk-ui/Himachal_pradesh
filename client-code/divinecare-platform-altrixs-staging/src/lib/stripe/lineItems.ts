import {
  BILLABLE_SEAT_TYPES,
  SEAT_TYPES,
  TIERS,
  quote,
  type BillingInterval,
  type PriceQuote,
  type SeatQuantities,
  type TierId,
} from '@/lib/billing/plans';
import { addOnLookupKey, catalogPrice, minimumLookupKey, oneTimeLookupKey, seatLookupKey } from './catalog';
import { addOnPriceId, minimumPriceId, oneTimePriceId, seatPriceId, usagePriceId, volumeCouponId } from './config';

type Fail = { ok: false; error: string; status: number };

export type StripeLineItem = { price: string; quantity?: number };

export type BuiltLineItems = {
  items: StripeLineItem[];
  /** Volume-discount coupon to apply (Checkout `discounts`), when the quote has one. */
  couponId: string | null;
  quote: PriceQuote;
};

export type LineItemInput = {
  tier: TierId;
  interval: BillingInterval;
  seats: SeatQuantities;
  locations: number;
  aiScribeUsers: number;
  includeOnboarding: boolean;
  includeDataMigration: boolean;
};

function missing(lookupKey: string, what: string): Fail {
  return {
    ok: false,
    status: 503,
    error: `${what} is not configured on this server (${catalogPrice(lookupKey)?.envVar ?? lookupKey}).`,
  };
}

/**
 * Build the Stripe line items for a selection. Pure (env only). Quantities come from quote() so the
 * amount Stripe charges equals the amount the app shows. Metered usage prices (claims and scribe
 * overage) are attached when configured; they bill nothing unless usage is reported.
 */
export function buildLineItems(input: LineItemInput): BuiltLineItems | Fail {
  const t = TIERS[input.tier];
  if (!t.selfServe || !t.seatPrices) {
    return { ok: false, status: 400, error: `${t.name} is quoted by sales and cannot be bought online.` };
  }
  const q = quote({
    tier: input.tier,
    interval: input.interval,
    seats: input.seats,
    locations: input.locations,
    aiScribeUsers: input.aiScribeUsers,
    includeOnboarding: input.includeOnboarding,
    includeDataMigration: input.includeDataMigration,
  });
  if (!q) return { ok: false, status: 400, error: `${t.name} has no list price.` };
  if (t.maxProviderSeats !== null && q.providerSeats > t.maxProviderSeats) {
    return { ok: false, status: 400, error: `${t.name} is for up to ${t.maxProviderSeats} providers; this organization has ${q.providerSeats}.` };
  }

  const items: StripeLineItem[] = [];
  for (const seat of BILLABLE_SEAT_TYPES) {
    const qty = q.seats[seat];
    if (qty <= 0) continue;
    const price = seatPriceId(input.tier, seat, input.interval);
    if (!price) return missing(seatLookupKey(input.tier, seat, input.interval), `${t.name} ${SEAT_TYPES[seat].name} seat price`);
    items.push({ price, quantity: qty });
  }
  if (q.aiScribeUsers > 0) {
    const price = addOnPriceId('ai_scribe', input.interval);
    if (!price) return missing(addOnLookupKey('ai_scribe', input.interval), 'AI Scribe price');
    items.push({ price, quantity: q.aiScribeUsers });
  }
  if (q.extraLocations > 0) {
    const price = addOnPriceId('additional_location', input.interval);
    if (!price) return missing(addOnLookupKey('additional_location', input.interval), 'Additional location price');
    items.push({ price, quantity: q.extraLocations });
  }
  if (q.minimumAdjustment > 0) {
    const price = minimumPriceId(input.interval);
    if (!price) return missing(minimumLookupKey(input.interval), 'Plan minimum price');
    items.push({ price, quantity: Math.ceil(q.minimumAdjustment) });
  }
  for (const meter of ['claims', 'scribe_minutes'] as const) {
    if (meter === 'scribe_minutes' && q.aiScribeUsers === 0) continue;
    const price = usagePriceId(meter);
    if (price) items.push({ price });
  }
  for (const line of q.oneTimeLines) {
    const kind = line.id as 'onboarding' | 'onboarding_location' | 'data_migration';
    const price = oneTimePriceId(kind, input.tier);
    if (!price) return missing(oneTimeLookupKey(kind, input.tier), `${line.label} price`);
    items.push({ price, quantity: line.quantity });
  }

  let couponId: string | null = null;
  if (q.volumeDiscountPercent > 0) {
    couponId = volumeCouponId(q.volumeDiscountPercent);
    if (!couponId) {
      return { ok: false, status: 503, error: `Volume discount coupon (${q.volumeDiscountPercent}%) is not configured on this server.` };
    }
  }
  return { items, couponId, quote: q };
}
