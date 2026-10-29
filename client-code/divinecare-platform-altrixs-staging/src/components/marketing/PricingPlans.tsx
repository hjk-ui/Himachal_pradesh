'use client';

/**
 * Pricing UI rendered from src/lib/billing/plans.ts (the single source of truth).
 * Used by the homepage pricing section, /pricing, /get-started and /dashboard/subscription.
 */
import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';
import { AlertTriangle, Check, Minus, Plus } from 'lucide-react';
import {
  ADD_ONS,
  ANNUAL_DISCOUNT_PERCENT,
  BILLABLE_SEAT_TYPES,
  SEAT_TYPES,
  FEATURES,
  PRICING_FAQ,
  PRICING_PUBLIC_NOTICE,
  PRICING_STATUS_LABEL,
  SALES_CONTACT_HREF,
  TIERS,
  TIER_ORDER,
  addOnUnitPrice,
  formatUsd,
  pricingApproved,
  publicAddOnOrder,
  tierUnitPrice,
  type BillingInterval,
  type FeatureDefinition,
  type TierId,
} from '@/lib/billing/plans';

export function ProposedPricingNotice({ className = '' }: { className?: string }) {
  if (pricingApproved()) return null;
  return (
    <div
      role="note"
      className={`flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 ${className}`}
    >
      <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
      <p>
        <span className="font-bold">{PRICING_STATUS_LABEL}.</span> {PRICING_PUBLIC_NOTICE}
      </p>
    </div>
  );
}

export function IntervalToggle({
  value,
  onChange,
}: {
  value: BillingInterval;
  onChange: (v: BillingInterval) => void;
}) {
  const btn = (v: BillingInterval, label: string) => (
    <button
      type="button"
      onClick={() => onChange(v)}
      aria-pressed={value === v}
      className={`rounded-lg px-3 py-1.5 text-sm font-bold transition ${
        value === v ? 'bg-[#5C2D91] text-white shadow-sm' : 'text-slate-600 hover:text-[#5C2D91]'
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1">
      {btn('month', 'Monthly')}
      {btn('year', `Annual (save ${ANNUAL_DISCOUNT_PERCENT}%)`)}
    </div>
  );
}

export function TierPrice({ tier, interval }: { tier: TierId; interval: BillingInterval }) {
  const unit = tierUnitPrice(tier, interval);
  const t = TIERS[tier];
  if (unit === null || !t.seatPrices) {
    return (
      <div>
        <p className="text-3xl font-black tracking-tight text-[#141C34]">Custom</p>
        <p className="mt-1 text-xs font-semibold text-slate-500">Volume seat pricing, annual contract</p>
      </div>
    );
  }
  return (
    <div>
      <p className="flex items-baseline gap-1">
        <span className="text-xs font-semibold text-slate-500">from</span>
        <span className="text-3xl font-black tracking-tight text-[#141C34]">{formatUsd(unit)}</span>
        <span className="text-sm font-semibold text-slate-500">/ clinician / month</span>
      </p>
      <ul className="mt-2 space-y-0.5 text-xs text-slate-600">
        {BILLABLE_SEAT_TYPES.map((seat) => (
          <li key={seat} className="flex justify-between gap-2">
            <span>{SEAT_TYPES[seat].name}</span>
            <span className="font-bold text-[#141C34]">{formatUsd(t.seatPrices![seat][interval])}</span>
          </li>
        ))}
        <li className="flex justify-between gap-2">
          <span>Support staff</span>
          <span className="font-bold text-emerald-700">Free</span>
        </li>
      </ul>
      <p className="mt-2 text-xs font-semibold text-slate-500">
        {interval === 'year' ? 'Per month, billed annually' : 'Billed monthly'}
        {t.minimumMonthly ? ` · ${formatUsd(t.minimumMonthly)} monthly minimum` : ''}
        {t.maxProviderSeats ? ` · up to ${t.maxProviderSeats} providers` : ''}
      </p>
    </div>
  );
}

export function TierCards({
  interval,
  currentTier,
  renderAction,
  tiers = TIER_ORDER,
}: {
  interval: BillingInterval;
  currentTier?: TierId | null;
  renderAction?: (tier: TierId) => ReactNode;
  tiers?: TierId[];
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {tiers.map((id) => {
        const t = TIERS[id];
        const isCurrent = currentTier === id;
        return (
          <article
            key={id}
            className={`relative flex flex-col rounded-2xl border bg-white p-5 shadow-sm ${
              isCurrent
                ? 'border-[#5C2D91] ring-2 ring-[#5C2D91]/30'
                : t.popular
                  ? 'border-[#5C2D91]/50'
                  : 'border-slate-200'
            }`}
          >
            {t.popular || isCurrent ? (
              <p className="absolute inset-x-0 -top-3 mx-auto w-fit rounded-full bg-[#5C2D91] px-3 py-0.5 text-[11px] font-black uppercase tracking-[0.14em] text-white">
                {isCurrent ? 'Current plan' : 'Most popular'}
              </p>
            ) : null}
            <h3 className="text-lg font-black text-[#141C34]">{t.name}</h3>
            <p className="mt-0.5 text-xs font-semibold text-[#5C2D91]">{t.audience}</p>
            <div className="mt-4">
              <TierPrice tier={id} interval={interval} />
            </div>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">{t.summary}</p>
            <ul className="mt-4 flex-1 space-y-2 text-sm text-slate-700">
              {t.highlights.map((line) => (
                <li key={line} className="flex items-start gap-2">
                  <Check size={16} className="mt-0.5 shrink-0 text-[#5C2D91]" aria-hidden />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
            <dl className="mt-4 space-y-1 border-t border-slate-100 pt-3 text-xs text-slate-500">
              <div>
                <dt className="inline font-bold text-slate-600">Onboarding: </dt>
                <dd className="inline">
                  {t.onboardingFee === null ? 'Quoted' : t.onboardingFee === 0 ? 'Self-guided, no fee' : `${formatUsd(t.onboardingFee)} one-time`}
                </dd>
              </div>
              <div>
                <dt className="inline font-bold text-slate-600">Support: </dt>
                <dd className="inline">{t.supportLevel}</dd>
              </div>
            </dl>
            <div className="mt-4">
              {renderAction ? (
                renderAction(id)
              ) : t.selfServe ? (
                <Link
                  href={`/get-started?plan=${id}`}
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-[#141C34] px-4 py-3 text-sm font-bold text-white transition hover:bg-[#5C2D91]"
                >
                  Start free trial
                </Link>
              ) : (
                <a
                  href={SALES_CONTACT_HREF}
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-[#141C34] px-4 py-3 text-sm font-bold text-[#141C34] transition hover:bg-slate-50"
                >
                  Contact sales
                </a>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function Cell({ feature, tier }: { feature: FeatureDefinition; tier: TierId }) {
  const a = feature.tiers[tier];
  const note = feature.notes?.[tier];
  if (a === 'included') {
    return (
      <span className="inline-flex flex-col items-center">
        <Check size={18} className="text-emerald-600" aria-label="Included" />
        {note ? <span className="mt-0.5 text-[11px] text-slate-500">{note}</span> : null}
      </span>
    );
  }
  if (a === 'addon') {
    const addOn = feature.addOn ? ADD_ONS[feature.addOn] : null;
    const price = addOn ? addOnUnitPrice(addOn.id, 'month') : null;
    return (
      <span className="inline-flex flex-col items-center text-[#5C2D91]">
        <span className="inline-flex items-center gap-0.5 text-xs font-bold">
          <Plus size={12} aria-hidden /> Add-on
        </span>
        <span className="mt-0.5 text-[11px] text-slate-500">{note || (price !== null ? `${formatUsd(price)}/mo` : '')}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex flex-col items-center text-slate-400">
      <Minus size={16} aria-label="Not included" />
      {note ? <span className="mt-0.5 text-[11px] text-slate-500">{note}</span> : null}
    </span>
  );
}

/** Full feature matrix with a plain-language explanation for each row. */
export function FeatureMatrix({ interval = 'month' }: { interval?: BillingInterval }) {
  const groups = [...new Set(FEATURES.map((f) => f.group))];
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
      <table className="min-w-[760px] w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs font-black uppercase tracking-[0.12em] text-slate-500">
          <tr>
            <th className="px-4 py-3">Feature</th>
            {TIER_ORDER.map((id) => {
              const unit = tierUnitPrice(id, interval);
              return (
                <th key={id} className="px-3 py-3 text-center">
                  {TIERS[id].name}
                  <span className="block text-[11px] font-semibold normal-case tracking-normal text-slate-500">
                    {unit === null ? 'Custom' : `from ${formatUsd(unit)}/clinician/mo`}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="text-slate-700">
          {groups.map((group) => (
            <Fragment key={group}>
              <tr className="border-t border-slate-200 bg-slate-50/60">
                <td colSpan={TIER_ORDER.length + 1} className="px-4 py-2 text-[11px] font-black uppercase tracking-[0.14em] text-[#5C2D91]">
                  {group}
                </td>
              </tr>
              {FEATURES.filter((f) => f.group === group).map((f) => (
                <tr key={f.id} className="border-t border-slate-100 align-top">
                  <td className="px-4 py-3">
                    <p className="font-semibold text-[#141C34]">{f.name}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{f.explain}</p>
                  </td>
                  {TIER_ORDER.map((id) => (
                    <td key={id} className="px-3 py-3 text-center">
                      <Cell feature={f} tier={id} />
                    </td>
                  ))}
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AddOnCards({ interval = 'month' }: { interval?: BillingInterval }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {publicAddOnOrder().map((id) => {
        const a = ADD_ONS[id];
        const unit = addOnUnitPrice(id, interval);
        let price: string;
        if (id === 'onboarding' || id === 'data_migration') {
          price = TIER_ORDER.filter((t) => TIERS[t].selfServe)
            .map((t) => {
              const fee = id === 'onboarding' ? TIERS[t].onboardingFee : TIERS[t].dataMigrationFee;
              const perSite = id === 'onboarding' && TIERS[t].onboardingPerExtraLocation ? ` + ${formatUsd(TIERS[t].onboardingPerExtraLocation)}/extra site` : '';
              return `${TIERS[t].name}: ${fee ? `${formatUsd(fee)}${perSite}` : 'no fee'}`;
            })
            .join(' · ');
        } else if (a.kind === 'service') {
          price = a.unit;
        } else {
          price = unit === null ? 'Quoted' : `${formatUsd(unit)} ${a.unit}`;
        }
        return (
          <div key={id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm font-bold text-[#141C34]">{a.name}</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">{a.description}</p>
            <p className="mt-3 text-sm font-black text-[#5C2D91]">{price}</p>
            {a.includedOn.length ? (
              <p className="mt-1 text-xs text-slate-500">
                Included on {a.includedOn.map((t) => TIERS[t].name).join(' and ')}.
              </p>
            ) : null}
            {a.note ? <p className="mt-1 text-xs text-slate-500">{a.note}</p> : null}
          </div>
        );
      })}
    </div>
  );
}

export function PricingFaqList() {
  return (
    <div className="divide-y divide-slate-100">
      {PRICING_FAQ.map((faq) => (
        <div key={faq.id} className="py-4 first:pt-0 last:pb-0">
          <p className="text-sm font-bold text-[#141C34]">{faq.question}</p>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{faq.answer}</p>
        </div>
      ))}
    </div>
  );
}
