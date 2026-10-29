'use client';

import { useState } from 'react';
import { CalendarClock, Loader2 } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { describeInterval } from '@/lib/labs/standing';
import { fmtDay, type StandingOrderDto } from './labClient';
import type { LabOrderPrefill } from './LabOrderForm';

const DUE_TONE: Record<StandingOrderDto['dueState'], string> = {
  overdue: 'bg-rose-50 text-rose-700',
  due_soon: 'bg-amber-50 text-amber-800',
  scheduled: 'bg-slate-100 text-slate-600',
  ended: 'bg-slate-100 text-slate-500',
};
const DUE_LABEL: Record<StandingOrderDto['dueState'], string> = { overdue: 'Overdue', due_soon: 'Due soon', scheduled: 'Scheduled', ended: 'Ended' };

/** Standing / recurring orders with next-due state; prescribers place the next order or stop one */
export function StandingOrdersList({
  standing,
  canOrder,
  showClient,
  onPlace,
  onChanged,
}: {
  standing: StandingOrderDto[];
  canOrder: boolean;
  showClient: boolean;
  onPlace: (s: StandingOrderDto, prefill: LabOrderPrefill) => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!standing.length) return <p className="text-xs text-slate-500">No standing lab orders.</p>;

  const stop = async (s: StandingOrderDto) => {
    if (!confirm('Stop this standing order? Past orders are kept.')) return;
    setBusy(s.id);
    setErr(null);
    try {
      await apiJson(`/api/labs/standing-orders/${encodeURIComponent(s.id)}`, { method: 'PATCH', body: JSON.stringify({ active: false }) });
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not stop the standing order');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-2">
      {err ? <p className="text-xs text-rose-700">{err}</p> : null}
      {standing.map((s) => (
        <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs">
          <div className="min-w-0">
            <p className="font-semibold text-slate-900">
              <CalendarClock size={12} className="mr-1 inline text-blue-600" />
              {showClient ? `${s.clientName} · ` : ''}
              {s.tests.map((t) => t.name).join(' + ')}
            </p>
            <p className="text-slate-500">
              {describeInterval(s.intervalUnit, s.intervalCount)} · next due {fmtDay(s.nextDueAt)}
              {s.lastOrderedAt ? ` · last ordered ${fmtDay(s.lastOrderedAt)}` : ''}
              {s.endDate ? ` · ends ${fmtDay(s.endDate)}` : ''}
              {s.icd10Codes.length ? ` · ${s.icd10Codes.join(', ')}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${DUE_TONE[s.dueState]}`}>{DUE_LABEL[s.dueState]}</span>
            {canOrder && s.dueState !== 'ended' ? (
              <>
                <button
                  type="button"
                  onClick={() => onPlace(s, { tests: s.tests, standingOrderId: s.id, lab: s.lab })}
                  className="rounded-lg bg-blue-600 px-2.5 py-1 font-semibold text-white"
                >
                  Place next order
                </button>
                <button type="button" disabled={busy === s.id} onClick={() => void stop(s)} className="rounded-lg px-2 py-1 font-semibold text-slate-500 hover:text-rose-700">
                  {busy === s.id ? <Loader2 size={12} className="animate-spin" /> : 'Stop'}
                </button>
              </>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
