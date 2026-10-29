'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { LayoutDashboard } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import type { OpsCountCard } from '@/lib/office/ops-counts';

export function OfficeOpsPanel() {
  const [cards, setCards] = useState<OpsCountCard[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiJson<{ success: boolean; cards?: OpsCountCard[]; error?: string }>(
      '/api/office/ops-counts'
    )
      .then((res) => {
        if (cancelled) return;
        if (!res.success) {
          setError(res.error || 'Unable to load operations counts');
          return;
        }
        setCards(res.cards || []);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Unable to load operations');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section
      className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
      data-testid="office-ops-panel"
    >
      <div className="flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50">
          <LayoutDashboard size={18} className="text-indigo-700" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Operations panel</h2>
          <p className="text-xs text-slate-500">Counts only — open the linked board for detail</p>
        </div>
      </div>

      {error ? <p className="mt-3 text-sm text-amber-800">{error}</p> : null}

      <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {cards.map((card) => (
          <Link
            key={card.id}
            href={card.href}
            className="rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2 hover:bg-slate-50"
          >
            <p className="text-lg font-bold tabular-nums text-slate-900">{card.count}</p>
            <p className="text-xs font-medium text-slate-600">{card.label}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
