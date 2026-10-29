'use client';

/**
 * "Consents needed before the visit" for check-in lists: one request for the clients on screen
 * (GET /api/consents/due), then a small badge per client linking to their consents. Shows nothing
 * when the role cannot see consents or nothing is due.
 */
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { FileWarning } from 'lucide-react';

export type ConsentsDue = Record<string, { needed: number; expiring: number; titles: string[] }>;

export function useConsentsDue(clientIds: (string | null | undefined)[], enabled = true): ConsentsDue {
  const key = useMemo(() => [...new Set(clientIds.filter((x): x is string => Boolean(x)))].sort().slice(0, 100).join(','), [clientIds]);
  const [due, setDue] = useState<ConsentsDue>({});
  useEffect(() => {
    if (!enabled || !key) return;
    let cancelled = false;
    fetch(`/api/consents/due?clientIds=${encodeURIComponent(key)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d?.success) setDue(d.due ?? {});
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [key, enabled]);
  return due;
}

export function ConsentsDueBadge({ clientId, due }: { clientId: string | null | undefined; due: ConsentsDue }) {
  const d = clientId ? due[clientId] : undefined;
  if (!clientId || !d || (!d.needed && !d.expiring)) return null;
  const label = d.needed ? `${d.needed} consent${d.needed === 1 ? '' : 's'} needed` : `${d.expiring} consent${d.expiring === 1 ? '' : 's'} expiring`;
  return (
    <Link
      href={`/dashboard/ehr/consents/client/${encodeURIComponent(clientId)}`}
      title={d.titles.length ? `Before the visit: ${d.titles.join('; ')}` : 'Expiring within 30 days'}
      className={`mt-0.5 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold ring-1 ${d.needed ? 'bg-rose-50 text-rose-700 ring-rose-200' : 'bg-amber-50 text-amber-800 ring-amber-200'}`}
    >
      <FileWarning size={11} aria-hidden /> {label}
    </Link>
  );
}
