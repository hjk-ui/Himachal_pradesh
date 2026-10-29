'use client';

/**
 * Primary care practice settings (GET / PUT /api/medical/primary-care-settings): results
 * notification window (practice policy, default 7 days), point-of-care standing orders and which
 * care gaps show.
 *
 * Standing orders (owner decision 2026-10-21): a DRAFT list of six tests is offered. A medical
 * assistant can use a test only after the Medical Director approves it here (POST
 * /api/medical/primary-care-settings/standing-orders): approval records the approver, the date and
 * the attestation. Leadership edits content (an edit to an approved order sends it back to draft)
 * and may retire an order; retired orders stay listed as history.
 */
import { useCallback, useEffect, useState } from 'react';
import { BadgeCheck, Plus, Settings2, Trash2 } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { DRAFT_POC_STANDING_ORDERS, type CareGapDef, type PocStandingOrder } from '@/lib/medical/primaryCareWorkflow';
import { buttonClasses } from '@/components/ui';

type SettingsResponse = {
  settings: { resultsNotifyDays: number; pocStandingOrders: PocStandingOrder[]; careGapsDisabled: string[]; saved: boolean };
  careGaps: CareGapDef[];
  canEdit: boolean;
  canApproveStandingOrders?: boolean;
  canRetireStandingOrders?: boolean;
  standingOrderAttestation?: string;
};

const blank = (): PocStandingOrder => ({ key: '', name: '', criteria: '', resultType: 'numeric', unit: '', cpt: '', status: 'draft', approval: null, retired: null });
const DRAFT_KEYS = new Set(DRAFT_POC_STANDING_ORDERS.map((o) => o.key));
const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
};

function StatusBadge({ o }: { o: PocStandingOrder }) {
  const s = o.status ?? 'draft';
  const cls = s === 'approved' ? 'bg-emerald-100 text-emerald-800' : s === 'retired' ? 'bg-slate-200 text-slate-600' : 'bg-amber-100 text-amber-900';
  const label = s === 'approved' ? 'Approved' : s === 'retired' ? 'Retired' : 'Draft — not usable by MAs';
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${cls}`}>{label}</span>;
}

export function PrimaryCareSettingsCard() {
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [days, setDays] = useState(7);
  const [orders, setOrders] = useState<PocStandingOrder[]>([]);
  const [disabled, setDisabled] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [approving, setApproving] = useState<string | null>(null);
  const [approveCriteria, setApproveCriteria] = useState('');
  const [attested, setAttested] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await apiJson<SettingsResponse>('/api/medical/primary-care-settings', { cache: 'no-store' });
      setData(d);
      setDays(d.settings.resultsNotifyDays);
      setOrders(d.settings.pocStandingOrders);
      setDisabled(d.settings.careGapsDisabled);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load settings');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setBusy(true);
    setMsg('');
    setError('');
    try {
      await apiJson('/api/medical/primary-care-settings', { method: 'PUT', body: JSON.stringify({ resultsNotifyDays: days, pocStandingOrders: orders, careGapsDisabled: disabled }) });
      setMsg('Saved.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  const act = async (key: string, action: 'approve' | 'retire') => {
    setBusy(true);
    setMsg('');
    setError('');
    try {
      const body = action === 'approve' ? { key, action, attestation: attested ? data?.standingOrderAttestation : '', criteria: approveCriteria } : { key, action };
      await apiJson('/api/medical/primary-care-settings/standing-orders', { method: 'POST', body: JSON.stringify(body) });
      setMsg(action === 'approve' ? 'Standing order approved.' : 'Standing order retired.');
      setApproving(null);
      setAttested(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  if (!data) return error ? <p className="text-sm text-rose-700">{error}</p> : null;
  const ro = !data.canEdit;
  const input = 'rounded-lg border border-slate-200 px-2 py-1 text-xs disabled:bg-slate-100';
  const attestation = data.standingOrderAttestation ?? '';
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
      <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
        <Settings2 size={18} className="text-blue-600" /> Primary care settings
      </h2>
      {!data.settings.saved ? <p className="mt-1 text-[11px] text-amber-800">Not reviewed yet: defaults shown.</p> : null}
      <label className="mt-3 block text-xs font-semibold text-slate-700">
        Notify patients of results within (days), practice policy
        <input type="number" min={1} max={30} disabled={ro} value={days} onChange={(e) => setDays(Number(e.target.value))} className={`${input} ml-2 w-16`} />
      </label>

      <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Point-of-care standing orders</h3>
      <p className="text-[11px] text-slate-500">
        Draft list for the Medical Director. A medical assistant can perform a test only after it is approved here; drafts and retired orders are never
        offered at rooming. Editing an approved order sends it back to draft.
      </p>
      <ul className="mt-2 space-y-2">
        {orders.map((o, i) => {
          const status = o.status ?? 'draft';
          const locked = ro || status === 'retired';
          return (
            <li key={o.key || `new-${i}`} className="rounded-lg border border-slate-100 p-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusBadge o={o} />
                {(['key', 'name', 'criteria', 'unit', 'cpt'] as const).map((k) => (
                  <input
                    key={k}
                    aria-label={`Standing order ${k}`}
                    placeholder={k === 'key' ? 'key (e.g. glucose-poc)' : k === 'criteria' ? 'Who / when (written by the Medical Director)' : k}
                    disabled={locked || (k === 'key' && (DRAFT_KEYS.has(o.key) || status !== 'draft'))}
                    value={(o[k] as string | null) ?? ''}
                    onChange={(e) => setOrders((list) => list.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))}
                    className={`${input} ${k === 'criteria' ? 'w-56' : k === 'name' ? 'w-44' : 'w-24'}`}
                  />
                ))}
                <select
                  aria-label="Result type"
                  disabled={locked}
                  value={o.resultType}
                  onChange={(e) => setOrders((list) => list.map((x, j) => (j === i ? { ...x, resultType: e.target.value as PocStandingOrder['resultType'] } : x)))}
                  className={input}
                >
                  <option value="numeric">Number</option>
                  <option value="pos_neg">Positive / negative</option>
                  <option value="text">Text</option>
                </select>
                {!ro && status === 'draft' && !DRAFT_KEYS.has(o.key) ? (
                  <button type="button" aria-label="Remove standing order" onClick={() => setOrders((list) => list.filter((_, j) => j !== i))} className="p-1 text-slate-500 hover:text-rose-600">
                    <Trash2 size={13} />
                  </button>
                ) : null}
              </div>
              {o.approval ? (
                <p className="mt-1 text-[11px] text-emerald-800">
                  Approved by {o.approval.approverName} on {fmtDate(o.approval.approvedAt)}: &ldquo;{o.approval.attestation}&rdquo;
                </p>
              ) : null}
              {o.retired ? (
                <p className="mt-1 text-[11px] text-slate-500">
                  Retired by {o.retired.byName} on {fmtDate(o.retired.at)}
                </p>
              ) : null}
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {data.canApproveStandingOrders && status === 'draft' && o.key ? (
                  approving === o.key ? (
                    <div className="w-full space-y-1 rounded-lg bg-slate-50 p-2">
                      <input
                        aria-label="Who / when the standing order covers"
                        placeholder="Who / when this order covers"
                        value={approveCriteria}
                        onChange={(e) => setApproveCriteria(e.target.value)}
                        className={`${input} w-full bg-white`}
                      />
                      <label className="flex items-start gap-1.5 text-[11px] text-slate-700">
                        <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} />
                        <span>{attestation}</span>
                      </label>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={busy || !attested}
                          onClick={() => void act(o.key, 'approve')}
                          className={buttonClasses({ size: 'sm' })}
                        >
                          <BadgeCheck size={12} /> Approve
                        </button>
                        <button type="button" onClick={() => setApproving(null)} className="rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setApproving(o.key);
                        setApproveCriteria(o.criteria ?? '');
                        setAttested(false);
                      }}
                      className="text-xs font-semibold text-blue-600 hover:underline"
                    >
                      Review and approve
                    </button>
                  )
                ) : null}
                {data.canRetireStandingOrders && status !== 'retired' && o.key && (status === 'approved' || DRAFT_KEYS.has(o.key)) ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`Retire "${o.name}"? Medical assistants can no longer perform it under this standing order.`)) void act(o.key, 'retire');
                    }}
                    className="text-xs font-semibold text-slate-600 hover:underline"
                  >
                    Retire
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {!ro ? (
        <button type="button" onClick={() => setOrders((list) => [...list, blank()])} className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-blue-600">
          <Plus size={12} /> Add standing order (draft)
        </button>
      ) : null}

      <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Care gaps shown (screening guidance)</h3>
      <ul className="mt-1 grid gap-1 sm:grid-cols-2">
        {data.careGaps.map((g) => (
          <li key={g.key}>
            <label className="flex items-start gap-1.5 text-xs text-slate-700">
              <input
                type="checkbox"
                disabled={ro}
                checked={!disabled.includes(g.key)}
                onChange={(e) => setDisabled((d) => (e.target.checked ? d.filter((x) => x !== g.key) : [...d, g.key]))}
              />
              <span>
                {g.label} <span className="text-slate-500">({g.window}; {g.basis})</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex items-center gap-3">
        {!ro ? (
          <button type="button" disabled={busy} onClick={() => void save()} className={buttonClasses()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        ) : null}
        {msg ? <span className="text-xs font-semibold text-emerald-700">{msg}</span> : null}
        {error ? <span className="text-xs font-semibold text-rose-700">{error}</span> : null}
      </div>
    </section>
  );
}
