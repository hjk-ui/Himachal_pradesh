/**
 * Print worked quotes, COGS and gross margin for pricing model v2 (read-only; no database, no Stripe).
 *
 *   npx tsx scripts/pricing-quotes.ts
 *
 * The numbers in docs/pricing-model.md come from this script. Staff mixes are ASSUMPTIONS unless
 * replaced by real counts from scripts/billing-seat-report.ts.
 */
import {
  ADD_ONS,
  AI_SCRIBE_INCLUDED_MINUTES,
  BILLABLE_SEAT_TYPES,
  SELF_SERVE_TIERS,
  TIERS,
  formatUsd,
  quote,
  type QuoteInput,
} from '../src/lib/billing/plans';
import { SCRIBE_MINUTES_PER_USER, costForQuote, scribeCostPerUser, scribeMarginPercent, seatCost, seatPassThroughCost, type ScribeEngine } from '../src/lib/billing/costModel';

type Scenario = { name: string; input: QuoteInput; supportUsers: number };

const scenarios: Scenario[] = [
  {
    name: 'MD Behavioral Health (assumed mix: 14 therapists, 7 prescribers, 7 program staff, 5 support; 3 sites; 10 scribe users)',
    input: {
      tier: 'clinic',
      interval: 'month',
      seats: { clinician: 14, prescriber: 7, paraprofessional: 7 },
      locations: 3,
      aiScribeUsers: 10,
      expectedClaimsPerMonth: 2100,
      includeOnboarding: true,
      includeDataMigration: true,
    },
    supportUsers: 5,
  },
  {
    name: 'Small practice (3 therapists, 1 NP, 1 front desk; 1 site; 2 scribe users)',
    input: {
      tier: 'starter',
      interval: 'month',
      seats: { clinician: 3, prescriber: 1 },
      locations: 1,
      aiScribeUsers: 2,
      expectedClaimsPerMonth: 500,
      includeOnboarding: true,
      includeDataMigration: true,
    },
    supportUsers: 1,
  },
  {
    name: 'Mid-size (12 therapists, 3 prescribers, 4 support; 2 sites; 6 scribe users)',
    input: {
      tier: 'professional',
      interval: 'month',
      seats: { clinician: 12, prescriber: 3 },
      locations: 2,
      aiScribeUsers: 6,
      expectedClaimsPerMonth: 1850,
      includeOnboarding: true,
      includeDataMigration: true,
    },
    supportUsers: 4,
  },
];

console.log('Per-seat COGS (estimate):');
for (const t of [...BILLABLE_SEAT_TYPES, 'support' as const]) {
  console.log(`  ${t.padEnd(17)} ${formatUsd(seatCost(t)).padStart(8)}  (pass-through ${formatUsd(seatPassThroughCost(t))})`);
}
console.log('AI Scribe COGS per user:');
for (const e of ['transcribe_standard', 'transcribe_medical', 'healthscribe'] as ScribeEngine[]) {
  console.log(`  ${e.padEnd(20)} ${formatUsd(scribeCostPerUser(e))}`);
}
console.log('AI Scribe margin per user (incl. 2.9% processing):');
for (const e of ['transcribe_standard', 'transcribe_medical'] as ScribeEngine[]) {
  for (const minutes of [SCRIBE_MINUTES_PER_USER, AI_SCRIBE_INCLUDED_MINUTES]) {
    console.log(
      `  ${e.padEnd(20)} ${String(minutes).padStart(5)} min: COGS ${formatUsd(scribeCostPerUser(e, minutes))} · monthly ${formatUsd(ADD_ONS.ai_scribe.monthlyPerUnit!)} → ${scribeMarginPercent(ADD_ONS.ai_scribe.monthlyPerUnit!, e, minutes)}% · annual ${formatUsd(ADD_ONS.ai_scribe.annualPerUnitPerMonth!)} → ${scribeMarginPercent(ADD_ONS.ai_scribe.annualPerUnitPerMonth!, e, minutes)}%`
    );
  }
}

console.log('\nPer-seat margin by tier (monthly list price, incl. 2.9% processing):');
for (const tier of SELF_SERVE_TIERS) {
  const row = BILLABLE_SEAT_TYPES.map((seat) => {
    const p = TIERS[tier].seatPrices![seat].month;
    const cost = seatCost(seat) + p * 0.029;
    return `${seat} ${formatUsd(p)} → ${Math.round(((p - cost) / p) * 100)}%`;
  });
  console.log(`  ${TIERS[tier].name.padEnd(13)} ${row.join(' | ')}`);
}

for (const s of scenarios) {
  for (const interval of ['month', 'year'] as const) {
    const q = quote({ ...s.input, interval })!;
    const c = costForQuote(q, { supportUsers: s.supportUsers });
    const cMed = costForQuote(q, { supportUsers: s.supportUsers, scribeEngine: 'transcribe_medical' });
    const qPlatform = quote({ ...s.input, interval, aiScribeUsers: 0 })!;
    const cPlatform = costForQuote(qPlatform, { supportUsers: s.supportUsers });
    console.log(`\n== ${s.name} — ${TIERS[q.tier].name}, ${interval === 'year' ? 'annual' : 'monthly'} ==`);
    for (const l of q.lines) console.log(`  ${l.label.padEnd(44)} ${formatUsd(l.amount).padStart(10)}`);
    console.log(`  Subscription / month                         ${formatUsd(q.subscriptionPerMonth).padStart(10)}`);
    console.log(`  Claims allowance ${q.claimsAllowance}; overage / month ${formatUsd(q.claimsOverage)}`);
    console.log(`  Estimated monthly ${formatUsd(q.estimatedMonthlyTotal)} · annual ${formatUsd(q.estimatedAnnualTotal)} · one-time ${formatUsd(q.oneTime)} (${q.oneTimeLines.map((l) => `${l.label} ${formatUsd(l.amount)}`).join('; ')})`);
    console.log(`  Platform only: revenue ${formatUsd(cPlatform.revenue)} · COGS ${formatUsd(cPlatform.total)} → gross margin ${cPlatform.grossMargin}% · software-only ${cPlatform.softwareMargin}%`);
    console.log(`  With AI Scribe on standard Transcribe (default): COGS ${formatUsd(c.total)} (scribe ${formatUsd(c.scribe)}) → gross margin ${c.grossMargin}%`);
    console.log(`  With AI Scribe on Transcribe Medical (practice option): COGS ${formatUsd(cMed.total)} → gross margin ${cMed.grossMargin}%`);
    if (q.warnings.length) console.log(`  Warnings: ${q.warnings.join(' ')}`);
  }
}
