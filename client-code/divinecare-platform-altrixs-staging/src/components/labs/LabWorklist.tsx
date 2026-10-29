'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, FlaskConical, Loader2, Plus, RefreshCw, Search } from 'lucide-react';
import { useAuth } from '@/features/auth';
import { LAB_STAGE_LABEL, labOrderStage, type LabStage } from '@/lib/labs/workflow';
import { LabOrderCard } from './LabOrderCard';
import { LabOrderForm, type LabOrderPrefill } from './LabOrderForm';
import { StandingOrdersList } from './StandingOrdersList';
import { useLabCatalog, useLabOrders, type StandingOrderDto } from './labClient';

type Filter = 'all' | 'needs_review' | 'critical' | LabStage | 'standing_due';

const TILES: { id: Filter; label: string }[] = [
  { id: 'ordered', label: LAB_STAGE_LABEL.ordered },
  { id: 'collected', label: LAB_STAGE_LABEL.collected },
  { id: 'sent', label: LAB_STAGE_LABEL.sent },
  { id: 'needs_review', label: 'Unreviewed results' },
  { id: 'critical', label: 'Critical — unreviewed' },
  { id: 'reviewed', label: 'Reviewed, not released' },
  { id: 'released', label: LAB_STAGE_LABEL.released },
  { id: 'standing_due', label: 'Standing orders due' },
];

/**
 * Practice-wide lab worklist (BH Labs page and, with program="medical", the primary care Labs
 * page): orders by stage, unreviewed and critical results, overdue standing orders. Row scope
 * (org, caseload / care team, Part 2) is applied by GET /api/labs/orders.
 */
export function LabWorklist({ program, clientId, onClearClient }: { program?: 'medical'; clientId?: string; onClearClient?: () => void }) {
  const { user } = useAuth();
  const { catalog } = useLabCatalog();
  // ?clientId= (Visit Guide "Order labs"): the API narrows rows to that patient within the user's scope
  const { orders, standing, permissions, loading, error, reload, upsert } = useLabOrders({ program, clientId });
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [mine, setMine] = useState(false);
  const [form, setForm] = useState<{ clientId?: string; clientName?: string; initialClientId?: string; prefill?: LabOrderPrefill } | null>(null);
  const filteredClientName = clientId ? (orders.find((o) => o.clientId === clientId)?.clientName ?? standing.find((s) => s.clientId === clientId)?.clientName ?? null) : null;

  const withStage = useMemo(() => orders.map((o) => ({ o, stage: labOrderStage(o) })), [orders]);
  const dueStanding = useMemo(() => standing.filter((s) => s.dueState === 'overdue' || s.dueState === 'due_soon'), [standing]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const { o, stage } of withStage) {
      c[stage] = (c[stage] ?? 0) + 1;
      if (stage === 'resulted') c.needs_review = (c.needs_review ?? 0) + 1;
      if (stage === 'resulted' && o.hasCritical) c.critical = (c.critical ?? 0) + 1;
    }
    c.standing_due = dueStanding.length;
    return c;
  }, [withStage, dueStanding]);

  const userId = user?.id;
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return withStage
      .filter(({ o, stage }) => {
        if (filter === 'needs_review' && stage !== 'resulted') return false;
        if (filter === 'critical' && !(stage === 'resulted' && o.hasCritical)) return false;
        if (filter !== 'all' && filter !== 'needs_review' && filter !== 'critical' && filter !== 'standing_due' && stage !== filter) return false;
        if (mine && userId && o.orderedById !== userId) return false;
        if (!needle) return true;
        return [o.clientName, o.orderedByName ?? '', ...o.panels, o.otherPanel ?? '', ...o.icd10Codes].some((s) => s.toLowerCase().includes(needle));
      })
      .map(({ o }) => o)
      .sort((a, b) => Number(b.hasCritical && !b.reviewedAt) - Number(a.hasCritical && !a.reviewedAt) || b.orderedAt.localeCompare(a.orderedAt));
  }, [withStage, filter, q, mine, userId]);

  const placeFromStanding = (s: StandingOrderDto, prefill: LabOrderPrefill) => setForm({ clientId: s.clientId, clientName: s.clientName, prefill });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-3xl text-xs text-slate-500">
          Orders are recorded and signed in Altrixs and printed as requisitions — there is no electronic connection to Quest or Labcorp yet. Results are entered by
          staff from the lab report, reviewed and signed off by the ordering provider, then released to the patient portal.
        </p>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void reload()} className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
            <RefreshCw size={13} /> Refresh
          </button>
          {permissions?.order ? (
            <button type="button" onClick={() => setForm(clientId ? { initialClientId: clientId } : {})} className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white">
              <Plus size={15} /> New lab order
            </button>
          ) : permissions ? (
            <span className="text-xs text-slate-500">Lab orders are placed by prescribers.</span>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
        {TILES.map((t) => {
          const n = counts[t.id] ?? 0;
          const alert = (t.id === 'critical' || t.id === 'standing_due') && n > 0;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setFilter(filter === t.id ? 'all' : t.id)}
              className={`rounded-xl border px-3 py-2 text-left transition ${filter === t.id ? 'border-blue-600 bg-blue-50' : alert ? 'border-rose-200 bg-rose-50/50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
            >
              <span className={`block text-xl font-semibold ${alert ? 'text-rose-700' : 'text-slate-900'}`}>{n}</span>
              <span className="text-[11px] font-semibold text-slate-600">{t.label}</span>
            </button>
          );
        })}
      </div>

      {filter === 'standing_due' || dueStanding.length ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-slate-900">
            <CalendarClock size={15} className="text-blue-600" /> Standing orders due or overdue
          </h3>
          <StandingOrdersList standing={filter === 'standing_due' ? standing : dueStanding} canOrder={Boolean(permissions?.order)} showClient onPlace={placeFromStanding} onChanged={() => void reload()} />
        </section>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-72">
          <Search size={14} className="absolute left-3 top-2.5 text-slate-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search patient, test, provider, ICD-10" className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-sm" aria-label="Search lab orders" />
        </div>
        <label className="flex min-h-10 items-center gap-1.5 text-xs font-semibold text-slate-700">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Orders I placed
        </label>
        {filter !== 'all' ? (
          <button type="button" onClick={() => setFilter('all')} className="min-h-10 text-xs font-semibold text-blue-600">
            Clear filter
          </button>
        ) : null}
        {clientId ? (
          <span className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-600">
            Patient: {filteredClientName ?? 'selected patient'}
            {onClearClient ? (
              <button type="button" onClick={onClearClient} className="underline">
                Show all patients
              </button>
            ) : null}
          </span>
        ) : null}
      </div>

      {error ? (
        <p className="flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <AlertTriangle size={15} /> {error}
        </p>
      ) : null}
      {loading ? (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 size={15} className="animate-spin" /> Loading lab orders…
        </p>
      ) : filter === 'standing_due' ? null : visible.length ? (
        <div className="space-y-2">
          {visible.map((o) => (
            <LabOrderCard key={o.id} order={o} permissions={permissions} tests={catalog?.tests ?? []} onChange={upsert} />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white py-12 text-center">
          <FlaskConical size={36} className="mx-auto mb-2 text-slate-500" />
          <p className="text-sm text-slate-600">{orders.length ? 'No orders match this filter.' : 'No lab orders yet.'}</p>
        </div>
      )}

      {form ? (
        <LabOrderForm
          clientId={form.clientId}
          clientName={form.clientName}
          initialClientId={form.initialClientId}
          program={program}
          prefill={form.prefill}
          onClose={() => {
            setForm(null);
            void reload();
          }}
          onPlaced={upsert}
        />
      ) : null}
    </div>
  );
}
