import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ADD_ONS,
  ANNUAL_DISCOUNT_PERCENT,
  AI_SCRIBE_INCLUDED_MINUTES,
  AI_SCRIBE_OVERAGE_PER_MINUTE,
  BILLING_SERVICE_MINIMUM_MONTHLY,
  BILLING_SERVICE_PERCENT,
  CLAIM_OVERAGE_PER_CLAIM,
  ENTERPRISE_RECOMMENDED_PROVIDER_SEATS,
  TIERS,
  VOLUME_DISCOUNTS,
  quote,
  smallestFittingTier,
  volumeDiscountPercent,
} from '../src/lib/billing/plans';

const P = (tier: 'starter' | 'professional' | 'clinic') => TIERS[tier].seatPrices!;

test('monthly quote: seats priced by type, support staff free', () => {
  const q = quote({ tier: 'professional', interval: 'month', seats: { prescriber: 2, clinician: 6, paraprofessional: 3 } })!;
  const expected = 2 * P('professional').prescriber.month + 6 * P('professional').clinician.month + 3 * P('professional').paraprofessional.month;
  assert.equal(q.seatSubtotal, expected);
  assert.equal(q.subscriptionPerMonth, expected);
  assert.equal(q.subscriptionPerInvoice, expected);
  assert.equal(q.providerSeats, 8);
  assert.equal(q.billableSeats, 11);
  assert.deepEqual(q.lines.map((l) => l.id), ['seat_prescriber', 'seat_clinician', 'seat_paraprofessional']);
});

test('annual quote uses annual unit prices; the invoice is 12 months', () => {
  const q = quote({ tier: 'clinic', interval: 'year', seats: { prescriber: 3, clinician: 10 }, aiScribeUsers: 4 })!;
  const perMonth = 3 * P('clinic').prescriber.year + 10 * P('clinic').clinician.year + 4 * ADD_ONS.ai_scribe.annualPerUnitPerMonth!;
  assert.equal(q.subscriptionPerMonth, perMonth);
  assert.equal(q.subscriptionPerInvoice, perMonth * 12);
  const monthly = quote({ tier: 'clinic', interval: 'month', seats: { prescriber: 3, clinician: 10 }, aiScribeUsers: 4 })!;
  assert.ok(q.subscriptionPerMonth < monthly.subscriptionPerMonth, 'annual is cheaper per month');
});

test('plan minimum tops the subscription up; it is a separate line', () => {
  const q = quote({ tier: 'clinic', interval: 'month', seats: { clinician: 2 } })!;
  const seats = 2 * P('clinic').clinician.month;
  assert.equal(q.minimumAdjustment, TIERS.clinic.minimumMonthly! - seats);
  assert.equal(q.subscriptionPerMonth, TIERS.clinic.minimumMonthly);
  assert.ok(q.lines.some((l) => l.kind === 'minimum'));
  const big = quote({ tier: 'clinic', interval: 'month', seats: { clinician: 20 } })!;
  assert.equal(big.minimumAdjustment, 0);
  const empty = quote({ tier: 'starter', interval: 'month', seats: {} })!;
  assert.equal(empty.subscriptionPerMonth, TIERS.starter.minimumMonthly);
});

test('volume discount applies to seat charges only, by provider seats', () => {
  assert.equal(volumeDiscountPercent(24), 0);
  assert.equal(volumeDiscountPercent(VOLUME_DISCOUNTS[0].minProviderSeats), VOLUME_DISCOUNTS[0].percent);
  assert.equal(volumeDiscountPercent(VOLUME_DISCOUNTS[1].minProviderSeats + 5), VOLUME_DISCOUNTS[1].percent);
  const q = quote({ tier: 'clinic', interval: 'month', seats: { clinician: 25, paraprofessional: 10 }, aiScribeUsers: 5 })!;
  assert.equal(q.volumeDiscountPercent, 5);
  assert.equal(q.volumeDiscount, Math.round(q.seatSubtotal * 0.05 * 100) / 100);
  assert.equal(q.subscriptionPerMonth, q.seatSubtotal - q.volumeDiscount + 5 * ADD_ONS.ai_scribe.monthlyPerUnit!);
  // Program staff do not count toward the volume threshold.
  assert.equal(quote({ tier: 'clinic', interval: 'month', seats: { clinician: 20, paraprofessional: 30 } })!.volumeDiscountPercent, 0);
});

test('add-ons: AI Scribe per user (capped at paid seats); extra locations only on Professional', () => {
  const q = quote({ tier: 'starter', interval: 'month', seats: { clinician: 2 }, aiScribeUsers: 5 })!;
  assert.equal(q.aiScribeUsers, 2);
  assert.ok(q.warnings.some((w) => /capped/.test(w)));
  const pro = quote({ tier: 'professional', interval: 'month', seats: { clinician: 10 }, locations: 4 })!;
  assert.equal(pro.extraLocations, 4 - TIERS.professional.includedLocations!);
  assert.equal(pro.addOnSubtotal, pro.extraLocations * ADD_ONS.additional_location.monthlyPerUnit!);
  const clinic = quote({ tier: 'clinic', interval: 'month', seats: { clinician: 10 }, locations: 9 })!;
  assert.equal(clinic.extraLocations, 0, 'Clinic includes unlimited locations');
  const starter = quote({ tier: 'starter', interval: 'month', seats: { clinician: 2 }, locations: 2 })!;
  assert.ok(starter.warnings.some((w) => /location/.test(w)));
});

test('usage: claims and AI Scribe minutes above the pooled allowance', () => {
  const q = quote({
    tier: 'professional',
    interval: 'month',
    seats: { clinician: 4 },
    expectedClaimsPerMonth: 4 * TIERS.professional.claimsPerSeat! + 100,
    aiScribeUsers: 2,
    expectedScribeMinutesPerMonth: 2 * AI_SCRIBE_INCLUDED_MINUTES + 500,
  })!;
  assert.equal(q.claimsAllowance, 4 * TIERS.professional.claimsPerSeat!);
  assert.equal(q.claimsOverage, 100 * CLAIM_OVERAGE_PER_CLAIM);
  assert.equal(q.scribeOverage, 500 * AI_SCRIBE_OVERAGE_PER_MINUTE);
  assert.equal(q.estimatedMonthlyTotal, q.subscriptionPerMonth + q.claimsOverage + q.scribeOverage);
  assert.equal(q.estimatedAnnualTotal, q.estimatedMonthlyTotal * 12);
  const under = quote({ tier: 'clinic', interval: 'month', seats: { clinician: 10 }, expectedClaimsPerMonth: 500 })!;
  assert.equal(under.claimsOverage, 0);
});

test('billing service: hidden from quotes by default; percent of collections with a minimum when offered', () => {
  const saved = process.env.NEXT_PUBLIC_BILLING_SERVICE_OFFERED;
  try {
    delete process.env.NEXT_PUBLIC_BILLING_SERVICE_OFFERED;
    assert.equal(
      quote({ tier: 'clinic', interval: 'month', seats: { clinician: 10 }, billingServiceCollections: 100000 })!.servicePerMonth,
      0,
      'not offered until Altrixs has billing staff (decision 2026-10-20)'
    );
    process.env.NEXT_PUBLIC_BILLING_SERVICE_OFFERED = 'true';
    const q = quote({ tier: 'clinic', interval: 'month', seats: { clinician: 10 }, billingServiceCollections: 100000 })!;
    assert.equal(q.servicePerMonth, (100000 * BILLING_SERVICE_PERCENT) / 100);
    const small = quote({ tier: 'clinic', interval: 'month', seats: { clinician: 10 }, billingServiceCollections: 1000 })!;
    assert.equal(small.servicePerMonth, BILLING_SERVICE_MINIMUM_MONTHLY);
    assert.equal(quote({ tier: 'starter', interval: 'month', seats: { clinician: 1 }, billingServiceCollections: 50000 })!.servicePerMonth, 0, 'not offered on Starter');
  } finally {
    if (saved === undefined) delete process.env.NEXT_PUBLIC_BILLING_SERVICE_OFFERED;
    else process.env.NEXT_PUBLIC_BILLING_SERVICE_OFFERED = saved;
  }
});

test('approved price table (owner decision 2026-10-20)', () => {
  const table = Object.fromEntries(
    (['starter', 'professional', 'clinic'] as const).map((t) => [
      t,
      {
        prescriber: TIERS[t].seatPrices!.prescriber,
        clinician: TIERS[t].seatPrices!.clinician,
        paraprofessional: TIERS[t].seatPrices!.paraprofessional,
        minimum: TIERS[t].minimumMonthly,
        claims: TIERS[t].claimsPerSeat,
        onboarding: TIERS[t].onboardingFee,
        perSite: TIERS[t].onboardingPerExtraLocation,
        migration: TIERS[t].dataMigrationFee,
      },
    ])
  );
  assert.deepEqual(table, {
    starter: { prescriber: { month: 249, year: 212 }, clinician: { month: 99, year: 84 }, paraprofessional: { month: 39, year: 33 }, minimum: 99, claims: 50, onboarding: 0, perSite: 0, migration: 0 },
    professional: { prescriber: { month: 299, year: 254 }, clinician: { month: 139, year: 118 }, paraprofessional: { month: 49, year: 42 }, minimum: 499, claims: 150, onboarding: 1500, perSite: 500, migration: 1500 },
    clinic: { prescriber: { month: 349, year: 297 }, clinician: { month: 179, year: 152 }, paraprofessional: { month: 59, year: 50 }, minimum: 1500, claims: 200, onboarding: 4000, perSite: 750, migration: 3500 },
  });
  assert.equal(TIERS.clinic.sla, '99.5% monthly uptime target; 4 business-hour response on urgent tickets');
  assert.equal(ANNUAL_DISCOUNT_PERCENT, 15);
  assert.deepEqual(VOLUME_DISCOUNTS, [
    { minProviderSeats: 25, percent: 5 },
    { minProviderSeats: 50, percent: 10 },
  ]);
  assert.equal(ENTERPRISE_RECOMMENDED_PROVIDER_SEATS, 75);
  assert.equal(CLAIM_OVERAGE_PER_CLAIM, 0.3);
  assert.equal(ADD_ONS.additional_location.monthlyPerUnit, 99);
});

test('one-time: onboarding per tier plus per extra site, and data migration', () => {
  const q = quote({ tier: 'clinic', interval: 'month', seats: { clinician: 10 }, locations: 3, includeOnboarding: true, includeDataMigration: true })!;
  assert.equal(q.oneTime, TIERS.clinic.onboardingFee! + 2 * TIERS.clinic.onboardingPerExtraLocation + TIERS.clinic.dataMigrationFee!);
  const starter = quote({ tier: 'starter', interval: 'month', seats: { clinician: 1 }, includeOnboarding: true, includeDataMigration: true })!;
  assert.equal(starter.oneTime, 0);
  assert.equal(quote({ tier: 'clinic', interval: 'month', seats: { clinician: 10 } })!.oneTime, 0);
});

test('limits: Starter provider cap, Enterprise is quoted, large orgs flagged for Enterprise', () => {
  const over = quote({ tier: 'starter', interval: 'month', seats: { clinician: TIERS.starter.maxProviderSeats! + 1 } })!;
  assert.ok(over.warnings.some((w) => /up to/.test(w)));
  assert.equal(quote({ tier: 'enterprise', interval: 'month', seats: { clinician: 100 } }), null);
  const big = quote({ tier: 'clinic', interval: 'month', seats: { clinician: ENTERPRISE_RECOMMENDED_PROVIDER_SEATS } })!;
  assert.equal(big.enterpriseRecommended, true);
  assert.equal(smallestFittingTier({ clinician: 3, prescriber: 1 }, 1), 'starter');
  assert.equal(smallestFittingTier({ clinician: 3 }, 2), 'professional');
  assert.equal(smallestFittingTier({ clinician: 12, prescriber: 3 }, 2), 'professional');
});

test('bad input is clamped, never negative', () => {
  const q = quote({ tier: 'professional', interval: 'month', seats: { clinician: -4, prescriber: 2.7 }, locations: -3, aiScribeUsers: Number.NaN })!;
  assert.deepEqual(q.seats, { prescriber: 2, clinician: 0, paraprofessional: 0 });
  assert.equal(q.locations, 1);
  assert.equal(q.aiScribeUsers, 0);
  assert.ok(q.subscriptionPerMonth >= TIERS.professional.minimumMonthly!);
});
