'use client';

/**
 * Carelon non-overlap attestations (Maryland Medicaid): every Medicaid client in the viewer's scope
 * with their attestation status. Opens the client's form (/dashboard/ehr/consents/carelon/[clientId]).
 */
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, ClipboardList, FileSignature, Info, Loader2, Send } from 'lucide-react';
import { EmptyState, PageHeader, Panel, StatCard } from '@/components/clinic/ui';
import { formatPracticeMdY } from '@/lib/consents/carelon/prefill';
import { DEFAULT_PRACTICE_TIME_ZONE } from '@/lib/time/practiceTime';
import { CARELON_STATUS_LABEL, REQUIREMENT_LABEL, type ClientStatusRow, type StatusFilter, type StatusSummary } from '@/lib/consents/carelon/workflow';
import { Alert } from '@/components/ui';

const FILTERS: { id: StatusFilter; label: string }[] = [
  { id: 'needs_action', label: 'Needs action' },
  { id: 'not_started', label: 'Not started' },
  { id: 'pending_signature', label: 'Pending signature' },
  { id: 'needs_new', label: 'New needed' },
  { id: 'not_submitted', label: 'Signed, not submitted' },
  { id: 'submitted', label: 'Submitted to Carelon' },
  { id: 'complete', label: 'Complete' },
  { id: 'all', label: 'All Medicaid clients' },
];

const STATE_TONE: Record<string, string> = {
  complete: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  needs_new: 'bg-amber-50 text-amber-800 ring-amber-200',
  pending_provider: 'bg-blue-50 text-blue-600 ring-blue-200',
  pending_client: 'bg-sky-50 text-sky-800 ring-sky-200',
  not_started: 'bg-slate-100 text-slate-700 ring-slate-200',
};


export default function CarelonAttestationsPage() {
  const [filter, setFilter] = useState<StatusFilter>('needs_action');
  const [rows, setRows] = useState<ClientStatusRow[] | null>(null);
  const [summary, setSummary] = useState<StatusSummary | null>(null);
  const [rule, setRule] = useState<string[]>([]);
  const [comar, setComar] = useState('');
  const [hidden, setHidden] = useState(0);
  const [error, setError] = useState('');
  const [timeZone, setTimeZone] = useState(DEFAULT_PRACTICE_TIME_ZONE);
  /** MM/DD/YYYY on the practice clock */
  const day = (iso: string | null) => (iso ? formatPracticeMdY(iso, timeZone) ?? '—' : '—');

  const load = useCallback(async (f: StatusFilter) => {
    setRows(null);
    setError('');
    try {
      const res = await fetch(`/api/consents/carelon?filter=${encodeURIComponent(f)}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Could not load');
      setRows(data.rows);
      setSummary(data.summary);
      setRule(data.ruleExplanation ?? []);
      setComar(data.comarNote ?? '');
      setHidden(data.hiddenProtected ?? 0);
      if (data.timeZone) setTimeZone(data.timeZone);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load Carelon attestations');
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load(filter);
  }, [filter, load]);

  return (
    <div className="space-y-5">
      <Link href="/dashboard/ehr/consents" className="inline-flex items-center gap-1 text-sm font-semibold text-blue-600 hover:underline">
        <ArrowLeft size={14} /> Consent forms
      </Link>
      <PageHeader
        eyebrow="Altrixs · Consents"
        title="Carelon non-overlap attestations"
        description="Carelon Behavioral Health - Maryland: Attestation to Discharge Conflicting/Overlapping Authorization(s) Due to Non-Overlap Requirement. Required for every Maryland Medicaid client."
      />

      {summary ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatCard label="Medicaid clients" value={summary.total} icon={<ClipboardList size={16} />} tone="slate" />
          <StatCard label="Complete" value={summary.complete} icon={<CheckCircle2 size={16} />} tone="green" />
          <StatCard label="Pending signature" value={summary.pendingSignature} icon={<FileSignature size={16} />} tone="violet" />
          <StatCard label="Not started / new needed" value={summary.notStarted + summary.needsNew} icon={<Info size={16} />} tone="amber" />
          <StatCard label="Submitted to Carelon" value={summary.submitted} hint={`${summary.completeNotSubmitted} signed, not submitted`} icon={<Send size={16} />} tone="blue" />
        </div>
      ) : null}

      <Panel>
        <details>
          <summary className="cursor-pointer text-sm font-semibold text-slate-800">Who needs this form, and when a new one is needed</summary>
          <div className="mt-2 space-y-2 text-[13px] leading-relaxed text-slate-600">
            {rule.map((r) => <p key={r}>{r}</p>)}
            {comar ? <p>{comar}</p> : null}
            <p>Altrixs does not send the form to Carelon. After both parts are signed, download the PDF, upload it in Carelon&apos;s provider portal, then record the submission date on the client&apos;s form.</p>
          </div>
        </details>
      </Panel>

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ${filter === f.id ? 'bg-blue-600 text-white ring-blue-600' : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50'}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Panel padding={false}>
        {rows === null ? (
          <p role="status" className="flex items-center gap-2 p-5 text-sm text-slate-500"><Loader2 size={14} className="animate-spin" /> Loading…</p>
        ) : rows.length === 0 ? (
          <EmptyState title="No clients in this view" description="Clients appear here when they have Maryland Medicaid coverage." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-2.5">Client</th>
                  <th scope="col" className="px-4 py-2.5">Medicaid payer</th>
                  <th scope="col" className="px-4 py-2.5">Status</th>
                  <th scope="col" className="px-4 py-2.5">Open request</th>
                  <th scope="col" className="px-4 py-2.5">Completed</th>
                  <th scope="col" className="px-4 py-2.5">Submitted to Carelon</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.clientId} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <Link href={`/dashboard/ehr/consents/carelon/${encodeURIComponent(r.clientId)}`} className="font-semibold text-blue-600 hover:underline">{r.clientName}</Link>
                      {r.mrn ? <span className="ml-1.5 text-xs text-slate-500">MRN {r.mrn}</span> : null}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{r.payerName ?? (r.medicaidReasons.length ? 'MA number on file' : '—')}</td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${STATE_TONE[r.state] ?? STATE_TONE.not_started}`}>{REQUIREMENT_LABEL[r.state]}</span>
                      {r.state === 'needs_new' && r.neededReason ? <p className="mt-0.5 text-xs text-slate-500">{r.neededReason}</p> : null}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{r.openStatus ? CARELON_STATUS_LABEL[r.openStatus] : '—'}</td>
                    <td className="px-4 py-2.5 text-slate-600">{day(r.completedAt)}</td>
                    <td className="px-4 py-2.5 text-slate-600">{r.currentId ? (r.submitted ? day(r.submittedAt) : 'Not yet') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {hidden > 0 ? <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">{hidden} protected record{hidden === 1 ? '' : 's'} you cannot open {hidden === 1 ? 'is' : 'are'} not listed.</p> : null}
      </Panel>
    </div>
  );
}
