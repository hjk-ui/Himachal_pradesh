'use client';

/**
 * TMS hand-offs (owner's TMS steps 3-4): cases whose insurance was sent to billing. Billing verifies
 * coverage and records the authorization: approved (with the authorized session count), not
 * required, denied, or still pending. Shows client, payer and days waiting only.
 */
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ShieldCheck, Zap } from 'lucide-react';
import { apiJson } from '@/lib/api-client';

type Handoff = { courseId: string; clientId: string; clientName: string; payer: string | null; sentAt: string | null; daysWaiting: number | null; packetMissing: number };
type Form = { authStatus: '' | 'pending' | 'approved' | 'not_required' | 'denied'; authorizedSessions: string; billingNote: string };

const field = 'w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm';

export function TmsBillingHandoffs() {
  const params = useSearchParams();
  const focus = params.get('tms');
  const [rows, setRows] = useState<Handoff[] | null>(null);
  const [forms, setForms] = useState<Record<string, Form>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await apiJson<{ success: true; handoffs: Handoff[] }>('/api/tms/billing-handoffs');
      setRows(r.handoffs);
    } catch {
      setRows([]);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (!rows || (!rows.length && !focus)) return null;

  const form = (id: string): Form => forms[id] ?? { authStatus: '', authorizedSessions: '', billingNote: '' };
  const set = (id: string, patch: Partial<Form>) => setForms((f) => ({ ...f, [id]: { ...form(id), ...patch } }));

  const save = async (h: Handoff) => {
    const f = form(h.courseId);
    if (!f.authStatus) return setMsg('Choose the authorization result.');
    setBusy(h.courseId);
    setMsg(null);
    try {
      await apiJson(`/api/tms/workflow/${encodeURIComponent(h.courseId)}/verification`, {
        method: 'PATCH',
        body: JSON.stringify({
          authStatus: f.authStatus,
          authorizedSessions: f.authStatus === 'approved' ? Number(f.authorizedSessions) || null : null,
          billingNote: f.billingNote || null,
        }),
      });
      setMsg(`Saved for ${h.clientName}.`);
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="mb-4 rounded-xl border border-violet-200 bg-violet-50/40 p-3" aria-label="TMS hand-offs">
      <h2 className="flex items-center gap-1.5 text-sm font-bold text-[#5C2D91]">
        <Zap size={14} aria-hidden /> TMS: insurance sent to billing ({rows.length})
      </h2>
      <p className="mt-0.5 text-xs text-slate-600">
        Verify coverage and identify any authorization needed. Record an approved authorization&apos;s session count here; the TMS course is scheduled for that number.
      </p>
      {msg ? <p className="mt-2 text-xs font-semibold text-slate-700" role="status">{msg}</p> : null}
      {!rows.length ? <p className="mt-2 text-sm text-slate-500">No open TMS hand-offs.</p> : null}
      <ul className="mt-2 space-y-2">
        {rows.map((h) => {
          const f = form(h.courseId);
          return (
            <li key={h.courseId} className={`rounded-lg border bg-white p-2.5 ${focus === h.courseId ? 'border-violet-400 ring-2 ring-violet-200' : 'border-slate-200'}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="min-w-0 break-words text-sm font-semibold text-slate-800">{h.clientName}</p>
                <p className="text-xs text-slate-500">
                  {h.payer || 'Payer not on file'} · {h.daysWaiting != null ? `${h.daysWaiting} day${h.daysWaiting === 1 ? '' : 's'} waiting` : 'just sent'}
                  {h.packetMissing ? ` · packet: ${h.packetMissing} item${h.packetMissing === 1 ? '' : 's'} missing` : ''}
                </p>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_minmax(0,2fr)_auto]">
                <select aria-label="Authorization result" className={field} value={f.authStatus} onChange={(e) => set(h.courseId, { authStatus: e.target.value as Form['authStatus'] })}>
                  <option value="">Result…</option>
                  <option value="approved">Authorization approved</option>
                  <option value="not_required">No authorization required</option>
                  <option value="pending">Authorization requested (pending)</option>
                  <option value="denied">Denied / not covered</option>
                </select>
                <input
                  aria-label="Authorized sessions"
                  type="number"
                  min={1}
                  max={200}
                  placeholder="Sessions"
                  disabled={f.authStatus !== 'approved'}
                  className={`${field} disabled:opacity-50`}
                  value={f.authorizedSessions}
                  onChange={(e) => set(h.courseId, { authorizedSessions: e.target.value })}
                />
                <input aria-label="Billing note" placeholder="Note (reference #, dates, who you spoke with)" maxLength={500} className={field} value={f.billingNote} onChange={(e) => set(h.courseId, { billingNote: e.target.value })} />
                <button
                  type="button"
                  disabled={busy === h.courseId}
                  onClick={() => void save(h)}
                  className="inline-flex min-h-[38px] items-center justify-center gap-1 rounded-lg bg-[#5C2D91] px-3 text-xs font-semibold text-white disabled:opacity-50"
                >
                  <ShieldCheck size={13} aria-hidden /> Save
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
