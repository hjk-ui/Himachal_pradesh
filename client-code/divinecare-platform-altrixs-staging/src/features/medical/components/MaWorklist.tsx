'use client';

/**
 * Medical Assistant worklist: tasks routed by the providers (GET / PATCH /api/medical/tasks) and the
 * care-gap outreach list for the MA's care team (GET /api/medical/ma-worklist). Outreach is logged
 * per gap (POST /api/medical/care-gaps, action outreach); closing a gap stays with the provider.
 * Today's rooming queue is the schedule above (Room patient).
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, ClipboardList, Copy, Megaphone, Phone, RefreshCw } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { primaryCareChartHref } from '@/lib/medical/primaryCareRoster';
import { buttonClasses } from '@/components/ui';

type Task = { id: string; clientId: string | null; patient: string | null; title: string; detail: string | null; dueOn: string | null; createdByName: string | null; assignedToId: string | null };
type OutreachRow = {
  clientId: string;
  patient: string;
  phone: string | null;
  gaps: { key: string; label: string; status: string; reason: string; patientReported: { date: string | null; source: string } | null }[];
  overdue: number;
  lastOutreach: string | null;
};
type Worklist = { rows: OutreachRow[]; capped: boolean; scanLimit: number; maskedCount: number; templates: { phone: string; portal: string } };

export function MaWorklist() {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [list, setList] = useState<Worklist | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [t, w] = await Promise.all([
        apiJson<{ tasks: Task[] }>('/api/medical/tasks', { cache: 'no-store' }),
        apiJson<Worklist>('/api/medical/ma-worklist', { cache: 'no-store' }),
      ]);
      setTasks(t.tasks);
      setList(w);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the worklist');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const done = async (id: string) => {
    setBusy(id);
    try {
      await apiJson(`/api/medical/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ status: 'done' }) });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the task');
    } finally {
      setBusy(null);
    }
  };

  const logOutreach = async (row: OutreachRow, method: 'phone' | 'portal') => {
    setBusy(row.clientId);
    setNotice('');
    try {
      for (const g of row.gaps) {
        await apiJson('/api/medical/care-gaps', { method: 'POST', body: JSON.stringify({ clientId: row.clientId, gapKey: g.key, action: 'outreach', method }) });
      }
      setNotice(`Outreach logged for ${row.patient}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not log the outreach');
    } finally {
      setBusy(null);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setNotice('Message copied.');
    } catch {
      setNotice('Copy is not available in this browser.');
    }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 p-4 sm:p-5">
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <ClipboardList size={18} className="text-blue-600" /> My worklist
        </h2>
        <button type="button" onClick={() => void load()} className="inline-flex min-h-10 items-center gap-1 text-xs font-semibold text-slate-600 hover:text-blue-600 md:min-h-8">
          <RefreshCw size={13} /> Refresh
        </button>
      </div>
      <div className="space-y-5 p-5">
        {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p> : null}
        {notice ? <p className="text-xs font-semibold text-emerald-700">{notice}</p> : null}

        <div>
          <h3 className="text-sm font-semibold text-slate-900">Tasks from providers ({tasks?.length ?? 0})</h3>
          {tasks && tasks.length === 0 ? <p className="mt-1 text-xs text-slate-500">No open tasks.</p> : null}
          <ul className="mt-2 divide-y divide-slate-100">
            {(tasks ?? []).map((t) => (
              <li key={t.id} className="flex flex-wrap items-start justify-between gap-2 py-2 text-sm">
                <div>
                  <p className="font-semibold text-slate-900">{t.title}</p>
                  <p className="text-xs text-slate-500">
                    {t.patient ? (
                      t.clientId ? (
                        <Link href={primaryCareChartHref(t.clientId)} className="hover:text-blue-600">
                          {t.patient}
                        </Link>
                      ) : (
                        t.patient
                      )
                    ) : (
                      'No patient'
                    )}
                    {t.createdByName ? ` · from ${t.createdByName}` : ''}
                    {t.dueOn ? ` · due ${t.dueOn}` : ''}
                    {t.assignedToId ? '' : ' · any MA'}
                  </p>
                  {t.detail ? <p className="mt-0.5 text-xs text-slate-600">{t.detail}</p> : null}
                </div>
                <button
                  type="button"
                  disabled={busy === t.id}
                  onClick={() => void done(t.id)}
                  className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                >
                  <CheckCircle2 size={12} /> Done
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Megaphone size={15} className="text-blue-600" /> Care-gap outreach ({list?.rows.length ?? 0})
          </h3>
          <p className="text-[11px] text-slate-500">
            Screening guidance for your care team. Log each call or portal message; the provider verifies anything done elsewhere.
            {list?.capped ? ` First ${list.scanLimit} patients checked.` : ''}
            {list?.maskedCount ? ` ${list.maskedCount} protected record(s) not listed.` : ''}
          </p>
          {list && list.rows.length === 0 ? <p className="mt-1 text-xs text-slate-500">No care gaps due for your care team.</p> : null}
          <ul className="mt-2 divide-y divide-slate-100">
            {(list?.rows ?? []).slice(0, 50).map((r) => {
              const labels = r.gaps.map((g) => g.label.toLowerCase());
              const fill = (tpl: string) => tpl.replace('{screenings}', labels.join(', '));
              return (
                <li key={r.clientId} className="py-2.5 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <Link href={primaryCareChartHref(r.clientId)} className="font-semibold text-slate-900 hover:text-blue-600">
                        {r.patient}
                      </Link>
                      <p className="text-xs text-slate-500">
                        {r.phone ? `${r.phone} · ` : ''}last outreach {r.lastOutreach ?? 'none on file'}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <button type="button" disabled={busy === r.clientId} onClick={() => void copy(fill(list!.templates.phone))} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700">
                        <Copy size={11} /> Call script
                      </button>
                      <button type="button" disabled={busy === r.clientId} onClick={() => void copy(fill(list!.templates.portal))} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700">
                        <Copy size={11} /> Portal message
                      </button>
                      <button type="button" disabled={busy === r.clientId} onClick={() => void logOutreach(r, 'phone')} className={buttonClasses({ size: 'sm' })}>
                        <Phone size={11} /> Log call
                      </button>
                      <button type="button" disabled={busy === r.clientId} onClick={() => void logOutreach(r, 'portal')} className={buttonClasses({ size: 'sm' })}>
                        Log portal message
                      </button>
                    </div>
                  </div>
                  <ul className="mt-1 flex flex-wrap gap-1.5">
                    {r.gaps.map((g) => (
                      <li key={g.key} title={g.reason} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${g.status === 'overdue' ? 'bg-rose-50 text-rose-800' : 'bg-amber-50 text-amber-900'}`}>
                        {g.label}
                        {g.patientReported ? ' (patient-reported, to verify)' : ''}
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}
