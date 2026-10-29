import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TIERS } from '../src/lib/billing/plans';
import { CATALOG_COUPONS, CATALOG_PRICES, catalogPrice } from '../src/lib/stripe/catalog';
import { checkoutReadyFor, lookupPrice, stripeEnvReport, tierPriceId } from '../src/lib/stripe/config';
import { buildLineItems } from '../src/lib/stripe/lineItems';

const LEGACY = [
  'STRIPE_PRICE_STARTER_MONTHLY',
  'STRIPE_PRICE_PROFESSIONAL_MONTHLY',
  'STRIPE_PRICE_CLINIC_ANNUAL',
  'STRIPE_PRICE_ERX_MONTHLY',
  'STRIPE_PRICE_ONBOARDING_CLINIC',
  'STRIPE_SOLO_MONTHLY_PRICE_ID',
  'STRIPE_PRACTICE_MONTHLY_PRICE_ID',
  'STRIPE_ENTERPRISE_ANNUAL_PRICE_ID',
];
const ALL_ENV = [
  ...CATALOG_PRICES.map((p) => p.envVar),
  ...CATALOG_COUPONS.map((c) => c.envVar),
  ...LEGACY,
  'STRIPE_SECRET_KEY',
  'STRIPE_SECRET',
  'STRIPE_WEBHOOK_SECRET',
];

function withEnv(values: Record<string, string>, fn: () => void) {
  const saved: Record<string, string | undefined> = {};
  for (const k of ALL_ENV) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  Object.assign(process.env, values);
  try {
    fn();
  } finally {
    for (const k of ALL_ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

const env = (lookupKey: string) => catalogPrice(lookupKey)!.envVar;

/** Every v2 price for one tier/interval set to a fake id `price_<lookupKey>`. */
function tierEnv(tier: string, interval: 'month' | 'year'): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of CATALOG_PRICES) {
    const s = p.sells;
    if (
      (s.kind === 'seat' && s.tier === tier && s.interval === interval) ||
      (s.kind === 'addon' && s.interval === interval) ||
      (s.kind === 'minimum' && s.interval === interval) ||
      s.kind === 'usage' ||
      ((s.kind === 'onboarding' || s.kind === 'onboarding_location' || s.kind === 'data_migration') && s.tier === tier)
    ) {
      out[p.envVar] = `price_${p.lookupKey}`;
    }
  }
  return out;
}

test('price IDs are missing until env is set, and checkout is not ready', () => {
  withEnv({}, () => {
    assert.equal(tierPriceId('starter', 'month'), null);
    assert.equal(checkoutReadyFor('starter', 'month'), false);
    assert.ok(stripeEnvReport().every((r) => r.set === false));
  });
});

test('checkout needs the secret key, every seat price and the minimum price', () => {
  withEnv(tierEnv('professional', 'month'), () => {
    assert.equal(checkoutReadyFor('professional', 'month'), false, 'no key');
  });
  withEnv({ STRIPE_SECRET_KEY: 'sk_test_x', ...tierEnv('professional', 'month') }, () => {
    assert.equal(checkoutReadyFor('professional', 'month'), true);
    assert.equal(checkoutReadyFor('professional', 'year'), false);
    assert.equal(checkoutReadyFor('enterprise', 'month'), false);
  });
  const partial = tierEnv('professional', 'month');
  delete partial[env('altrixs_v2_professional_paraprofessional_month')];
  withEnv({ STRIPE_SECRET_KEY: 'sk_test_x', ...partial }, () => {
    assert.equal(checkoutReadyFor('professional', 'month'), false, 'one seat type missing');
  });
});

test('lookupPrice maps v2 catalog prices and model v1 / older price ids', () => {
  withEnv(
    {
      [env('altrixs_v2_clinic_prescriber_year')]: 'price_clinic_rx_y',
      [env('altrixs_v2_addon_ai_scribe_month')]: 'price_ai_m',
      [env('altrixs_v2_onboarding_clinic')]: 'price_ob_clinic',
      STRIPE_PRICE_CLINIC_ANNUAL: 'price_v1_clinic_y',
      STRIPE_PRICE_ERX_MONTHLY: 'price_v1_erx',
      STRIPE_SOLO_MONTHLY_PRICE_ID: 'price_legacy_solo',
      STRIPE_ENTERPRISE_ANNUAL_PRICE_ID: 'price_legacy_ent',
    },
    () => {
      assert.deepEqual(lookupPrice('price_clinic_rx_y'), { kind: 'seat', tier: 'clinic', seat: 'prescriber', interval: 'year' });
      assert.deepEqual(lookupPrice('price_ai_m'), { kind: 'addon', addOn: 'ai_scribe', interval: 'month' });
      assert.deepEqual(lookupPrice('price_ob_clinic'), { kind: 'onboarding', tier: 'clinic' });
      assert.deepEqual(lookupPrice('price_v1_clinic_y'), { kind: 'tier', tier: 'clinic', interval: 'year' });
      assert.deepEqual(lookupPrice('price_v1_erx'), { kind: 'legacy_addon', addOn: 'eprescribing', interval: 'month' });
      assert.deepEqual(lookupPrice('price_legacy_solo'), { kind: 'tier', tier: 'starter', interval: 'month' });
      assert.deepEqual(lookupPrice('price_legacy_ent'), { kind: 'tier', tier: 'clinic', interval: 'year' });
      assert.equal(lookupPrice('price_unknown'), null);
      assert.equal(lookupPrice(null), null);
    }
  );
});

test('line items: one line per seat type, AI Scribe per user, minimum top-up, metered usage, one-time fees', () => {
  withEnv({ STRIPE_SECRET_KEY: 'sk_test_x', ...tierEnv('clinic', 'month') }, () => {
    const small = buildLineItems({
      tier: 'clinic',
      interval: 'month',
      seats: { prescriber: 1, clinician: 2, paraprofessional: 0 },
      locations: 3,
      aiScribeUsers: 1,
      includeOnboarding: true,
      includeDataMigration: true,
    });
    assert.ok('items' in small);
    const q = small.quote;
    assert.ok(q.minimumAdjustment > 0, 'below the Clinic minimum');
    assert.deepEqual(small.items, [
      { price: 'price_altrixs_v2_clinic_prescriber_month', quantity: 1 },
      { price: 'price_altrixs_v2_clinic_clinician_month', quantity: 2 },
      { price: 'price_altrixs_v2_addon_ai_scribe_month', quantity: 1 },
      { price: 'price_altrixs_v2_minimum_month', quantity: Math.ceil(q.minimumAdjustment) },
      { price: 'price_altrixs_v2_usage_claims' },
      { price: 'price_altrixs_v2_usage_scribe_minutes' },
      { price: 'price_altrixs_v2_onboarding_clinic', quantity: 1 },
      { price: 'price_altrixs_v2_onboarding_location_clinic', quantity: 2 },
      { price: 'price_altrixs_v2_data_migration_clinic', quantity: 1 },
    ]);
    assert.equal(small.couponId, null);
    // Stripe charges what the app shows: seat + add-on + minimum lines sum to the quote.
    const amount = (key: string) => catalogPrice(key)!.unitAmount / 100;
    const recurring =
      amount('altrixs_v2_clinic_prescriber_month') * 1 +
      amount('altrixs_v2_clinic_clinician_month') * 2 +
      amount('altrixs_v2_addon_ai_scribe_month') * 1 +
      amount('altrixs_v2_minimum_month') * Math.ceil(q.minimumAdjustment);
    assert.equal(recurring, Math.ceil(q.subscriptionPerMonth));
  });
});

test('line items: volume coupon required at 25+ providers; Starter provider cap and Enterprise refused', () => {
  withEnv({ STRIPE_SECRET_KEY: 'sk_test_x', ...tierEnv('clinic', 'month') }, () => {
    const big = buildLineItems({ tier: 'clinic', interval: 'month', seats: { prescriber: 5, clinician: 25, paraprofessional: 0 }, locations: 1, aiScribeUsers: 0, includeOnboarding: false, includeDataMigration: false });
    assert.ok(!('items' in big), 'coupon env missing');
    assert.match((big as { error: string }).error, /coupon/);
  });
  withEnv({ STRIPE_SECRET_KEY: 'sk_test_x', ...tierEnv('clinic', 'month'), [CATALOG_COUPONS[0].envVar]: CATALOG_COUPONS[0].id }, () => {
    const big = buildLineItems({ tier: 'clinic', interval: 'month', seats: { prescriber: 5, clinician: 25, paraprofessional: 0 }, locations: 1, aiScribeUsers: 0, includeOnboarding: false, includeDataMigration: false });
    assert.ok('items' in big);
    assert.equal(big.couponId, CATALOG_COUPONS[0].id);
  });
  withEnv({ STRIPE_SECRET_KEY: 'sk_test_x', ...tierEnv('starter', 'month') }, () => {
    const over = buildLineItems({ tier: 'starter', interval: 'month', seats: { prescriber: 0, clinician: TIERS.starter.maxProviderSeats! + 1, paraprofessional: 0 }, locations: 1, aiScribeUsers: 0, includeOnboarding: false, includeDataMigration: false });
    assert.ok(!('items' in over));
    const missing = buildLineItems({ tier: 'starter', interval: 'year', seats: { prescriber: 0, clinician: 2, paraprofessional: 0 }, locations: 1, aiScribeUsers: 0, includeOnboarding: false, includeDataMigration: false });
    assert.ok(!('items' in missing));
    assert.match((missing as { error: string }).error, /STRIPE_PRICE_V2_STARTER_CLINICIAN_YEAR/);
    const ent = buildLineItems({ tier: 'enterprise', interval: 'month', seats: { prescriber: 0, clinician: 50, paraprofessional: 0 }, locations: 1, aiScribeUsers: 0, includeOnboarding: false, includeDataMigration: false });
    assert.ok(!('items' in ent));
  });
});
