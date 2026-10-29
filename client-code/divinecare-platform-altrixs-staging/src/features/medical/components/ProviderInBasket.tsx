'use client';

/**
 * Physician / medical NP in-basket (GET /api/medical/inbasket): results to review (critical and
 * abnormal first, days waiting), closing the loop (reviewed + patient notified with method / date,
 * practice policy window), lab orders with no result past the expected time, referrals awaiting the
 * consult report, DrFirst requests, prior auths pending and unsigned visit notes.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, FileSignature, FlaskConical, Inbox, Pill, RefreshCw, Send, ShieldCheck } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { primaryCareChartHref } from '@/lib/medical/primaryCareRoster';
import { buttonClasses } from '@/components/ui';

type ResultRow = { orderId: string; clientId: string | null; patient: string; tests: string; resultedOn: string | null; daysWaiting: number; critical: boolean; abnormal: boolean };
type NotifyRow = { orderId: string; clientId: string | null; patient: string; tests: string; resultedOn: string | null; reviewedOn: string | null; deadline: string; state: string; daysWaiting: number; abnormal: boolean };
type OrderRow = { orderId: string; clientId: string | null; patient: string; tests: string; status: string; orderedOn: string | null; daysOverdue: number };
type RefRow = { id: string; clientId: string | null; patient: string; kind: string; target: string; status: string; sentOn: string | null; daysOverdue: number | null };
type InBasket = {
  policy: { resultsNotifyDays: number; labExpectedDays: number; referralReportDays: number };
  results: ResultRow[];
  notify: NotifyRow[];
  overdueOrders: OrderRow[];
  awaitingReports: RefRow[];
  counts: { refills: number | null; rxChanges: number; priorAuthsPending: number; unsignedVisits: number };
};

const LABS = '/dashboard/medical/labs';
const today = () => new Date().toISOString().slice(0, 10);

function NotifyForm({ orderId, onDone }: { orderId: string; onDone: () => void }) {
  const [method, setMethod] = useState('phone');
  const [date, setDate] = useState(today());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <select aria-label="How the patient was told" value={method} onChange={(e) => setMethod(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1 text-xs">
        <option value="phone">Phone</option>
        <option value="portal_message">Portal message</option>
        <option value="letter">Letter</option>
        <option value="in_person">In person</option>
      </select>
      <input type="date" aria-label="Date notified" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1 text-xs" />
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            await apiJson('/api/medical/inbasket/notify', { method: 'POST', body: JSON.stringify({ orderId, method, notifiedOn: date }) });
            onDone();
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save');
          } finally {
            setBusy(false);
          }
        }}
        className={buttonClasses({ size: 'sm' })}
      >
        Patient notified
      </button>
      {error ? <span className="text-[11px] font-semibold text-rose-700">{error}</span> : null}
    </div>
  );
}

const Patient = ({ clientId, name }: { clientId: string | null; name: string }) =>
  clientId ? (
    <Link href={primaryCareChartHref(clientId)} className="font-semibold text-slate-900 hover:text-blue-600">
      {name}
    </Link>
  ) : (
    <span className="font-semibold text-slate-600">{name}</span>
  );

export function ProviderInBasket() {
  const [data, setData] = useState<InBasket | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await apiJson<InBasket>('/api/medical/inbasket', { cache: 'no-store' }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the in-basket');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const h = 'flex items-center gap-2 text-sm font-semibold text-slate-900';
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 p-4 sm:p-5">
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <Inbox size={18} className="text-blue-600" /> In-basket
        </h2>
        <button type="button" onClick={() => void load()} className="inline-flex min-h-10 items-center gap-1 text-xs font-semibold text-slate-600 hover:text-blue-600 md:min-h-8">
          <RefreshCw size={13} /> Refresh
        </button>
      </div>
      {error ? <p className="m-5 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p> : null}
      {loading && !data ? <p className="p-5 text-sm text-slate-500">Loading…</p> : null}
      {data ? (
        <div className="space-y-5 p-5">
          <div className="grid gap-2 sm:grid-cols-4">
            {[
              { label: 'Refill requests', value: data.counts.refills ?? '—', href: '/dashboard/inbox', icon: Pill, detail: data.counts.refills === null ? 'No DrFirst username on your profile' : null },
              { label: 'RxChange requests', value: data.counts.rxChanges, href: '/dashboard/inbox', icon: Pill, detail: null },
              { label: 'Prior auths pending', value: data.counts.priorAuthsPending, href: '/dashboard/billing/authorizations', icon: ShieldCheck, detail: null },
              { label: 'Unsigned visit notes', value: data.counts.unsignedVisits, href: '/dashboard/medical/visits', icon: FileSignature, detail: null },
            ].map((c) => (
              <Link key={c.label} href={c.href} className="rounded-xl border border-slate-200 bg-slate-50 p-3 hover:bg-blue-600/5">
                <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <c.icon size={12} /> {c.label}
                </p>
                <p className="text-xl font-semibold text-slate-900">{c.value}</p>
                {c.detail ? <p className="text-[11px] text-slate-500">{c.detail}</p> : null}
              </Link>
            ))}
          </div>

          <div>
            <h3 className={h}>
              <FlaskConical size={15} className="text-blue-600" /> Results to review ({data.results.length})
            </h3>
            {data.results.length === 0 ? <p className="mt-1 text-xs text-slate-500">No results waiting for your review.</p> : null}
            <ul className="mt-2 divide-y divide-slate-100">
              {data.results.map((r) => (
                <li key={r.orderId} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <div>
                    <Patient clientId={r.clientId} name={r.patient} />
                    <p className="text-xs text-slate-500">
                      {r.tests} · resulted {r.resultedOn ?? 'date not recorded'} · {r.daysWaiting} day{r.daysWaiting === 1 ? '' : 's'} waiting
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {r.critical ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-800">
                        <AlertCircle size={11} /> Critical
                      </span>
                    ) : r.abnormal ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">Abnormal</span>
                    ) : null}
                    <Link href={LABS} className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                      Review
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className={h}>
              <Send size={15} className="text-blue-600" /> Close the loop: tell the patient ({data.notify.length})
            </h3>
            <p className="text-[11px] text-slate-500">Practice policy: notify the patient within {data.policy.resultsNotifyDays} days of the result. Portal release from Labs also counts.</p>
            {data.notify.length === 0 ? <p className="mt-1 text-xs text-slate-500">No reviewed results waiting for patient notification.</p> : null}
            <ul className="mt-2 divide-y divide-slate-100">
              {data.notify.map((r) => (
                <li key={r.orderId} className="py-2 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <Patient clientId={r.clientId} name={r.patient} />
                      <p className="text-xs text-slate-500">
                        {r.tests} · reviewed {r.reviewedOn} · notify by {r.deadline}
                      </p>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${r.state === 'overdue' ? 'bg-rose-100 text-rose-800' : 'bg-slate-100 text-slate-700'}`}>
                      {r.state === 'overdue' ? 'Past the policy window' : 'Due'}
                    </span>
                  </div>
                  {r.clientId ? <NotifyForm orderId={r.orderId} onDone={() => void load()} /> : null}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className={h}>Open orders without results (over {data.policy.labExpectedDays} days)</h3>
            {data.overdueOrders.length === 0 ? <p className="mt-1 text-xs text-slate-500">None.</p> : null}
            <ul className="mt-2 divide-y divide-slate-100">
              {data.overdueOrders.map((o) => (
                <li key={o.orderId} className="py-2 text-sm">
                  <Patient clientId={o.clientId} name={o.patient} />
                  <p className="text-xs text-slate-500">
                    {o.tests} · ordered {o.orderedOn} · status {o.status} · {o.daysOverdue} day{o.daysOverdue === 1 ? '' : 's'} past expected
                  </p>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className={h}>Referrals awaiting the report</h3>
            {data.awaitingReports.length === 0 ? <p className="mt-1 text-xs text-slate-500">None.</p> : null}
            <ul className="mt-2 divide-y divide-slate-100">
              {data.awaitingReports.map((r) => (
                <li key={r.id} className="py-2 text-sm">
                  <Patient clientId={r.clientId} name={r.patient} />
                  <p className="text-xs text-slate-500">
                    {r.kind === 'imaging' ? 'Imaging' : 'Referral'}: {r.target} · {r.status.replace('_', ' ')} · sent {r.sentOn}
                    {r.daysOverdue ? ` · no report ${r.daysOverdue} days past ${data.policy.referralReportDays}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </section>
  );
}
