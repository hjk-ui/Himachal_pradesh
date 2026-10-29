'use client';

import Link from 'next/link';
import { useState } from 'react';
import { CLAIMS_RULE, SEAT_RULE, TRIAL_DAYS, type BillingInterval } from '@/lib/billing/plans';
import {
  AddOnCards,
  FeatureMatrix,
  IntervalToggle,
  PricingFaqList,
  ProposedPricingNotice,
  TierCards,
} from './PricingPlans';
import { QuoteCalculator } from './QuoteCalculator';

/** Public pricing: tiers, add-ons, full matrix and FAQ. Homepage #pricing and /pricing. */
export function PricingSection({ showFaq = true, headingLevel = 'h2' }: { showFaq?: boolean; headingLevel?: 'h1' | 'h2' }) {
  const [interval, setBillingInterval] = useState<BillingInterval>('month');
  const Heading = headingLevel;
  return (
    <div className="mx-auto max-w-6xl">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#5C2D91]">Pricing</p>
        <Heading
          className="mt-3 text-3xl font-bold tracking-tight text-[#141C34] sm:text-4xl"
          style={{ fontFamily: 'var(--font-clinic-display)' }}
        >
          Pay for the people who see clients. Front desk, billing and HR are free.
        </Heading>
        <p className="mt-4 text-base leading-relaxed text-slate-600 sm:text-lg">
          One monthly price per provider, by role. Prescriber seats include e-prescribing with EPCS. Every plan
          includes scheduling, notes, telehealth, the client portal, eligibility checks and electronic claims
          through Waystar. {TRIAL_DAYS}-day free trial, no card required.
        </p>
      </div>

      <ProposedPricingNotice className="mx-auto mt-6 max-w-3xl" />

      <div className="mt-8 flex justify-center">
        <IntervalToggle value={interval} onChange={setBillingInterval} />
      </div>

      <div className="mt-8">
        <TierCards interval={interval} />
      </div>
      <p className="mx-auto mt-4 max-w-3xl text-center text-xs leading-relaxed text-slate-500">{SEAT_RULE}</p>
      <p className="mx-auto mt-2 max-w-3xl text-center text-xs leading-relaxed text-slate-500">{CLAIMS_RULE}</p>

      <div className="mt-10">
        <QuoteCalculator />
      </div>

      <div className="mt-12">
        <h3 className="text-center text-lg font-black text-[#141C34]">Add-ons</h3>
        <p className="mt-1 text-center text-sm text-slate-500">Pay only for what you use: AI Scribe per user, extra sites, and one-time setup.</p>
        <div className="mt-6">
          <AddOnCards interval={interval} />
        </div>
      </div>

      <div className="mt-12">
        <h3 className="text-center text-lg font-black text-[#141C34]">Compare every feature</h3>
        <div className="mt-6">
          <FeatureMatrix interval={interval} />
        </div>
      </div>

      {showFaq ? (
        <div className="mx-auto mt-12 max-w-3xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h3 className="text-lg font-black text-[#141C34]">Pricing questions</h3>
          <div className="mt-4">
            <PricingFaqList />
          </div>
        </div>
      ) : null}

      <p className="mt-6 text-center text-sm text-slate-500">
        Already on Altrixs?{' '}
        <Link href="/login" className="font-semibold text-[#5C2D91] hover:underline">
          Sign in to manage your plan
        </Link>
      </p>
    </div>
  );
}
