'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import type { BillingBanner } from '@/lib/billing/entitlements';

type Payload = {
  success: boolean;
  canManage?: boolean;
  access?: { banner: BillingBanner | null };
};

/**
 * Trial / dunning / read-only notice across the dashboard. Renders nothing for comped,
 * grandfathered or healthy subscriptions (the API returns banner: null for those).
 */
export function BillingStatusBanner() {
  const [banner, setBanner] = useState<BillingBanner | null>(null);
  const [canManage, setCanManage] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/subscription')
      .then(async (res) => {
        if (!res.ok) return;
        const json = (await res.json()) as Payload;
        if (cancelled || !json.success) return;
        setBanner(json.access?.banner ?? null);
        setCanManage(Boolean(json.canManage));
      })
      .catch(() => {
        /* no banner when the status cannot be read; the server still enforces access */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!banner) return null;
  const tone =
    banner.tone === 'danger'
      ? 'border-red-200 bg-red-50 text-red-900'
      : banner.tone === 'warning'
        ? 'border-amber-200 bg-amber-50 text-amber-900'
        : 'border-violet-200 bg-violet-50 text-violet-900';
  const Icon = banner.tone === 'info' ? Info : AlertTriangle;
  return (
    <div role="status" className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2.5 text-sm ${tone}`}>
      <Icon size={16} className="shrink-0" aria-hidden />
      <p className="min-w-0 flex-1">
        <span className="font-bold">{banner.title}.</span> {banner.message}
        {!canManage ? ' Ask your practice director or admin to update the plan.' : ''}
      </p>
      {canManage ? (
        <Link href="/dashboard/subscription" className="shrink-0 font-bold underline underline-offset-2">
          Plan & Subscription
        </Link>
      ) : null}
    </div>
  );
}
