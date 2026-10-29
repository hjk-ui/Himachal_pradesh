'use client';

import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Loader2, Search } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { Alert, Button, EmptyState, FOCUS_RING, LoadingState, cardClasses, cx, inputClasses } from '@/components/ui';
import type { BillingArchiveRow } from '@/lib/billing/valantBillingArchive';

/**
 * Valant billing archive: practice billing records from the Valant documents import (ERA exceptions,
 * claims, remittance, EOB). Read-only; billing roles and leadership, Office Manager reads. Lists and
 * file opens are audited on the server.
 */

type Data = { count: number; total: number; page: number; pageSize: number; rows: BillingArchiveRow[] };

function fmtSize(bytes: number | null) {
  if (!bytes) return '—';
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function ValantBillingArchive() {
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(0);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const sp = new URLSearchParams();
    if (q.trim()) sp.set('q', q.trim());
    if (from) sp.set('from', from);
    if (to) sp.set('to', to);
    sp.set('page', String(page));
    try {
      setData(await apiJson<Data>(`/api/billing/valant-archive?${sp.toString()}`));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load the billing archive');
    } finally {
      setLoading(false);
    }
  }, [q, from, to, page]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 300);
    return () => clearTimeout(t);
  }, [load]);

  const reset = (fn: () => void) => {
    fn();
    setPage(0);
  };
  const pages = data ? Math.max(1, Math.ceil(data.count / data.pageSize)) : 1;

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-600">
        Practice billing records from the Valant documents export (ERA exceptions, claims, remittance, EOB). They are not filed to any chart and are
        not in the document review queue. Reference only.
      </p>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="relative w-full sm:w-auto">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
          <input value={q} onChange={(e) => reset(() => setQ(e.target.value))} placeholder="Payer or file name" aria-label="Payer or file name" className={cx(inputClasses, 'w-full py-1 pl-7 sm:w-auto pr-2 text-xs')} />
        </label>
        <label className="inline-flex items-center gap-1 text-slate-600">
          From <input type="date" value={from} onChange={(e) => reset(() => setFrom(e.target.value))} className={cx(inputClasses, 'w-auto px-2 py-1 text-xs')} />
        </label>
        <label className="inline-flex items-center gap-1 text-slate-600">
          To <input type="date" value={to} onChange={(e) => reset(() => setTo(e.target.value))} className={cx(inputClasses, 'w-auto px-2 py-1 text-xs')} />
        </label>
        {loading ? <Loader2 size={14} className="animate-spin text-slate-400" aria-label="Loading" /> : null}
        {data ? (
          <span className="text-slate-500">
            {data.count} of {data.total} records
          </span>
        ) : null}
      </div>
      {err ? <Alert tone="danger">{err}</Alert> : null}
      <div className={cx(cardClasses, 'clinic-scroll-x')}>
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-left text-xs text-slate-600">
            <tr>
              <th scope="col" className="px-3 py-2 font-semibold">Date</th>
              <th scope="col" className="px-3 py-2 font-semibold">Payer (from file name)</th>
              <th scope="col" className="px-3 py-2 font-semibold">File</th>
              <th scope="col" className="px-3 py-2 font-semibold">Valant folder</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Size</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data?.rows.length ? (
              data.rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-slate-700">{r.documentDate ?? '—'}</td>
                  <td className="px-3 py-1.5 text-slate-900">{r.payer ?? '—'}</td>
                  <td className="px-3 py-1.5">
                    {r.url ? (
                      <a href={r.url} target="_blank" rel="noopener noreferrer" className={cx('inline-flex items-center gap-1 rounded font-semibold text-blue-700 hover:underline', FOCUS_RING)}>
                        {r.fileName} <ExternalLink size={11} aria-hidden />
                      </a>
                    ) : (
                      r.fileName
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-slate-600">{r.folder ?? '—'}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{fmtSize(r.size)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5}>
                  {loading ? <LoadingState rows={3} /> : <EmptyState compact title="No billing archive records match." />}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {pages > 1 ? (
        <div className="flex items-center justify-end gap-2 text-xs">
          <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span className="text-slate-600">
            Page {page + 1} of {pages}
          </span>
          <Button size="sm" variant="secondary" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      ) : null}
    </div>
  );
}
