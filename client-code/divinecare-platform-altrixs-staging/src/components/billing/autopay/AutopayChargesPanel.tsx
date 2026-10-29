'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { formatCents } from '@/lib/migration/valantReportCommon';
import { formatPracticeDateTime } from '@/lib/time/practiceTime';

type Charge = {
  id: string;
  clientId: string;
  clientName: string;
  mrn: string | null;
  kindLabel: string;
  status: string;
  statusLabel: string;
  amountCents: number;
  refundedCents: number;
  reasonText: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  card: string | null;
  livemode: boolean;
  attempts: number;
  receiptNumber: string | null;
  createdAt: string;
};
type Resp = { success: boolean; charges: Charge[]; counts: Record<string, number>; schemaReady: boolean; canMutate: boolean };
type View = 'attention' | 'open' | 'all';

const TONE: Record<string, string> = {
  succeeded: 'bg-emerald-100 text-emerald-800',
  processing: 'bg-sky-100 text-sky-800',
  pending: 'bg-sky-100 text-sky-800',
  failed: 'bg-rose-100 text-rose-800',
  needs_action: 'bg-amber-100 text-amber-900',
  held: 'bg-amber-100 text-amber-900',
  skipped: 'bg-slate-100 text-slate-700',
  canceled: 'bg-slate-100 text-slate-700',
  refunded: 'bg-sky-50 text-sky-800',
  partially_refunded: 'bg-sky-50 text-sky-800',
};

/** Billing → AutoPay → Charges: pending / failed / held charges with retry, approve, void and refund. */
export function AutopayChargesPanel({ timeZone, reloadKey }: { timeZone: string; reloadKey: number }) {
  const [view, setView] = useState<View>('attention');
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await apiJson<Resp>(`/api/billing/autopay/charges?view=${view}`));
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Could not load charges' });
    } finally {
      setLoading(false);
    }
  }, [view]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const act = async (c: Charge, action: 'retry' | 'approve' | 'void' | 'refund') => {
    let body: Record<string, unknown> = { action };
    if (action === 'void' && !window.confirm(`Void the ${formatCents(c.amountCents)} ${c.kindLabel.toLowerCase()} charge for ${c.clientName}? Nothing will be charged.`)) return;
    if (action === 'approve' && !window.confirm(`Charge ${formatCents(c.amountCents)} to ${c.clientName}'s card now, above the practice cap?`)) return;
    if (action === 'refund') {
      const left = c.amountCents - c.refundedCents;
      const amount = window.prompt(`Refund amount for ${c.clientName} (up to ${formatCents(left)})`, (left / 100).toFixed(2));
      if (amount === null) return;
      const cents = Math.round(Number(amount.replace(/[$,\s]/g, '')) * 100);
      if (!Number.isFinite(cents) || cents <= 0) return setMsg({ ok: false, text: 'Enter a refund amount.' });
      const reason = window.prompt('Reason for the refund (kept in the audit trail)');
      if (!reason?.trim()) return setMsg({ ok: false, text: 'A reason is required for a refund.' });
      body = { action, amountCents: cents, reason: reason.trim() };
    }
    setBusy(c.id);
    setMsg(null);
    try {
      const r = await apiJson<{ success: boolean; message: string | null; chargeStatus: string }>(`/api/billing/autopay/charges/${encodeURIComponent(c.id)}`, { method: 'POST', body: JSON.stringify(body) });
      setMsg({ ok: true, text: r.message ?? `Done: ${r.chargeStatus.replace('_', ' ')}.` });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Could not complete the action' });
    } finally {
      setBusy(null);
    }
  };

  const canMutate = Boolean(data?.canMutate);
  const attention = (data?.counts.failed ?? 0) + (data?.counts.needs_action ?? 0) + (data?.counts.held ?? 0);

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-xs" aria-labelledby="autopay-charges-title">
      <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="autopay-charges-title" className="text-base font-semibold text-slate-900">Charges</h2>
          <p className="text-xs text-slate-500">Automatic card charges. A charge posts to the ledger only when Stripe confirms it.</p>
        </div>
        <div className="flex items-center gap-2">
          <div role="tablist" aria-label="Charge filter" className="flex gap-1 rounded-xl bg-slate-50 p-1">
            {(['attention', 'open', 'all'] as View[]).map((v) => (
              <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${view === v ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-white'}`}>
                {v === 'attention' ? `Needs attention${attention ? ` ${attention}` : ''}` : v === 'open' ? 'Open' : 'All'}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => void load()} className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50" aria-label="Refresh charges">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>
      {msg ? (
        <div role={msg.ok ? 'status' : 'alert'} className={`mx-4 mt-3 rounded-xl px-3 py-2 text-sm ${msg.ok ? 'border border-emerald-200 bg-emerald-50 text-emerald-800' : 'border border-rose-200 bg-rose-50 text-rose-700'}`}>
          {msg.text}
        </div>
      ) : null}
      {data?.schemaReady === false ? (
        <p className="px-4 py-6 text-sm text-amber-800">The AutoPay charge tables are not on this database yet (migration 20261021_patient_autopay).</p>
      ) : !data && loading ? (
        <p className="flex items-center gap-2 px-4 py-8 text-sm text-slate-500"><Loader2 size={14} className="animate-spin" aria-hidden /> Loading charges…</p>
      ) : (data?.charges.length ?? 0) === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-slate-500">{view === 'attention' ? 'No failed, held or patient-action charges.' : 'No charges.'}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-max text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-600">
              <tr>
                <th scope="col" className="px-4 py-2">Client</th>
                <th scope="col" className="px-4 py-2">Type</th>
                <th scope="col" className="px-4 py-2 text-right">Amount</th>
                <th scope="col" className="px-4 py-2">Status</th>
                <th scope="col" className="px-4 py-2">Detail</th>
                <th scope="col" className="px-4 py-2">Created</th>
                <th scope="col" className="px-4 py-2 text-right"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data!.charges.map((c) => (
                <tr key={c.id} className={busy === c.id ? 'opacity-60' : ''}>
                  <td className="px-4 py-2.5">
                    <Link href={`/dashboard/clients/${c.clientId}`} className="font-semibold text-slate-900 hover:text-blue-700 hover:underline">{c.clientName}</Link>
                    <div className="text-xs text-slate-500">{c.mrn ?? ''}</div>
                  </td>
                  <td className="px-4 py-2.5 text-slate-700">{c.kindLabel}{c.livemode ? '' : <span className="ml-1 rounded bg-amber-100 px-1 text-[11px] font-semibold text-amber-900">TEST</span>}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {formatCents(c.amountCents)}
                    {c.refundedCents ? <div className="text-xs text-sky-800">−{formatCents(c.refundedCents)} refunded</div> : null}
                  </td>
                  <td className="px-4 py-2.5"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TONE[c.status] ?? 'bg-slate-100 text-slate-700'}`}>{c.statusLabel}</span></td>
                  <td className="max-w-[260px] px-4 py-2.5 text-xs text-slate-600">
                    {c.failureMessage ?? c.reasonText ?? (c.receiptNumber ? `Receipt ${c.receiptNumber}` : '')}
                    {c.card ? <div className="text-slate-500">{c.card}{c.attempts > 1 ? ` · ${c.attempts} attempts` : ''}</div> : null}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-500">{formatPracticeDateTime(c.createdAt, timeZone)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right">
                    {canMutate ? (
                      <div className="flex justify-end gap-1">
                        {c.status === 'failed' || c.status === 'skipped' ? <ActionBtn label="Retry" onClick={() => void act(c, 'retry')} /> : null}
                        {c.status === 'held' ? <ActionBtn label="Approve" onClick={() => void act(c, 'approve')} /> : null}
                        {['pending', 'processing', 'failed', 'needs_action', 'held', 'skipped'].includes(c.status) ? <ActionBtn label="Void" onClick={() => void act(c, 'void')} /> : null}
                        {c.status === 'succeeded' || c.status === 'partially_refunded' ? <ActionBtn label="Refund" onClick={() => void act(c, 'refund')} /> : null}
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ActionBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">
      {label}
    </button>
  );
}
