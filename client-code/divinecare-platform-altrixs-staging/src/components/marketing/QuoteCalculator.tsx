'use client';

/**
 * Quote calculator: seat counts by type, locations, add-ons and billing interval → price breakdown.
 * Every number comes from quote() in src/lib/billing/plans.ts, the same math Checkout uses.
 * Used on /pricing (public) and /dashboard/subscription (pre-filled with the org's active seats).
 */
import { useMemo, useState } from 'react';
import {
  BILLABLE_SEAT_TYPES,
  PRICING_STATUS_LABEL,
  SALES_CONTACT_HREF,
  SEAT_TYPES,
  SELF_SERVE_TIERS,
  TIERS,
  formatUsd,
  pricingApproved,
  quote,
  smallestFittingTier,
  type BillingInterval,
  type SeatQuantities,
  type SelfServeTierId,
} from '@/lib/billing/plans';
import { IntervalToggle } from './PricingPlans';

export type QuoteCalculatorProps = {
  initialSeats?: Partial<SeatQuantities>;
  initialSupport?: number;
  initialLocations?: number;
  initialTier?: SelfServeTierId;
  initialInterval?: BillingInterval;
  initialAiScribeUsers?: number;
  /** Shown above the total, e.g. "Proposed pricing estimate — not billed". */
  totalLabel?: string;
  heading?: string;
};

function NumberField({
  label,
  hint,
  value,
  onChange,
  max = 1000,
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (n: number) => void;
  max?: number;
}) {
  return (
    <label className="block text-sm">
      <span className="block font-bold text-[#141C34]">{label}</span>
      {hint ? <span className="block text-xs text-slate-500">{hint}</span> : null}
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={max}
        value={value}
        onChange={(e) => onChange(Math.max(0, Math.min(max, Math.floor(Number(e.target.value) || 0))))}
        className="mt-1.5 w-28 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
      />
    </label>
  );
}

export function QuoteCalculator({
  initialSeats,
  initialSupport = 0,
  initialLocations = 1,
  initialTier,
  initialInterval = 'month',
  initialAiScribeUsers = 0,
  totalLabel,
  heading = 'Estimate your price',
}: QuoteCalculatorProps) {
  const [seats, setSeats] = useState<SeatQuantities>({
    prescriber: initialSeats?.prescriber ?? 1,
    clinician: initialSeats?.clinician ?? 3,
    paraprofessional: initialSeats?.paraprofessional ?? 0,
  });
  const [support, setSupport] = useState(initialSupport);
  const [locations, setLocations] = useState(Math.max(1, initialLocations));
  const [aiScribeUsers, setAiScribeUsers] = useState(initialAiScribeUsers);
  const [claims, setClaims] = useState(0);
  const [interval, setBillingInterval] = useState<BillingInterval>(initialInterval);
  const [tierChoice, setTierChoice] = useState<SelfServeTierId | 'auto'>(initialTier ?? 'auto');
  const [onboarding, setOnboarding] = useState(true);
  const [migration, setMigration] = useState(false);

  const fit = smallestFittingTier(seats, locations);
  const tier: SelfServeTierId = tierChoice === 'auto' ? fit : tierChoice;
  const q = useMemo(
    () =>
      quote({
        tier,
        interval,
        seats,
        locations,
        aiScribeUsers,
        expectedClaimsPerMonth: claims,
        includeOnboarding: onboarding,
        includeDataMigration: migration,
      }),
    [tier, interval, seats, locations, aiScribeUsers, claims, onboarding, migration]
  );

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6" aria-label="Quote calculator">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-lg font-black text-[#141C34]">{heading}</h3>
          <p className="mt-1 text-sm text-slate-500">Enter your staff by role. Support staff are always free.</p>
        </div>
        <IntervalToggle value={interval} onChange={setBillingInterval} />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {BILLABLE_SEAT_TYPES.map((type) => (
              <NumberField
                key={type}
                label={SEAT_TYPES[type].plural}
                hint={SEAT_TYPES[type].roles.length ? SEAT_TYPES[type].explain.split('.')[0] : undefined}
                value={seats[type]}
                onChange={(n) => setSeats((s) => ({ ...s, [type]: n }))}
              />
            ))}
            <NumberField label="Support staff (free)" hint="Front desk, billing, HR, managers" value={support} onChange={setSupport} />
            <NumberField label="Locations" value={locations} onChange={(n) => setLocations(Math.max(1, n))} max={200} />
            <NumberField label="AI Scribe users" hint="Clinicians who will use it" value={aiScribeUsers} onChange={setAiScribeUsers} />
            <NumberField label="Claims per month" hint="Optional, for the claims estimate" value={claims} onChange={setClaims} max={100000} />
          </div>
          <label className="block text-sm">
            <span className="block font-bold text-[#141C34]">Plan</span>
            <select
              value={tierChoice}
              onChange={(e) => setTierChoice(e.target.value as SelfServeTierId | 'auto')}
              className="mt-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
            >
              <option value="auto">Best fit ({TIERS[fit].name})</option>
              {SELF_SERVE_TIERS.map((id) => (
                <option key={id} value={id}>
                  {TIERS[id].name}
                </option>
              ))}
            </select>
          </label>
          <div className="space-y-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={onboarding} onChange={(e) => setOnboarding(e.target.checked)} />
              Include onboarding and training
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={migration} onChange={(e) => setMigration(e.target.checked)} />
              Include data migration from one prior system
            </label>
          </div>
        </div>

        <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
          {q ? (
            <>
              <p className="font-bold text-[#141C34]">
                {TIERS[q.tier].name}, {interval === 'year' ? 'paid annually' : 'paid monthly'}
              </p>
              <table className="mt-2 w-full text-xs">
                <tbody>
                  {q.lines.map((l) => (
                    <tr key={l.id} className="border-b border-slate-200/70">
                      <td className="py-1.5 pr-2">
                        {l.label}
                        {l.kind === 'seat' || l.kind === 'addon' ? (
                          <span className="text-slate-500"> at {formatUsd(l.unitPrice)}</span>
                        ) : null}
                      </td>
                      <td className={`py-1.5 text-right font-semibold ${l.amount < 0 ? 'text-emerald-700' : ''}`}>{formatUsd(l.amount)}</td>
                    </tr>
                  ))}
                  {support > 0 ? (
                    <tr className="border-b border-slate-200/70">
                      <td className="py-1.5 pr-2">Support staff × {support}</td>
                      <td className="py-1.5 text-right font-semibold text-emerald-700">Free</td>
                    </tr>
                  ) : null}
                  {q.claimsOverage > 0 ? (
                    <tr className="border-b border-slate-200/70">
                      <td className="py-1.5 pr-2">
                        Claims above allowance ({q.claimsAllowance?.toLocaleString('en-US')} included)
                      </td>
                      <td className="py-1.5 text-right font-semibold">{formatUsd(q.claimsOverage)}</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
              {totalLabel || !pricingApproved() ? (
                <p className="mt-3 text-[11px] font-bold uppercase tracking-[0.12em] text-amber-700">{totalLabel || PRICING_STATUS_LABEL}</p>
              ) : null}
              <p className="mt-1 text-2xl font-black text-[#141C34]">
                {formatUsd(q.estimatedMonthlyTotal)}
                <span className="text-sm font-semibold text-slate-500"> / month</span>
              </p>
              <p className="text-xs text-slate-500">
                {formatUsd(q.estimatedAnnualTotal)} per year
                {interval === 'year' ? ` · subscription invoiced once a year (${formatUsd(q.subscriptionPerInvoice)})` : ''}
              </p>
              {q.claimsAllowance !== null ? (
                <p className="mt-1 text-xs text-slate-500">
                  Includes {q.claimsAllowance.toLocaleString('en-US')} claims per month (eligibility, status and ERA included).
                </p>
              ) : null}
              {q.oneTime > 0 ? (
                <div className="mt-3 border-t border-slate-200 pt-2 text-xs">
                  <p className="font-bold text-[#141C34]">One-time</p>
                  <ul className="mt-1 space-y-0.5">
                    {q.oneTimeLines.map((l) => (
                      <li key={l.id} className="flex justify-between gap-2">
                        <span>{l.label}</span>
                        <span className="font-semibold">{formatUsd(l.amount)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {q.warnings.length ? (
                <ul className="mt-3 space-y-1 text-xs font-semibold text-amber-800">
                  {q.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              ) : null}
              {q.enterpriseRecommended ? (
                <a href={SALES_CONTACT_HREF} className="mt-3 inline-block text-xs font-bold text-[#5C2D91] hover:underline">
                  Contact us for an Enterprise quote
                </a>
              ) : null}
            </>
          ) : (
            <p>Enterprise is quoted per organization.</p>
          )}
        </div>
      </div>
    </section>
  );
}
