import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stripePriceIdFor, stripePriceIdsConfigured } from '../src/lib/stripe/config';

test('stripe price IDs are missing until env is set', () => {
  delete process.env.STRIPE_SOLO_MONTHLY_PRICE_ID;
  delete process.env.STRIPE_SOLO_ANNUAL_PRICE_ID;
  delete process.env.STRIPE_PROFESSIONAL_MONTHLY_PRICE_ID;
  delete process.env.STRIPE_PROFESSIONAL_ANNUAL_PRICE_ID;
  delete process.env.STRIPE_PRACTICE_MONTHLY_PRICE_ID;
  delete process.env.STRIPE_PRACTICE_ANNUAL_PRICE_ID;
  delete process.env.STRIPE_ENTERPRISE_MONTHLY_PRICE_ID;
  assert.equal(stripePriceIdFor('solo', 'monthly'), null);
  assert.equal(stripePriceIdsConfigured(), false);
});

test('professional falls back to growth price env aliases', () => {
  process.env.STRIPE_GROWTH_MONTHLY_PRICE_ID = 'price_growth_m';
  process.env.STRIPE_GROWTH_ANNUAL_PRICE_ID = 'price_growth_a';
  assert.equal(stripePriceIdFor('professional', 'monthly'), 'price_growth_m');
  assert.equal(stripePriceIdFor('professional', 'annual'), 'price_growth_a');
});

test('checkout is ready when monthly Solo and Practice price IDs exist', () => {
  process.env.STRIPE_SOLO_MONTHLY_PRICE_ID = 'price_solo_m';
  process.env.STRIPE_PRACTICE_MONTHLY_PRICE_ID = 'price_practice_m';
  assert.equal(stripePriceIdsConfigured(), true);
  assert.equal(stripePriceIdFor('enterprise', 'monthly'), null);
});
