'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { Alert, Button, EmptyState, FOCUS_RING, LoadingState, cardClasses, cx, inputClasses } from '@/components/ui';
import { formatCents } from '@/lib/migration/valantReportCommon';
import { CATEGORY_LABEL, type TransactionCategory } from '@/lib/migration/valantTransactions';

/**
 * Valant transaction history (reference only). Used on Billing → Valant Balances and in the client
 * chart drawer (fixed clientId). Paged on the server; running balance shown for a single patient.
 */

type Row = {
  id: string; clientId: string | null; clientName: string | null; mrn: string | null; valantPatientId: string; billingId: string | null;
  serviceDate: string | null; providerCode: string | null; pos: string | null; diagnosis: string | null; code: string; category: string;
  amountCents: number; note: string | null; runningBalanceCents: number | null; facility: string | null; insurance: string | null;
};
type Data = {
  count: number; page: number; pageSize: number; singlePatient: boolean; rows: Row[];
  totalsByCategory: { category: string; rows: number; cents: number }[]; providers: string[];
};

export function ValantTransactionsTable({ clientId }: { clientId?: string }) {
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [category, setCategory] = useState('');
  const [provider, setProvider] = useState('');
  const [billingId, setBillingId] = useState('');
  const [page, setPage] = useState(0);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const sp = new URLSearchParams();
    if (clientId) sp.set('clientId', clientId);
    else if (q.trim()) sp.set('q', q.trim());
    if (from) sp.set('from', from);
    if (to) sp.set('to', to);
    if (category) sp.set('category', category);
    if (provider) sp.set('provider', provider);
    if (billingId.trim()) sp.set('billingId', billingId.trim());
    sp.set('page', String(page));
    try {
      setData(await apiJson<Data>(`/api/billing/valant-balances/transactions?${sp.toString()}`));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load transactions');
    } finally {
      setLoading(false);
    }
  }, [clientId, q, from, to, category, provider, billingId, page]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 300);
    return () => clearTimeout(t);
  }, [load]);

  const reset = (fn: () => void) => {
    fn();
    setPage(0);
  };
  const pages = data ? Math.max(1, Math.ceil(data.count / data.pageSize)) : 1;
  const filteredTotal = data?.totalsByCategory.reduce((s, c) => s + c.cents, 0) ?? 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {!clientId ? (
          <label className="relative w-full sm:w-auto">
            <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
            <input value={q} onChange={(e) => reset(() => setQ(e.target.value))} placeholder="Patient, MRN or Valant ID" aria-label="Patient, MRN or Valant ID" className={cx(inputClasses, 'w-full py-1 pl-7 sm:w-auto pr-2 text-xs')} />
          </label>
        ) : null}
        <label className="inline-flex items-center gap-1 text-slate-600">
          From <input type="date" value={from} onChange={(e) => reset(() => setFrom(e.target.value))} className={cx(inputClasses, 'w-auto px-2 py-1 text-xs')} />
        </label>
        <label className="inline-flex items-center gap-1 text-slate-600">
          To <input type="date" value={to} onChange={(e) => reset(() => setTo(e.target.value))} className={cx(inputClasses, 'w-auto px-2 py-1 text-xs')} />
        </label>
        <select value={category} aria-label="Category" onChange={(e) => reset(() => setCategory(e.target.value))} className={cx(inputClasses, 'w-auto px-2 py-1 text-xs')}>
          <option value="">All categories</option>
          {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select value={provider} aria-label="Provider" onChange={(e) => reset(() => setProvider(e.target.value))} className={cx(inputClasses, 'w-auto px-2 py-1 text-xs')}>
          <option value="">All providers</option>
          {(data?.providers ?? []).map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <input value={billingId} onChange={(e) => reset(() => setBillingId(e.target.value))} placeholder="Billing ID" aria-label="Billing ID" className={cx(inputClasses, 'w-24 px-2 py-1 text-xs')} />
      </div>

      {err ? <Alert tone="danger">{err}</Alert> : null}

      {data ? (
        <div className="flex flex-wrap gap-2">
          {data.totalsByCategory.map((c) => (
            <div key={c.category} className={cx(cardClasses, 'px-3 py-1.5 text-xs')}>
              <p className="text-xs text-slate-500">{CATEGORY_LABEL[c.category as TransactionCategory] ?? c.category} · {c.rows.toLocaleString()}</p>
              <p className="font-semibold tabular-nums text-slate-900">{formatCents(c.cents)}</p>
            </div>
          ))}
          <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs">
            <p className="text-xs text-blue-700">Net of rows shown · {data.count.toLocaleString()}</p>
            <p className="font-semibold tabular-nums text-slate-900">{formatCents(filteredTotal)}</p>
          </div>
        </div>
      ) : null}

      <div className={cx(cardClasses, 'clinic-scroll-x')}>
        {loading && !data ? (
          <LoadingState rows={4} label="Loading Valant transactions…" />
        ) : (
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-semibold">Service date</th>
                {!clientId ? <th scope="col" className="px-3 py-2 text-left font-semibold">Patient</th> : null}
                <th scope="col" className="px-3 py-2 text-left font-semibold">Code</th>
                <th scope="col" className="px-3 py-2 text-left font-semibold">Category</th>
                <th scope="col" className="px-3 py-2 text-left font-semibold">Provider</th>
                <th scope="col" className="px-3 py-2 text-left font-semibold">Billing ID</th>
                <th scope="col" className="px-3 py-2 text-left font-semibold">Dx / POS</th>
                <th scope="col" className="px-3 py-2 text-left font-semibold">Facility</th>
                <th scope="col" className="px-3 py-2 text-left font-semibold">Insurance</th>
                <th scope="col" className="px-3 py-2 text-left font-semibold">Note</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Amount</th>
                {data?.singlePatient ? <th scope="col" className="px-3 py-2 text-right font-semibold" title="Sum of the rows shown, in service-date order">Running balance</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(data?.rows ?? []).map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-3 py-1.5 whitespace-nowrap">{r.serviceDate ?? '—'}</td>
                  {!clientId ? (
                    <td className="px-3 py-1.5">
                      {r.clientId ? (
                        <Link href={`/dashboard/clients/${r.clientId}`} className={cx('rounded font-semibold text-slate-900 hover:text-blue-700 hover:underline', FOCUS_RING)}>{r.clientName}</Link>
                      ) : (
                        <span className="text-slate-500">Valant ID {r.valantPatientId}</span>
                      )}
                    </td>
                  ) : null}
                  <td className="px-3 py-1.5 font-mono">{r.code}</td>
                  <td className="px-3 py-1.5">{CATEGORY_LABEL[r.category as TransactionCategory] ?? r.category}</td>
                  <td className="px-3 py-1.5">{r.providerCode ?? '—'}</td>
                  <td className="px-3 py-1.5">{r.billingId ?? '—'}</td>
                  <td className="px-3 py-1.5">{[r.diagnosis, r.pos].filter(Boolean).join(' / ') || '—'}</td>
                  <td className="max-w-[12rem] truncate px-3 py-1.5" title={r.facility ?? ''}>{r.facility ?? '—'}</td>
                  <td className="max-w-[14rem] truncate px-3 py-1.5" title={r.insurance ?? ''}>{r.insurance ?? '—'}</td>
                  <td className="max-w-[16rem] truncate px-3 py-1.5" title={r.note ?? ''}>{r.note ?? ''}</td>
                  <td className={`px-3 py-1.5 text-right tabular-nums ${r.amountCents < 0 ? 'text-rose-700' : ''}`}>{formatCents(r.amountCents)}</td>
                  {data?.singlePatient ? <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{formatCents(r.runningBalanceCents)}</td> : null}
                </tr>
              ))}
              {data && !data.rows.length ? (
                <tr><td colSpan={12}><EmptyState compact title="No Valant transactions match." /></td></tr>
              ) : null}
            </tbody>
          </table>
        )}
      </div>
      {data && data.count > data.pageSize ? (
        <div className="flex items-center justify-end gap-2 text-xs">
          <Button size="sm" variant="secondary" disabled={page === 0 || loading} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <span className="text-slate-600">Page {page + 1} of {pages}</span>
          <Button size="sm" variant="secondary" disabled={page + 1 >= pages || loading} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      ) : null}
    </div>
  );
}
