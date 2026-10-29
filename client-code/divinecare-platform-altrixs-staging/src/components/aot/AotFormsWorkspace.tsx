'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, Printer, Plus, Flag, PhoneCall, Home, CheckCircle2, Clock, PenLine, FilePlus2 } from 'lucide-react';
import { OUTREACH_METHODS, OUTREACH_OUTCOMES, OUTREACH_STAFF_ROLES } from '@/lib/aot/forms/deadlines';
import { LIVING_SITUATION_OPTIONS, INCOME_OPTIONS, INSURANCE_OPTIONS } from '@/lib/aot/forms/treatmentPlan';
import { optionLabel } from '@/lib/aot/forms';
import { buttonClasses, LoadingState } from '@/components/ui';

type DocSummary = {
  id: string;
  version: number;
  status: string;
  progress: { pct: number; missing: number; total: number } | null;
  signedAt: string | null;
  signedByName: string | null;
  pendingSlots: string[];
  signatures: { slot: string; name: string }[];
  mailing: { trackingNumber: string; mailedDate: string } | null;
  createdAt: string;
};
type FormRow = {
  formType: string;
  title: string;
  mdhNumber: string | null;
  multiInstance: boolean;
  status: 'not_started' | 'draft' | 'signing' | 'signed';
  latest: DocSummary | null;
  signedCount: number;
  documents: DocSummary[];
  due: { due: string | null; basis: string } | null;
};
type FormFlag = { id: string; formType: string; label: string; due: string | null; daysLeft: number | null; status: string; basis: string };
type Attempt = { id: string; attemptedAt: string; method: string; staffRole: string; result: string };
type Hrsn = {
  chartAvailable: boolean;
  screening: { completedAt: string; positiveDomains: string[] } | null;
  referrals: { domain: string; status: string; resourceName: string | null; createdAt: string }[];
  plan: {
    documentId: string;
    version: number;
    status: string;
    livingSituation: string | null;
    transportationProblems: string | null;
    foodProblems: string | null;
    snap: string | null;
    incomeSources: string[] | null;
    insurance: string[] | null;
  } | null;
};

const ymd = (v: string | null | undefined) => (v ? String(v).slice(0, 10) : '');
const today = () => new Date().toISOString().slice(0, 10);

function StatusBadge({ row }: { row: FormRow }) {
  if (row.status === 'not_started') return <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200">Not started</span>;
  if (row.status === 'draft') return <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200">Draft v{row.latest?.version}</span>;
  if (row.status === 'signing')
    return <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-sky-50 text-sky-800 ring-1 ring-inset ring-sky-200">Signing v{row.latest?.version}</span>;
  return <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200">Signed v{row.latest?.version}</span>;
}

export default function AotFormsWorkspace({ participantId, participantName }: { participantId: string; participantName: string }) {
  const [forms, setForms] = useState<FormRow[]>([]);
  const [flags, setFlags] = useState<FormFlag[]>([]);
  const [hrsn, setHrsn] = useState<Hrsn | null>(null);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [suggestLetter, setSuggestLetter] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [entry, setEntry] = useState({ attemptedAt: today(), method: 'phone', staffRole: 'case_manager', outcome: 'No answer', note: '' });
  const [entryMsg, setEntryMsg] = useState<{ text: string; error: boolean } | null>(null);
  const router = useRouter();

  const load = useCallback(async () => {
    setError(null);
    try {
      const [fr, or] = await Promise.all([
        fetch(`/api/aot/documents?participantId=${encodeURIComponent(participantId)}`),
        fetch(`/api/aot/outreach?participantId=${encodeURIComponent(participantId)}`),
      ]);
      const fj = await fr.json().catch(() => null);
      const oj = await or.json().catch(() => null);
      if (!fr.ok || !fj?.success) throw new Error(fj?.error || `Could not load forms (${fr.status})`);
      setForms(fj.forms ?? []);
      setFlags(fj.flags ?? []);
      setHrsn(fj.hrsn ?? null);
      if (or.ok && oj?.success) {
        setAttempts(oj.attempts ?? []);
        setSuggestLetter(!!oj.suggestLetter);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not load forms');
    }
  }, [participantId]);

  useEffect(() => {
    load();
  }, [load]);

  const start = async (formType: string, amendFromId?: string) => {
    setBusy(formType);
    setError(null);
    try {
      const res = await fetch('/api/aot/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantId, formType, amendFromId }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.error || `Could not start the form (${res.status})`);
      router.push(`/dashboard/aot/forms/${json.document.id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not start the form');
      setBusy('');
    }
  };

  const addAttempt = async () => {
    setBusy('outreach');
    setEntryMsg(null);
    try {
      const result = entry.note.trim() ? `${entry.outcome} — ${entry.note.trim()}` : entry.outcome;
      const res = await fetch('/api/aot/outreach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantId, attemptedAt: entry.attemptedAt, method: entry.method, staffRole: entry.staffRole, result }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.error || `Not saved (${res.status})`);
      setEntry((e) => ({ ...e, note: '' }));
      setEntryMsg({ text: 'Outreach attempt saved.', error: false });
      await load();
    } catch (err: unknown) {
      setEntryMsg({ text: err instanceof Error ? err.message : 'Not saved', error: true });
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="space-y-4">
      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>}

      {flags.length > 0 && (
        <div className="bg-white rounded-xl border-2 border-amber-200 p-4">
          <h3 className="text-sm font-semibold text-slate-800 mb-2 flex items-center gap-2"><Flag className="h-4 w-4 text-amber-700" /> Form deadlines</h3>
          <ul className="space-y-1.5">
            {flags.map((f) => (
              <li key={f.id} className="text-xs flex flex-wrap gap-x-2">
                <span className={`font-semibold ${f.status === 'overdue' ? 'text-rose-700' : f.status === 'due' ? 'text-amber-700' : 'text-slate-700'}`}>{f.label}</span>
                {f.due && <span className="text-slate-600">due {f.due}{f.daysLeft !== null ? (f.daysLeft < 0 ? ` (${-f.daysLeft}d overdue)` : ` (in ${f.daysLeft}d)`) : ''}</span>}
                <span className="text-slate-500">{f.basis}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200">
        <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2">
          <FileText className="h-4 w-4 text-blue-600" />
          <h3 className="text-sm font-semibold text-slate-800">MDH AOT forms — {participantName}</h3>
          <span className="w-full text-[11px] text-slate-500 sm:ml-auto sm:w-auto">Revised 06/25/2026 · staff print and send; nothing is sent automatically</span>
        </div>
        <ul className="divide-y divide-slate-100">
          {forms.map((row) => {
            const latest = row.latest;
            const signedDocs = row.documents.filter((d) => d.status === 'signed');
            return (
              <li key={row.formType} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">
                      {row.title} {row.mdhNumber && <span className="text-[11px] font-mono text-slate-500">{row.mdhNumber}</span>}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {row.due?.due ? <>Due {row.due.due} · {row.due.basis}</> : row.due ? row.due.basis : row.multiInstance ? 'Completed when the event occurs' : ''}
                      {latest?.progress && row.status !== 'signed' ? ` · ${latest.progress.pct}% complete` : ''}
                      {row.multiInstance && row.signedCount > 0 ? ` · ${row.signedCount} signed` : ''}
                    </p>
                  </div>
                  <StatusBadge row={row} />
                  <div className="ml-auto flex flex-wrap gap-1.5">
                    {latest && (
                      <a href={`/dashboard/aot/forms/${latest.id}`} className="inline-flex min-h-10 items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 sm:min-h-0">
                        <PenLine className="h-3.5 w-3.5" /> Open
                      </a>
                    )}
                    {latest && (
                      <a href={`/dashboard/aot/forms/${latest.id}/print`} className="inline-flex min-h-10 items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 sm:min-h-0">
                        <Printer className="h-3.5 w-3.5" /> Print
                      </a>
                    )}
                    {row.status === 'not_started' && (
                      <button onClick={() => start(row.formType)} disabled={!!busy} className={buttonClasses({ size: 'sm' })}>
                        <Plus className="h-3.5 w-3.5" /> {busy === row.formType ? 'Starting…' : 'Start'}
                      </button>
                    )}
                    {row.status === 'signed' && row.multiInstance && (
                      <button onClick={() => start(row.formType)} disabled={!!busy} className={buttonClasses({ size: 'sm' })}>
                        <Plus className="h-3.5 w-3.5" /> New
                      </button>
                    )}
                    {row.status === 'signed' && !row.multiInstance && latest && (
                      <button onClick={() => start(row.formType, latest.id)} disabled={!!busy} className="inline-flex min-h-10 items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 sm:min-h-0 disabled:opacity-50">
                        <FilePlus2 className="h-3.5 w-3.5" /> Amend
                      </button>
                    )}
                  </div>
                </div>
                {row.multiInstance && signedDocs.length > 1 && (
                  <ul className="mt-1.5 ml-1 space-y-0.5">
                    {signedDocs.slice(1).map((d) => (
                      <li key={d.id} className="text-[11px] text-slate-500">
                        <a href={`/dashboard/aot/forms/${d.id}`} className="hover:underline">v{d.version} signed {ymd(d.signedAt)}{d.signedByName ? ` by ${d.signedByName}` : ''}</a>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
          {forms.length === 0 && !error && <li><LoadingState rows={3} label="Loading forms…" /></li>}
        </ul>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2"><PhoneCall className="h-4 w-4 text-blue-600" /> Outreach log</h3>
          {suggestLetter && (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Three or more outreach attempts in a row did not reach the respondent. Consider the Non-Responsive Respondent letter (MDH#0002BHA).
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 mb-2">
            <input type="date" value={entry.attemptedAt} max={today()} onChange={(e) => setEntry((x) => ({ ...x, attemptedAt: e.target.value }))} className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs" aria-label="Date" />
            <select value={entry.method} onChange={(e) => setEntry((x) => ({ ...x, method: e.target.value }))} className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs" aria-label="Method">
              {OUTREACH_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            <select value={entry.staffRole} onChange={(e) => setEntry((x) => ({ ...x, staffRole: e.target.value }))} className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs" aria-label="Staff role">
              {OUTREACH_STAFF_ROLES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            <select value={entry.outcome} onChange={(e) => setEntry((x) => ({ ...x, outcome: e.target.value }))} className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs" aria-label="Result">
              {OUTREACH_OUTCOMES.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            <input value={entry.note} onChange={(e) => setEntry((x) => ({ ...x, note: e.target.value }))} placeholder="Details (feedback, concerns, barriers)" className="col-span-2 rounded-lg border border-slate-300 px-2 py-1.5 text-xs" />
          </div>
          <button onClick={addAttempt} disabled={!!busy || (entry.outcome === 'Other' && !entry.note.trim())} className={buttonClasses({ size: 'sm' })}>
            {busy === 'outreach' ? 'Saving…' : 'Add attempt'}
          </button>
          {entryMsg && <p className={`mt-1.5 text-xs ${entryMsg.error ? 'text-rose-600' : 'text-emerald-700'}`}>{entryMsg.text}</p>}
          <ul className="mt-3 space-y-1.5 max-h-64 overflow-y-auto">
            {attempts.map((a) => (
              <li key={a.id} className="text-xs border-b border-slate-50 pb-1.5">
                <span className="font-mono text-slate-500">{ymd(a.attemptedAt)}</span>{' '}
                <span className="font-semibold text-slate-700">{OUTREACH_METHODS.find((m) => m.value === a.method)?.label ?? a.method}</span>{' '}
                <span className="text-slate-500">({OUTREACH_STAFF_ROLES.find((m) => m.value === a.staffRole)?.label ?? a.staffRole})</span>
                <p className="text-slate-700">{a.result}</p>
              </li>
            ))}
            {attempts.length === 0 && <li className="text-xs text-slate-500">No outreach attempts logged.</li>}
          </ul>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2"><Home className="h-4 w-4 text-blue-600" /> Health-related social needs</h3>
          {!hrsn ? (
            <p className="text-xs text-slate-500">Loading…</p>
          ) : (
            <div className="space-y-2 text-xs text-slate-700">
              {hrsn.plan ? (
                <div className="space-y-0.5">
                  <p className="font-semibold text-slate-800">Treatment plan v{hrsn.plan.version} ({hrsn.plan.status})</p>
                  <p>Living situation: {hrsn.plan.livingSituation ? optionLabel(LIVING_SITUATION_OPTIONS, hrsn.plan.livingSituation) : 'not recorded'}</p>
                  <p>Transportation: {hrsn.plan.transportationProblems || 'not recorded'} · Food: {hrsn.plan.foodProblems || 'not recorded'} · SNAP: {hrsn.plan.snap || 'not recorded'}</p>
                  <p>Income: {hrsn.plan.incomeSources?.length ? hrsn.plan.incomeSources.map((x) => optionLabel(INCOME_OPTIONS, x)).join(', ') : 'not recorded'}</p>
                  <p>Insurance: {hrsn.plan.insurance?.length ? hrsn.plan.insurance.map((x) => optionLabel(INSURANCE_OPTIONS, x)).join(', ') : 'not recorded'}</p>
                </div>
              ) : (
                <p className="text-slate-500">No treatment plan HRSN answers yet.</p>
              )}
              {!hrsn.chartAvailable ? (
                <p className="text-slate-500">SDOH screening not shown: no linked chart, or the chart is not on your caseload.</p>
              ) : (
                <>
                  <p>
                    <span className="font-semibold text-slate-800">AHC HRSN screening: </span>
                    {hrsn.screening
                      ? `${ymd(hrsn.screening.completedAt)} — ${hrsn.screening.positiveDomains.length ? hrsn.screening.positiveDomains.join(', ') : 'no positive domains'}`
                      : 'none on file'}
                  </p>
                  {hrsn.referrals.length > 0 && (
                    <ul className="space-y-0.5">
                      {hrsn.referrals.map((r, i) => (
                        <li key={i} className="flex items-center gap-1.5">
                          {r.status === 'connected' || r.status === 'closed' ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" /> : <Clock className="h-3.5 w-3.5 text-amber-700" />}
                          {r.domain}{r.resourceName ? ` — ${r.resourceName}` : ''} · {r.status} · {ymd(r.createdAt)}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
