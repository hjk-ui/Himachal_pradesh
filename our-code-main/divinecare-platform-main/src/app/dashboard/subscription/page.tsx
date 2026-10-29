'use client';

import { useEffect, useMemo, useState } from 'react';
import { Building2, Check, ChevronRight } from 'lucide-react';
import {
  ADD_ONS,
  FEATURE_COMPARISON,
  PLAN_ORDER,
  SUBSCRIPTION_PAGE_SEED,
  SUBSCRIPTION_PLANS,
  cliniciansLabel,
  normalizePlanId,
  type BillingCycle,
  type CompetitorRow,
  type FaqItem,
  type SubscriptionPageContent,
  type SubscriptionPlanId,
} from '@/lib/subscription/catalog';
import { useModuleList } from '@/lib/modules/useModuleList';

type Usage = {
  activeClients: number;
  notesThisMonth: number;
  aiNotesThisMonth: number;
  invoicesThisMonth: number;
  insurancePanels: number;
  staffCount: number;
};

type SubscriptionPayload = {
  success: boolean;
  error?: string;
  state: { plan: SubscriptionPlanId | string; billingCycle: BillingCycle };
  usage: Usage;
  stripe?: {
    portalConfigured: boolean;
    priceIdsConfigured: boolean;
    checkoutReady?: boolean;
    hasCustomer?: boolean;
  };
  warning?: string;
  portalUrl?: string | null;
  checkoutUrl?: string | null;
};

const EMPTY_USAGE: Usage = {
  activeClients: 0,
  notesThisMonth: 0,
  aiNotesThisMonth: 0,
  invoicesThisMonth: 0,
  insurancePanels: 0,
  staffCount: 1,
};

function pct(used: number, limit: number) {
  if (!Number.isFinite(limit) || limit <= 0) return used > 0 ? 8 : 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

export default function SubscriptionPage() {
  const [currentPlan, setCurrentPlan] = useState<SubscriptionPlanId>('free');
  const [usage, setUsage] = useState<Usage>(EMPTY_USAGE);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<SubscriptionPlanId | 'portal' | null>(null);
  const [hasCustomer, setHasCustomer] = useState(false);
  const [showFullCompare, setShowFullCompare] = useState(false);

  const [pageRows] = useModuleList<SubscriptionPageContent>('subscription-page', []);
  const content = pageRows[0] ?? SUBSCRIPTION_PAGE_SEED;
  const faqs: FaqItem[] = content.faqs?.length ? content.faqs : SUBSCRIPTION_PAGE_SEED.faqs;
  const competitors: CompetitorRow[] = content.competitors?.length
    ? content.competitors
    : SUBSCRIPTION_PAGE_SEED.competitors;
  const enterprise = content.enterprise ?? SUBSCRIPTION_PAGE_SEED.enterprise;

  const load = async () => {
    try {
      const res = await fetch('/api/subscription');
      const json = (await res.json()) as SubscriptionPayload;
      if (!res.ok || !json.success) {
        setError(json.error || 'Could not load live usage — showing plan catalog.');
        setLoaded(true);
        return;
      }
      setCurrentPlan(normalizePlanId(json.state.plan));
      setUsage({ ...EMPTY_USAGE, ...json.usage });
      setHasCustomer(Boolean(json.stripe?.hasCustomer));
      setError(null);
      setLoaded(true);
    } catch {
      setError('Could not load live usage — showing plan catalog.');
      setLoaded(true);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get('checkout');
    if (checkout === 'success') {
      setNotice('Stripe Checkout completed. Your plan will update as soon as the webhook confirms payment.');
    }
    if (checkout === 'canceled') {
      setNotice('Checkout was canceled. No charge was made.');
    }
  }, []);

  const current = SUBSCRIPTION_PLANS[currentPlan];

  const priceLabel = (id: SubscriptionPlanId) => {
    const plan = SUBSCRIPTION_PLANS[id];
    return {
      main: `$${plan.monthly}`,
      suffix: '/mo',
      extra: plan.extraClinicianPrice
        ? `+$${plan.extraClinicianPrice} per additional clinician`
        : null as string | null,
    };
  };

  const choosePlan = async (plan: SubscriptionPlanId) => {
    if (plan === currentPlan && loaded) return;
    const def = SUBSCRIPTION_PLANS[plan];
    if (def.contactSales) {
      window.location.assign(content.enterprise?.ctaHref || SUBSCRIPTION_PAGE_SEED.enterprise.ctaHref);
      return;
    }
    const label = def.name;
    const confirmed = window.confirm(
      `Upgrade to ${label} ($${def.monthly}/mo)? You will be sent to Stripe Checkout when payment is configured.`
    );
    if (!confirmed) return;
    setBusy(plan);
    setError(null);
    try {
      const res = await fetch('/api/subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, billingCycle: 'monthly' }),
      });
      const json = (await res.json()) as SubscriptionPayload;
      if (!res.ok || !json.success) throw new Error(json.error || 'Could not update plan.');
      if (json.checkoutUrl) {
        window.location.assign(json.checkoutUrl);
        return;
      }
      if (json.portalUrl) {
        window.location.assign(json.portalUrl);
        return;
      }
      setCurrentPlan(normalizePlanId(json.state.plan));
      if (json.warning) setError(json.warning);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not update plan.');
    } finally {
      setBusy(null);
    }
  };

  const openPortal = async () => {
    setBusy('portal');
    setError(null);
    try {
      const res = await fetch('/api/subscription', { method: 'PATCH' });
      const json = (await res.json()) as SubscriptionPayload;
      if (!res.ok || !json.success || !json.portalUrl) {
        throw new Error(json.error || 'Billing portal is not available yet.');
      }
      window.location.assign(json.portalUrl);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not open billing portal.');
      setBusy(null);
    }
  };

  const currentPriceLine = useMemo(() => {
    if (currentPlan === 'free') return '$0 / month · Not on the public price sheet';
    return `$${current.monthly} / month · Billed monthly`;
  }, [current, currentPlan]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-10">
      <div>
        <h1 className="text-3xl font-black tracking-tight text-[#141C34]">Plan & Subscription</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-500">
          {content.subtitle || SUBSCRIPTION_PAGE_SEED.subtitle}
        </p>
      </div>

      {notice ? (
        <div className="rounded-2xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm font-semibold text-teal-800">
          {notice}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          {error}
        </div>
      ) : null}

      {/* Current plan + usage */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
            Current plan
          </p>
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-600">
            {current.name}
          </span>
        </div>
        <h2 className="mt-2 text-2xl font-black text-[#141C34]">{current.name}</h2>
        <p className="mt-1 text-sm text-slate-500">{currentPriceLine}</p>
        {hasCustomer ? (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void openPortal()}
            className="mt-3 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
          >
            {busy === 'portal' ? 'Opening…' : 'Manage billing in Stripe'}
          </button>
        ) : null}

        <div className="mt-6 grid gap-6 sm:grid-cols-3">
          <div>
            <p className="text-xs font-semibold text-slate-500">Active Clients</p>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-violet-600 transition-all"
                style={{ width: `${pct(usage.activeClients, current.activeClientLimit)}%` }}
              />
            </div>
            <p className="mt-1.5 text-sm font-bold text-[#141C34]">
              {usage.activeClients}
              {Number.isFinite(current.activeClientLimit)
                ? `/${current.activeClientLimit}`
                : ' / Unlimited'}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-500">Notes This Month</p>
            <p className="mt-2 text-3xl font-black text-[#141C34]">{usage.notesThisMonth}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-500">Invoices Sent</p>
            <p className="mt-2 text-lg font-black text-[#141C34]">
              {usage.invoicesThisMonth}
              {Number.isFinite(current.invoiceLimit)
                ? ` of ${current.invoiceLimit}`
                : ' · Unlimited'}
            </p>
          </div>
        </div>
      </section>

      {/* Plan cards */}
      <div className="grid gap-4 lg:grid-cols-3">
        {PLAN_ORDER.map((id) => {
          const plan = SUBSCRIPTION_PLANS[id];
          const isCurrent = currentPlan === id;
          const pricing = priceLabel(id);
          return (
            <article
              key={id}
              className={`relative flex flex-col overflow-hidden rounded-2xl border bg-white p-5 shadow-sm ${
                plan.popular ? 'border-teal-500 ring-1 ring-teal-500/30' : 'border-slate-200'
              }`}
            >
              {plan.popular ? (
                <div className="absolute inset-x-0 top-0 bg-teal-600 py-1.5 text-center text-[10px] font-black uppercase tracking-[0.14em] text-white">
                  Most Popular
                </div>
              ) : null}
              <div className={plan.popular ? 'pt-6' : ''}>
                <h3 className="text-lg font-black text-[#141C34]">{plan.name}</h3>
                <p className="mt-0.5 text-xs text-slate-500">{plan.tagline}</p>
                <p className="mt-4 flex items-baseline gap-1">
                  <span className="text-3xl font-black text-[#141C34]">{pricing.main}</span>
                  <span className="text-sm font-semibold text-slate-500">{pricing.suffix}</span>
                </p>
                {pricing.extra ? (
                  <p className="mt-1 text-xs font-semibold text-slate-500">{pricing.extra}</p>
                ) : (
                  <p className="mt-1 text-xs text-transparent select-none">.</p>
                )}

                <div
                  className={`mt-4 rounded-xl px-3 py-2.5 text-xs font-semibold leading-relaxed ${plan.highlightBox}`}
                >
                  {cliniciansLabel(plan)}
                </div>

                <button
                  type="button"
                  disabled={busy !== null || isCurrent}
                  onClick={() => void choosePlan(id)}
                  className={`mt-4 w-full rounded-xl px-4 py-2.5 text-sm font-bold transition disabled:opacity-60 ${
                    isCurrent ? 'bg-slate-200 text-slate-600 cursor-default' : plan.buttonClass
                  }`}
                >
                  {busy === id
                    ? 'Updating…'
                    : isCurrent
                      ? 'Current Plan'
                      : plan.contactSales
                        ? 'Contact us'
                        : `Upgrade to ${plan.name}`}
                </button>

                <ul className="mt-4 space-y-2">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-xs text-slate-700">
                      <Check size={14} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </article>
          );
        })}
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <h2 className="text-lg font-black text-[#141C34]">Add-ons</h2>
        <p className="mt-1 text-sm text-slate-500">
          Available on any plan. Optional extras — only pay for what you need.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {ADD_ONS.map((addon) => (
            <div key={addon.id} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
              <p className="text-sm font-bold text-[#141C34]">{addon.name}</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">{addon.detail}</p>
              <p className="mt-2 text-sm font-black text-teal-700">{addon.price}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Enterprise */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-[#141C34] px-5 py-4 text-white shadow-sm sm:px-6">
        <div className="flex items-start gap-3">
          <Building2 size={20} className="mt-0.5 shrink-0 text-slate-300" aria-hidden />
          <div>
            <p className="font-black">{enterprise.title}</p>
            <p className="mt-0.5 text-sm text-slate-300">{enterprise.description}</p>
          </div>
        </div>
        <a
          href={enterprise.ctaHref}
          className="inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-[#141C34] hover:bg-slate-100"
        >
          {enterprise.ctaLabel}
          <ChevronRight size={16} aria-hidden />
        </a>
      </div>

      {/* How we compare */}
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="px-5 pt-5 sm:px-6">
          <h2 className="text-lg font-black text-[#141C34]">How we compare</h2>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-y border-slate-100 text-left text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">
                <th className="px-5 py-3 sm:px-6">Platform</th>
                <th className="px-3 py-3">Entry</th>
                <th className="px-3 py-3">Mid</th>
                <th className="px-3 py-3">AI Notes</th>
                <th className="px-3 py-3">Outcome Measures</th>
                <th className="px-3 py-3 pr-5 sm:pr-6">Telehealth</th>
              </tr>
            </thead>
            <tbody>
              {competitors.map((row) => (
                <tr
                  key={row.platform}
                  className={
                    row.highlight
                      ? 'bg-violet-50 font-semibold text-violet-900'
                      : 'border-t border-slate-50 text-slate-600'
                  }
                >
                  <td className="px-5 py-3 font-bold sm:px-6">{row.platform}</td>
                  <td className={`px-3 py-3 ${row.highlight ? 'text-violet-700' : ''}`}>{row.entry}</td>
                  <td className={`px-3 py-3 ${row.highlight ? 'text-violet-700' : ''}`}>{row.mid}</td>
                  <td
                    className={`px-3 py-3 ${
                      row.highlight && row.aiNotes === 'Included' ? 'font-bold text-emerald-600' : ''
                    }`}
                  >
                    {row.aiNotes}
                  </td>
                  <td
                    className={`px-3 py-3 ${
                      row.highlight && row.outcomeMeasures === 'Included'
                        ? 'font-bold text-emerald-600'
                        : ''
                    }`}
                  >
                    {row.outcomeMeasures}
                  </td>
                  <td
                    className={`px-3 py-3 pr-5 sm:pr-6 ${
                      row.highlight && row.telehealth === 'Included'
                        ? 'font-bold text-emerald-600'
                        : ''
                    }`}
                  >
                    {row.telehealth}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-400 sm:px-6">
          {content.compareNote || SUBSCRIPTION_PAGE_SEED.compareNote}
        </p>
      </section>

      {/* Full feature comparison */}
      <button
        type="button"
        onClick={() => setShowFullCompare((v) => !v)}
        className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-white px-5 py-4 text-left shadow-sm hover:bg-slate-50 sm:px-6"
      >
        <span className="text-sm font-bold text-[#141C34]">Full feature comparison</span>
        <ChevronRight
          size={18}
          className={`text-slate-400 transition-transform ${showFullCompare ? 'rotate-90' : ''}`}
          aria-hidden
        />
      </button>

      {showFullCompare ? (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
              <tr>
                <th className="px-4 py-3">Feature</th>
                <th className="px-4 py-3 text-center">Solo · $89</th>
                <th className="px-4 py-3 text-center">Practice · $219+</th>
                <th className="px-4 py-3 text-center">Enterprise · $449+</th>
              </tr>
            </thead>
            <tbody>
              {FEATURE_COMPARISON.map((row) => (
                <tr key={row.feature} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-semibold text-slate-700">
                    {row.group ? (
                      <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">
                        {row.group}
                      </span>
                    ) : null}
                    {row.feature}
                  </td>
                  <td className="px-4 py-3 text-center text-slate-600">{row.solo}</td>
                  <td className="px-4 py-3 text-center text-slate-600">{row.practice}</td>
                  <td className="px-4 py-3 text-center text-slate-600">{row.enterprise}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* FAQ */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <h2 className="text-lg font-black text-[#141C34]">Frequently asked questions</h2>
        <div className="mt-4 divide-y divide-slate-100">
          {faqs.map((faq) => (
            <div key={faq.id} className="py-4 first:pt-0 last:pb-0">
              <p className="text-sm font-bold text-[#141C34]">{faq.question}</p>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{faq.answer}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
