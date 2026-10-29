'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowUpRight, CreditCard } from 'lucide-react';
import { TIERS, isTierId, tierPriceLabel, type BillingInterval, type TierId } from '@/lib/billing/plans';

type Payload = {
  success: boolean;
  canManage?: boolean;
  access?: { status: string; unlimited?: boolean };
  subscription?: { tier: string | null; interval: BillingInterval; seatsPaid: number | null };
  seats?: { seats: number; billable: number };
};

const STATUS_LABEL: Record<string, string> = {
  comped: 'Complimentary',
  grandfathered: 'Full access (existing clinic)',
  trialing: 'Free trial',
  active: 'Active',
  past_due: 'Payment past due',
  unpaid: 'Read-only (unpaid)',
  incomplete: 'Payment incomplete',
  canceled: 'Ended (read-only)',
};

/** Compact plan + seats strip for billing / payments surfaces. */
export function PracticePlanBanner({ className = '' }: { className?: string }) {
  const [data, setData] = useState<Payload | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/subscription')
      .then(async (res) => {
        const json = (await res.json()) as Payload;
        if (!cancelled && res.ok && json.success) setData(json);
      })
      .catch(() => {
        /* leave the strip empty when status cannot be read */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!data?.canManage) return null;
  const tier: TierId | null = isTierId(data.subscription?.tier) ? (data.subscription!.tier as TierId) : null;
  const status = data.access?.status || 'grandfathered';
  const interval = data.subscription?.interval || 'month';

  return (
    <div className={`rounded-2xl border border-[#5C2D91]/25 bg-gradient-to-r from-[#F5F3FF] to-white p-4 sm:p-5 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-[#5C2D91]">
            <CreditCard size={12} /> Practice plan
          </p>
          <p className="mt-1 text-lg font-black text-[#141C34]">
            {tier ? TIERS[tier].name : 'No paid plan'}{' '}
            <span className="text-sm font-semibold text-slate-500">· {STATUS_LABEL[status] || status}</span>
          </p>
          <p className="mt-1 text-sm text-slate-600">
            {tier ? `${tierPriceLabel(tier, interval)} · ` : ''}
            Paid seats in use {data.seats?.seats ?? '—'}
            {data.subscription?.seatsPaid != null ? ` · paid ${data.subscription.seatsPaid}` : ''}
          </p>
        </div>
        <Link
          href="/dashboard/subscription"
          className="inline-flex items-center gap-1.5 rounded-xl bg-[#5C2D91] px-3.5 py-2 text-sm font-bold text-white shadow-sm hover:opacity-95"
        >
          Plan & Subscription
          <ArrowUpRight size={14} />
        </Link>
      </div>
    </div>
  );
}
