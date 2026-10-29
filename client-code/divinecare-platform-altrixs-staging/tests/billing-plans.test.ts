import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  ADD_ONS,
  ADD_ON_ORDER,
  ANNUAL_DISCOUNT_PERCENT,
  BILLABLE_SEAT_TYPES,
  FEATURES,
  FEATURE_IDS,
  ESTIMATE_LIST_PRICE_LABEL,
  ESTIMATE_NOT_BILLED_LABEL,
  PRICING_APPROVAL,
  PRICING_FAQ,
  SELF_SERVE_TIERS,
  TIERS,
  TIER_ORDER,
  annualFromMonthly,
  billingServiceOffered,
  estimateLabel,
  pricingApproved,
  publicAddOnOrder,
  seatUnitPrice,
  tierFromLegacyPlan,
  tierPriceLabel,
} from '../src/lib/billing/plans';

test('every self-serve tier prices every seat type; prescriber > clinician > program staff; annual is discounted', () => {
  assert.deepEqual(Object.keys(TIERS).sort(), [...TIER_ORDER].sort());
  for (const id of SELF_SERVE_TIERS) {
    const t = TIERS[id];
    assert.ok(t.seatPrices, `${id} has seat prices`);
    for (const seat of BILLABLE_SEAT_TYPES) {
      const p = t.seatPrices![seat];
      assert.ok(p.month > 0 && Number.isInteger(p.month), `${id} ${seat} monthly`);
      assert.equal(p.year, annualFromMonthly(p.month), `${id} ${seat} annual = monthly less ${ANNUAL_DISCOUNT_PERCENT}%`);
      assert.ok(p.year < p.month);
    }
    assert.ok(t.seatPrices!.prescriber.month > t.seatPrices!.clinician.month, `${id} prescriber > clinician`);
    assert.ok(t.seatPrices!.clinician.month > t.seatPrices!.paraprofessional.month, `${id} clinician > program staff`);
    assert.ok(t.minimumMonthly !== null && t.minimumMonthly > 0, `${id} minimum`);
    assert.ok(t.highlights.length >= 3);
    assert.ok(t.onboardingFee !== null && t.onboardingFee >= 0);
    assert.ok(t.dataMigrationFee !== null && t.dataMigrationFee >= 0);
  }
  // Higher tiers cost more for every seat type.
  for (let i = 1; i < SELF_SERVE_TIERS.length; i += 1) {
    for (const seat of BILLABLE_SEAT_TYPES) {
      assert.ok(
        seatUnitPrice(SELF_SERVE_TIERS[i], seat, 'month')! > seatUnitPrice(SELF_SERVE_TIERS[i - 1], seat, 'month')!,
        `${SELF_SERVE_TIERS[i]} ${seat} costs more than ${SELF_SERVE_TIERS[i - 1]}`
      );
    }
  }
  assert.equal(TIERS.enterprise.selfServe, false);
  assert.equal(TIERS.enterprise.seatPrices, null);
  assert.equal(tierPriceLabel('enterprise', 'month'), 'Custom quote');
  assert.match(tierPriceLabel('clinic', 'month'), /^From \$\d+ per clinician/);
});

test('feature matrix covers every tier, explains every row, and add-on cells name a real add-on', () => {
  assert.equal(new Set(FEATURE_IDS).size, FEATURE_IDS.length, 'feature ids unique');
  for (const f of FEATURES) {
    assert.deepEqual(Object.keys(f.tiers).sort(), [...TIER_ORDER].sort(), `${f.id} covers every tier`);
    assert.ok(f.explain.length > 20, `${f.id} has a plain-language explanation`);
    assert.ok(f.where.length > 0, `${f.id} maps to a real screen`);
    if (Object.values(f.tiers).includes('addon')) {
      assert.ok(f.addOn && ADD_ONS[f.addOn], `${f.id} add-on exists`);
      for (const t of TIER_ORDER) {
        if (f.tiers[t] === 'addon') assert.ok(ADD_ONS[f.addOn!].availableOn.includes(t), `${f.id} add-on sold on ${t}`);
      }
    }
  }
  // Higher tiers never lose a feature a lower tier has.
  const rank = { none: 0, addon: 1, included: 2 } as const;
  for (const f of FEATURES) {
    for (let i = 1; i < TIER_ORDER.length; i += 1) {
      assert.ok(rank[f.tiers[TIER_ORDER[i]]] >= rank[f.tiers[TIER_ORDER[i - 1]]], `${f.id}: ${TIER_ORDER[i]} >= ${TIER_ORDER[i - 1]}`);
    }
  }
  // e-prescribing comes with prescriber seats on every tier; AI Scribe is per user everywhere.
  assert.ok(Object.values(FEATURES.find((f) => f.id === 'eprescribing')!.tiers).every((a) => a === 'included'));
  assert.ok(Object.values(FEATURES.find((f) => f.id === 'ai_scribe')!.tiers).every((a) => a === 'addon'));
});

test('add-ons: recurring ones have discounted annual prices, never both sold and included on a tier', () => {
  for (const id of ADD_ON_ORDER) {
    const a = ADD_ONS[id];
    for (const t of a.availableOn) assert.ok(!a.includedOn.includes(t), `${id} both sold and included on ${t}`);
    if (a.kind === 'recurring') {
      assert.ok(a.monthlyPerUnit! > 0);
      assert.equal(a.annualPerUnitPerMonth, annualFromMonthly(a.monthlyPerUnit!));
    } else {
      assert.equal(a.monthlyPerUnit, null);
    }
  }
});

test('legacy plan ids map to tiers', () => {
  assert.equal(tierFromLegacyPlan('solo'), 'starter');
  assert.equal(tierFromLegacyPlan('practice'), 'professional');
  assert.equal(tierFromLegacyPlan('growth'), 'professional');
  assert.equal(tierFromLegacyPlan('enterprise'), 'enterprise');
  assert.equal(tierFromLegacyPlan('free'), null);
});

test('pricing approved by the owner; "proposed" labels go away when NEXT_PUBLIC_PRICING_APPROVED=true', () => {
  assert.deepEqual(PRICING_APPROVAL, { model: 'v2', approvedBy: 'owner', approvedOn: '2026-10-20', via: 'chat' });
  const saved = process.env.NEXT_PUBLIC_PRICING_APPROVED;
  try {
    delete process.env.NEXT_PUBLIC_PRICING_APPROVED;
    assert.equal(pricingApproved(), false);
    assert.equal(estimateLabel(), ESTIMATE_NOT_BILLED_LABEL);
    process.env.NEXT_PUBLIC_PRICING_APPROVED = 'true';
    assert.equal(pricingApproved(), true);
    assert.equal(estimateLabel(), ESTIMATE_LIST_PRICE_LABEL);
    assert.doesNotMatch(estimateLabel(), /proposed|not billed/i);
  } finally {
    if (saved === undefined) delete process.env.NEXT_PUBLIC_PRICING_APPROVED;
    else process.env.NEXT_PUBLIC_PRICING_APPROVED = saved;
  }
  assert.ok(PRICING_FAQ.length >= 10);
  assert.equal(new Set(PRICING_FAQ.map((f) => f.id)).size, PRICING_FAQ.length);
  // Every surface uses the switch: the public notice hides itself, the calculator and the plan page use estimateLabel()
  const src = (f: string) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
  assert.match(src('components/marketing/PricingPlans.tsx'), /if \(pricingApproved\(\)\) return null/);
  assert.match(src('components/marketing/QuoteCalculator.tsx'), /!pricingApproved\(\)/);
  const sub = src('app/dashboard/subscription/page.tsx');
  assert.doesNotMatch(sub, /ESTIMATE_NOT_BILLED_LABEL/);
  assert.match(sub, /estimateLabel\(\)/);
});

test('full billing service: hidden from the pricing page and FAQ says "available on request" (decision 2026-10-20)', () => {
  assert.equal(process.env.NEXT_PUBLIC_BILLING_SERVICE_OFFERED, undefined);
  assert.equal(billingServiceOffered(), false);
  assert.ok(ADD_ON_ORDER.includes('billing_service'), 'kept in code');
  assert.ok(!publicAddOnOrder().includes('billing_service'));
  const faq = PRICING_FAQ.find((f) => f.id === 'billing_service')!;
  assert.match(faq.answer, /available on request/);
  assert.doesNotMatch(faq.answer, /%/);
  const cards = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'marketing', 'PricingPlans.tsx'), 'utf8');
  assert.match(cards, /publicAddOnOrder\(\)\.map/);
  assert.doesNotMatch(cards, /ADD_ON_ORDER/);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'marketing', 'QuoteCalculator.tsx'), 'utf8'), /billingService/);
});

test('no pricing surface hard-codes a dollar price (all come from plans.ts)', () => {
  const root = path.join(__dirname, '..', 'src');
  const files = [
    'components/marketing/HomePage.tsx',
    'components/marketing/PricingPlans.tsx',
    'components/marketing/PricingSection.tsx',
    'components/marketing/QuoteCalculator.tsx',
    'app/get-started/page.tsx',
    'app/dashboard/subscription/page.tsx',
    'components/subscription/PracticePlanBanner.tsx',
  ];
  for (const f of files) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    const literal = src.match(/\$\d[\d,]*(\.\d+)?/g) || [];
    assert.deepEqual(literal, [], `${f} hard-codes ${literal.join(', ')}`);
  }
  assert.equal(fs.existsSync(path.join(root, 'lib/subscription/catalog.ts')), false, 'old catalog removed');
});
