import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { ADD_ONS, AI_SCRIBE_INCLUDED_MINUTES, AI_SCRIBE_OVERAGE_PER_MINUTE, CLAIM_OVERAGE_PER_CLAIM, TIERS, quote } from '../src/lib/billing/plans';
import {
  DEFAULT_SCRIBE_ENGINE,
  MARGIN_TARGETS,
  SCRIBE_MINUTES_PER_USER,
  UNIT_COSTS,
  costForQuote,
  scribeCostPerUser,
  scribeMarginPercent,
  seatCost,
} from '../src/lib/billing/costModel';
import { DEFAULT_TRANSCRIPTION_ENGINE } from '../src/lib/scribe/settings';

test('seat costs are ordered and positive; prescribers carry the e-prescribing pass-through', () => {
  assert.ok(seatCost('prescriber') > seatCost('clinician'));
  assert.ok(seatCost('clinician') > seatCost('paraprofessional'));
  assert.ok(seatCost('paraprofessional') > seatCost('support'));
  assert.ok(seatCost('prescriber') - seatCost('clinician') >= UNIT_COSTS.drFirstPerPrescriber);
});

test('every seat price on every self-serve tier is above its estimated cost', () => {
  for (const tier of ['starter', 'professional', 'clinic'] as const) {
    for (const seat of ['prescriber', 'clinician', 'paraprofessional'] as const) {
      const price = TIERS[tier].seatPrices![seat].year; // the cheaper (annual) rate
      assert.ok(price > seatCost(seat) * 1.25, `${tier} ${seat}: $${price} vs cost $${seatCost(seat)}`);
    }
  }
});

test('Professional and Clinic hit the stated margin targets (no AI Scribe)', () => {
  for (const tier of ['professional', 'clinic'] as const) {
    const q = quote({ tier, interval: 'month', seats: { prescriber: 3, clinician: 12, paraprofessional: 4 }, locations: 2 })!;
    const c = costForQuote(q, { supportUsers: 5 });
    assert.ok(c.softwareMargin >= MARGIN_TARGETS.softwarePercent, `${tier} software margin ${c.softwareMargin}%`);
    assert.ok(c.grossMargin >= MARGIN_TARGETS.blendedPercent, `${tier} blended margin ${c.grossMargin}%`);
  }
});

test('AI Scribe (decision 2026-10-20): standard Transcribe is the default engine and clears the 50% scribe margin', () => {
  assert.equal(DEFAULT_SCRIBE_ENGINE, 'transcribe_standard');
  assert.equal(DEFAULT_TRANSCRIPTION_ENGINE, 'standard', 'product default matches the cost model');
  assert.equal(UNIT_COSTS.transcribeStandardMinute, 0.024, 'tier-1 list price');
  assert.equal(ADD_ONS.ai_scribe.monthlyPerUnit, 149);
  assert.equal(ADD_ONS.ai_scribe.annualPerUnitPerMonth, 127);
  assert.equal(AI_SCRIBE_INCLUDED_MINUTES, 2500);
  assert.equal(AI_SCRIBE_OVERAGE_PER_MINUTE, 0.08);
  const price = ADD_ONS.ai_scribe.monthlyPerUnit!;
  const std = scribeCostPerUser('transcribe_standard');
  assert.ok(std > 61 && std < 63, `standard COGS ${std}`);
  // Before card processing, both billing intervals clear the target at typical use
  assert.ok((price - std) / price >= MARGIN_TARGETS.scribePercent / 100);
  assert.ok((ADD_ONS.ai_scribe.annualPerUnitPerMonth! - std) / ADD_ONS.ai_scribe.annualPerUnitPerMonth! >= MARGIN_TARGETS.scribePercent / 100);
  // Monthly clears it after processing too, even at the full 2,500-minute allowance
  assert.ok(scribeMarginPercent(price) >= MARGIN_TARGETS.scribePercent);
  assert.ok(scribeMarginPercent(price, 'transcribe_standard', AI_SCRIBE_INCLUDED_MINUTES) >= MARGIN_TARGETS.scribePercent);
  assert.ok(SCRIBE_MINUTES_PER_USER <= AI_SCRIBE_INCLUDED_MINUTES);
  // Transcribe Medical stays a per-practice option, but at list price it loses money at $149
  assert.ok(scribeCostPerUser('transcribe_medical') > price);
  // Overage sells a minute above the cost of either engine
  assert.ok(AI_SCRIBE_OVERAGE_PER_MINUTE > UNIT_COSTS.transcribeMedicalMinute);
  assert.ok(AI_SCRIBE_OVERAGE_PER_MINUTE > UNIT_COSTS.transcribeStandardMinute * 3);
  // Quotes cost the scribe on the default engine
  const q = quote({ tier: 'clinic', interval: 'month', seats: { clinician: 10 }, aiScribeUsers: 4 })!;
  assert.equal(costForQuote(q).scribe, Math.round(4 * std * 100) / 100);
});

test('vendor estimates: DrFirst and Waystar kept as labelled estimates; CRISP PDMP assumed inside DrFirst', () => {
  assert.equal(UNIT_COSTS.drFirstPerPrescriber, 60);
  assert.equal(UNIT_COSTS.claim, 0.11);
  assert.equal(UNIT_COSTS.pdmpPerPrescriberMonth, 0);
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'billing', 'costModel.ts'), 'utf8');
  assert.match(src, /TODO\(owner contracts\)/);
  assert.match(src, /ASSUMPTION[\s\S]*CRISP PDMP/);
});

test('claim overage price covers the per-claim clearinghouse cost', () => {
  const perClaimCost = UNIT_COSTS.claim + UNIT_COSTS.eligibility * 0.5 + UNIT_COSTS.era * 0.2 + UNIT_COSTS.claimStatus * 0.2;
  assert.ok(CLAIM_OVERAGE_PER_CLAIM > perClaimCost * 1.25);
});
