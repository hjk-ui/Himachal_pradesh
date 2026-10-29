'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ClipboardList } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import type { MaWorklistItem } from '@/lib/medical/ma-worklist';

export function MaWorklist() {
  const [items, setItems] = useState<MaWorklistItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiJson<{ success: boolean; items?: MaWorklistItem[]; error?: string }>(
      '/api/medical/ma-worklist'
    )
      .then((res) => {
        if (cancelled) return;
        if (!res.success) {
          setError(res.error || 'Unable to load worklist');
          return;
        }
        setItems(res.items || []);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Unable to load worklist');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" data-testid="ma-worklist">
      <div className="flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-50">
          <ClipboardList size={18} className="text-teal-700" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-slate-900">MA worklist</h2>
          <p className="text-xs text-slate-500">Rooming · ready for provider · with provider</p>
        </div>
      </div>

      {error ? <p className="mt-3 text-sm text-amber-800">{error}</p> : null}

      {items.length === 0 && !error ? (
        <p className="mt-3 text-sm text-slate-500">No rooming encounters on the board.</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100">
          {items.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-900">{item.clientName}</p>
                <p className="text-xs text-slate-500">{item.label}</p>
              </div>
              <Link
                href={item.href}
                className="shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold text-teal-800 ring-1 ring-teal-200 hover:bg-teal-50"
              >
                Open
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
