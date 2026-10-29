import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { ADD_ONS, SELF_SERVE_TIERS, TIERS, VOLUME_DISCOUNTS } from '../src/lib/billing/plans';
import { CATALOG_COUPONS, CATALOG_PRICES, CATALOG_PRODUCTS, METERS } from '../src/lib/stripe/catalog';
import { priceMatches, syncGuard } from '../src/lib/stripe/catalogSync';

/**
 * Lookup keys are permanent identifiers in Stripe. Changing a PRICE keeps its key (the sync script
 * transfers the key to the new price). Renaming or removing a KEY breaks existing subscriptions'
 * lookups — if you really mean to, bump PRICING_MODEL_VERSION and update this list deliberately.
 */
const STABLE_LOOKUP_KEYS = [
  'altrixs_v2_starter_prescriber_month',
  'altrixs_v2_starter_prescriber_year',
  'altrixs_v2_starter_clinician_month',
  'altrixs_v2_starter_clinician_year',
  'altrixs_v2_starter_paraprofessional_month',
  'altrixs_v2_starter_paraprofessional_year',
  'altrixs_v2_professional_prescriber_month',
  'altrixs_v2_professional_prescriber_year',
  'altrixs_v2_professional_clinician_month',
  'altrixs_v2_professional_clinician_year',
  'altrixs_v2_professional_paraprofessional_month',
  'altrixs_v2_professional_paraprofessional_year',
  'altrixs_v2_clinic_prescriber_month',
  'altrixs_v2_clinic_prescriber_year',
  'altrixs_v2_clinic_clinician_month',
  'altrixs_v2_clinic_clinician_year',
  'altrixs_v2_clinic_paraprofessional_month',
  'altrixs_v2_clinic_paraprofessional_year',
  'altrixs_v2_addon_ai_scribe_month',
  'altrixs_v2_addon_ai_scribe_year',
  'altrixs_v2_addon_additional_location_month',
  'altrixs_v2_addon_additional_location_year',
  'altrixs_v2_minimum_month',
  'altrixs_v2_minimum_year',
  'altrixs_v2_usage_claims',
  'altrixs_v2_usage_scribe_minutes',
  'altrixs_v2_onboarding_professional',
  'altrixs_v2_onboarding_clinic',
  'altrixs_v2_onboarding_location_professional',
  'altrixs_v2_onboarding_location_clinic',
  'altrixs_v2_data_migration_professional',
  'altrixs_v2_data_migration_clinic',
];

test('catalog lookup keys are stable', () => {
  assert.deepEqual(CATALOG_PRICES.map((p) => p.lookupKey), STABLE_LOOKUP_KEYS);
});

test('lookup keys, env vars, product ids and coupon ids are unique and well-formed', () => {
  const keys = CATALOG_PRICES.map((p) => p.lookupKey);
  const envs = [...CATALOG_PRICES.map((p) => p.envVar), ...CATALOG_COUPONS.map((c) => c.envVar)];
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(new Set(envs).size, envs.length);
  assert.equal(new Set(CATALOG_PRODUCTS.map((p) => p.id)).size, CATALOG_PRODUCTS.length);
  for (const p of CATALOG_PRICES) {
    assert.match(p.lookupKey, /^altrixs_v2_[a-z0-9_]+$/);
    assert.match(p.envVar, /^STRIPE_PRICE_V2_[A-Z0-9_]+$/);
    assert.ok(CATALOG_PRODUCTS.some((x) => x.id === p.productId), `${p.lookupKey} product exists`);
    assert.ok(Number.isInteger(p.unitAmount) && p.unitAmount > 0, `${p.lookupKey} amount`);
  }
  for (const p of CATALOG_PRODUCTS) assert.ok(p.id.length <= 64 && /^[a-z0-9_]+$/.test(p.id));
});

test('catalog amounts equal plans.ts prices (annual prices are 12 × the per-month annual rate)', () => {
  for (const p of CATALOG_PRICES) {
    const s = p.sells;
    if (s.kind === 'seat') {
      const perMonth = TIERS[s.tier].seatPrices![s.seat][s.interval];
      assert.equal(p.unitAmount, perMonth * 100 * (s.interval === 'year' ? 12 : 1), p.lookupKey);
      assert.equal(p.recurring?.interval, s.interval);
    } else if (s.kind === 'addon') {
      const a = ADD_ONS[s.addOn];
      const perMonth = s.interval === 'year' ? a.annualPerUnitPerMonth! : a.monthlyPerUnit!;
      assert.equal(p.unitAmount, perMonth * 100 * (s.interval === 'year' ? 12 : 1), p.lookupKey);
    } else if (s.kind === 'onboarding') {
      assert.equal(p.unitAmount, TIERS[s.tier].onboardingFee! * 100);
      assert.equal(p.recurring, null);
    } else if (s.kind === 'data_migration') {
      assert.equal(p.unitAmount, TIERS[s.tier].dataMigrationFee! * 100);
    } else if (s.kind === 'usage') {
      assert.equal(p.recurring?.usageType, 'metered');
      assert.ok(METERS.some((m) => m.eventName === p.recurring?.meterEventName));
    }
  }
  // Every self-serve tier is fully priced in the catalog.
  for (const tier of SELF_SERVE_TIERS) {
    assert.equal(CATALOG_PRICES.filter((p) => p.sells.kind === 'seat' && p.sells.tier === tier).length, 6, tier);
  }
  assert.deepEqual(CATALOG_COUPONS.map((c) => c.percentOff), VOLUME_DISCOUNTS.map((v) => v.percent));
});

test('sync guard: dry run by default, --apply needs a key, live keys need --live', () => {
  assert.deepEqual(syncGuard({ apply: false, live: false, key: 'sk_live_x' }), { ok: true, mode: 'dry_run' });
  assert.equal(syncGuard({ apply: true, live: false, key: '' }).ok, false);
  assert.equal(syncGuard({ apply: true, live: false, key: 'pk_test_x' }).ok, false);
  assert.deepEqual(syncGuard({ apply: true, live: false, key: 'sk_test_x' }), { ok: true, mode: 'test' });
  const refused = syncGuard({ apply: true, live: false, key: 'sk_live_x' });
  assert.equal(refused.ok, false);
  assert.match((refused as { error: string }).error, /LIVE/);
  assert.equal(syncGuard({ apply: true, live: false, key: 'rk_live_x' }).ok, false);
  assert.deepEqual(syncGuard({ apply: true, live: true, key: 'sk_live_x' }), { ok: true, mode: 'live' });
});

test('priceMatches reuses an identical price and replaces a changed one', () => {
  const p = CATALOG_PRICES.find((x) => x.lookupKey === 'altrixs_v2_clinic_clinician_month')!;
  assert.equal(priceMatches(p, { unit_amount: p.unitAmount, currency: 'usd', recurring: { interval: 'month', usage_type: 'licensed' } }), true);
  assert.equal(priceMatches(p, { unit_amount: p.unitAmount + 100, currency: 'usd', recurring: { interval: 'month', usage_type: 'licensed' } }), false);
  assert.equal(priceMatches(p, { unit_amount: p.unitAmount, currency: 'usd', recurring: { interval: 'year', usage_type: 'licensed' } }), false);
  const once = CATALOG_PRICES.find((x) => x.recurring === null)!;
  assert.equal(priceMatches(once, { unit_amount: once.unitAmount, currency: 'usd', recurring: null }), true);
});

test('the sync script is dry-run by default and documents owner approval', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'stripe-sync-catalog.ts'), 'utf8');
  assert.match(src, /OWNER APPROVAL REQUIRED/);
  assert.match(src, /--apply/);
  assert.match(src, /--live/);
  assert.ok(!/subscriptions\.create|invoices\.create|paymentIntents|charges\.create|customers\.create/.test(src), 'never creates charges or customers');
});
