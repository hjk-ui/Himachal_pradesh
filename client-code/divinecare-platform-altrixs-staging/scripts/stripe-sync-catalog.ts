/**
 * Sync the Altrixs pricing catalog (src/lib/stripe/catalog.ts, generated from src/lib/billing/plans.ts)
 * into a Stripe account.
 *
 *   npx tsx scripts/stripe-sync-catalog.ts                 # dry run: print what would be created (no network)
 *   STRIPE_SECRET_KEY=sk_test_... npx tsx scripts/stripe-sync-catalog.ts --apply         # test mode
 *   STRIPE_SECRET_KEY=sk_live_... npx tsx scripts/stripe-sync-catalog.ts --apply --live  # LIVE — owner approval required
 *
 * OWNER APPROVAL REQUIRED before any --live run: creating live products/prices makes the proposed
 * pricing purchasable. The owner must approve the numbers in docs/pricing-model.md in writing first,
 * and NEXT_PUBLIC_PRICING_APPROVED=true must be set for live Checkout to open anyway.
 *
 * What --apply does (idempotent):
 *  - billing meters for the two usage prices: created if no meter has the event name;
 *  - products: created with the catalog id if missing, name/description updated if changed;
 *  - prices: reused when the lookup key's price matches; otherwise a new price is created and the
 *    lookup key transferred to it (Stripe prices are immutable). Old prices are left active;
 *  - volume coupons: created with the catalog id if missing.
 * It never creates customers, subscriptions, invoices or charges.
 * At the end it prints the env vars (STRIPE_PRICE_V2_... / STRIPE_COUPON_V2_...) to set on the server.
 */
import Stripe from 'stripe';
import { CATALOG_COUPONS, CATALOG_PRICES, CATALOG_PRODUCTS, METERS } from '../src/lib/stripe/catalog';
import { priceMatches, syncGuard } from '../src/lib/stripe/catalogSync';
import { pricingApproved } from '../src/lib/billing/plans';

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const live = args.has('--live');

function usd(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function printPlan() {
  console.log(`Catalog: ${CATALOG_PRODUCTS.length} products, ${CATALOG_PRICES.length} prices, ${CATALOG_COUPONS.length} coupons, ${METERS.length} meters.\n`);
  for (const p of CATALOG_PRICES) {
    const per = p.recurring ? `/${p.recurring.interval}${p.recurring.usageType === 'metered' ? ' metered' : ''}` : ' one-time';
    console.log(`  ${p.lookupKey.padEnd(46)} ${usd(p.unitAmount).padStart(10)}${per.padEnd(16)} ${p.nickname}`);
  }
  for (const c of CATALOG_COUPONS) console.log(`  coupon ${c.id.padEnd(39)} ${c.percentOff}% off, forever (${c.name})`);
  for (const m of METERS) console.log(`  meter  ${m.eventName}`);
}

async function main() {
  const guard = syncGuard({ apply, live, key: process.env.STRIPE_SECRET_KEY });
  if (guard.ok === false) {
    console.error(`Refused: ${guard.error}`);
    process.exitCode = 1;
    return;
  }
  console.log('Altrixs pricing catalog sync. Pricing is PROPOSED unless the owner has approved it.');
  console.log(`Mode: ${guard.mode}. NEXT_PUBLIC_PRICING_APPROVED=${pricingApproved() ? 'true' : 'false'}\n`);
  printPlan();
  if (guard.mode === 'dry_run') {
    console.log('\nDry run: nothing was sent to Stripe. Re-run with --apply and a TEST key to create these objects.');
    return;
  }
  if (guard.mode === 'live') {
    console.log('\nLIVE MODE: proceeding because --live was passed. This must only be run after written owner approval.');
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!.trim());
  const env: string[] = [];

  // Meters
  const meters = await stripe.billing.meters.list({ limit: 100 });
  for (const m of METERS) {
    if (meters.data.some((x) => x.event_name === m.eventName)) continue;
    await stripe.billing.meters.create({
      display_name: m.displayName,
      event_name: m.eventName,
      default_aggregation: { formula: 'sum' },
    });
    console.log(`created meter ${m.eventName}`);
  }
  const meterIds = new Map((await stripe.billing.meters.list({ limit: 100 })).data.map((x) => [x.event_name, x.id]));

  // Products
  for (const p of CATALOG_PRODUCTS) {
    try {
      const existing = await stripe.products.retrieve(p.id);
      if (existing.name !== p.name || existing.description !== p.description) {
        await stripe.products.update(p.id, { name: p.name, description: p.description });
        console.log(`updated product ${p.id}`);
      }
    } catch {
      await stripe.products.create({ id: p.id, name: p.name, description: p.description, metadata: { source: 'altrixs-catalog' } });
      console.log(`created product ${p.id}`);
    }
  }

  // Prices
  for (const p of CATALOG_PRICES) {
    const found = await stripe.prices.list({ lookup_keys: [p.lookupKey], limit: 1 });
    const have = found.data[0];
    if (have && priceMatches(p, { unit_amount: have.unit_amount, currency: have.currency, recurring: have.recurring ? { interval: have.recurring.interval, usage_type: have.recurring.usage_type } : null })) {
      env.push(`${p.envVar}=${have.id}`);
      continue;
    }
    const recurring = p.recurring
      ? {
          interval: p.recurring.interval,
          usage_type: p.recurring.usageType,
          ...(p.recurring.meterEventName ? { meter: meterIds.get(p.recurring.meterEventName) } : {}),
        }
      : undefined;
    const created = await stripe.prices.create({
      product: p.productId,
      currency: p.currency,
      unit_amount: p.unitAmount,
      nickname: p.nickname,
      lookup_key: p.lookupKey,
      transfer_lookup_key: true,
      ...(recurring ? { recurring } : {}),
      metadata: { source: 'altrixs-catalog', lookupKey: p.lookupKey },
    });
    console.log(`${have ? 'replaced' : 'created'} price ${p.lookupKey} -> ${created.id}`);
    env.push(`${p.envVar}=${created.id}`);
  }

  // Coupons
  for (const c of CATALOG_COUPONS) {
    try {
      await stripe.coupons.retrieve(c.id);
    } catch {
      await stripe.coupons.create({ id: c.id, name: c.name, percent_off: c.percentOff, duration: 'forever' });
      console.log(`created coupon ${c.id}`);
    }
    env.push(`${c.envVar}=${c.id}`);
  }

  console.log('\nSet these on the server (.env), then restart:\n');
  console.log(env.join('\n'));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
