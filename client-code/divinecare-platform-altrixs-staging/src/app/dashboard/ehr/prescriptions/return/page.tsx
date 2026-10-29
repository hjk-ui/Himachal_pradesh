'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

/**
 * Rcopia logout_url target (DrFirst "on demand" update, certification call 2026-10-26): when the
 * prescriber clicks Log off in Rcopia, Rcopia sends the browser here. We immediately pull that
 * patient's updates (POST /api/drfirst/sync/return: same access checks, 5-minute per-patient rule,
 * audited) and open the patient's chart, so the chart already shows what was done in Rcopia.
 */
export default function RcopiaReturnPage() {
  const router = useRouter();
  const [message, setMessage] = useState('Updating the chart from DrFirst…');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/drfirst/sync/return', { method: 'POST' });
        const data = (await res.json().catch(() => ({}))) as { clientId?: string; throttled?: boolean; retryAfterSeconds?: number };
        if (cancelled) return;
        if (data.throttled && data.retryAfterSeconds) {
          setMessage(`DrFirst allows one update per patient every 5 minutes; the chart will catch up in about ${Math.ceil(data.retryAfterSeconds / 60)} min.`);
        }
        window.dispatchEvent(new Event('altrixs:drfirst-synced'));
        router.replace(data.clientId ? `/dashboard/clients/${encodeURIComponent(data.clientId)}?tab=medications` : '/dashboard/ehr/prescriptions');
      } catch {
        if (!cancelled) router.replace('/dashboard/ehr/prescriptions');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div className="flex min-h-[40vh] items-center justify-center p-6">
      <p className="inline-flex items-center gap-2 text-sm font-medium text-slate-700" role="status" aria-live="polite">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        {message}
      </p>
    </div>
  );
}
