'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowUpRight, CreditCard } from 'lucide-react';
import {
  SUBSCRIPTION_PLANS,
  formatLimit,
  normalizePlanId,
  type BillingCycle,
  type SubscriptionPlanId,
} from '@/lib/subscription/catalog';

type Usage = {
  activeClients: number;
  aiNotesThisMonth: number;
  invoicesThisMonth: number;
};

type Payload = {
  success: boolean;
  state?: { plan: SubscriptionPlanId; billingCycle: BillingCycle };
  usage?: Usage;
};

function priceLabel(plan: SubscriptionPlanId, _cycle: BillingCycle) {
  const p = SUBSCRIPTION_PLANS[plan];
  if (plan === 'free') return '$0';
  return `$${p.monthly}/mo`;
}

/** Compact plan + usage strip for billing / payments surfaces. */
export function PracticePlanBanner({ className = '' }: { className?: string }) {
  const [plan, setPlan] = useState<SubscriptionPlanId>('free');
  const [cycle, setCycle] = useState<BillingCycle>('monthly');
  const [usage, setUsage] = useState<Usage | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/subscription')
      .then(async (res) => {
        const json = (await res.json()) as Payload;
        if (cancelled || !res.ok || !json.success || !json.state) return;
        setPlan(normalizePlanId(json.state.plan));
        setCycle(json.state.billingCycle);
        setUsage(json.usage ?? null);
      })
      .catch(() => {
        /* keep Free defaults */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const limits = SUBSCRIPTION_PLANS[plan];
  const clientLimit = formatLimit(limits.activeClientLimit);
  const aiLimit =
    limits.aiNotesLimit === 0
      ? '—'
      : limits.aiNotesLimit === Infinity
        ? 'Unlimited'
        : `${limits.aiNotesLimit}/mo`;

  return (
    <div
      className={`rounded-2xl border border-[#6868D0]/25 bg-gradient-to-r from-[#EEF0FE] to-white p-4 sm:p-5 ${className}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-[#6868D0]">
            <CreditCard size={12} /> Practice plan
          </p>
          <p className="mt-1 text-lg font-black text-[#141C34]">
            {SUBSCRIPTION_PLANS[plan].name}{' '}
            <span className="text-sm font-semibold text-slate-500">· {priceLabel(plan, cycle)}</span>
          </p>
          <p className="mt-1 text-sm text-slate-600">
            Clients {usage ? `${usage.activeClients} / ${clientLimit}` : `up to ${clientLimit}`}
            {' · '}
            AI notes {usage ? `${usage.aiNotesThisMonth} / ${aiLimit}` : aiLimit}
            {' · '}
            Invoices {usage ? `${usage.invoicesThisMonth}` : '—'} this month
          </p>
        </div>
        <Link
          href="/dashboard/subscription"
          className="inline-flex items-center gap-1.5 rounded-xl bg-[#6868D0] px-3.5 py-2 text-sm font-bold text-white shadow-sm hover:opacity-95"
        >
          View plans / Upgrade
          <ArrowUpRight size={14} />
        </Link>
      </div>
    </div>
  );
}
