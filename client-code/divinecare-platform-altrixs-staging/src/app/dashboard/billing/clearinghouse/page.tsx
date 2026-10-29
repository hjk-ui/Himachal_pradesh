'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Clock, FileText, Inbox, Loader2, RefreshCw, Search, Send, XCircle } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { useAuth } from '@/features/auth';
import { BILLING_STAFF_ONLY, canEditClaims } from '@/lib/billing/billingAccess';
import {
  Alert,
  buttonClasses,
  Card,
  CardBody,
  CardHeader,
  cx,
  EmptyState,
  FOCUS_RING,
  inputClasses,
  LoadingState,
  Page,
  PageHeader,
  StatCard,
  StatGrid,
  StatusBadge,
  Tabs,
} from '@/components/ui';

type InboundFile = { fileName: string; receivedAt: string; processed: boolean; processedAt: string | null; error: string | null; summary: Record<string, unknown> | null };

type Overview = {
  active: boolean;
  usageIndicator: 'T' | 'P';
  eligibility: { defaultChannel: string; waystar: boolean; availity: boolean; note: string | null };
  lastRun: null | { id: string; trigger: string; startedAt: string; finishedAt: string | null; status: string; applied: number; listed: number; eraPosted: number; eraReview: number; error: string | null };
  lastCronRun: null | { startedAt: string; status: string };
  filesByType: Record<string, InboundFile[]>;
  reviewCount: number;
  remittances: Array<{ id: string; payerName: string | null; traceNumber: string; paymentDate: string | null; paymentAmount: number; claimCount: number; status: string; balanced: boolean; plbTotal: number }>;
  outbound: Array<{ kind: string; batchId: string; createdAt: string; status: string; itemCount: number; ackDetail: string | null }>;
  awaitingAdjudication: Array<{ claimId: string; displayId: string; status: string; submittedAt: string | null; lastStatus: string | null }>;
};

type ReviewItem = {
  id: string;
  payerName: string | null;
  traceNumber: string;
  paymentDate: string | null;
  postingStatus: string;
  outcome: string;
  statusText: string;
  claimControlNumber: string;
  payerClaimControlNumber: string | null;
  patientLabel: string | null;
  memberId: string | null;
  serviceDate: string | null;
  charge: number;
  paid: number;
  patientResponsibility: number;
  claimId: string | null;
  matchKind: string;
  reasons: string[];
  adjustments: string[];
  remarks: string[];
  lines: Array<{ seq: number; procedure: string; charge: number; paid: number; serviceDate: string | null; adjustments: string[]; remarks: string[] }>;
  suggestions: Array<{ claimId: string; score: number; why: string[] }>;
  resolutionNote: string | null;
};

const FILE_TYPES: Array<{ key: string; label: string }> = [
  { key: '999', label: '999 acknowledgments' },
  { key: '277CA', label: '277CA claim acknowledgments' },
  { key: '835', label: '835 remittances' },
  { key: '271', label: '271 eligibility' },
  { key: '277', label: '277 claim status' },
  { key: 'TA1', label: 'TA1' },
  { key: 'unknown', label: 'Other' },
];

const money = (n: number) => n.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : '—');
const claimLabel = (id: string) => `CLM-${id.replace(/[^a-zA-Z0-9]/g, '').slice(-4).toUpperCase()}`;

function ago(iso: string | null | undefined) {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

export default function ClearinghousePage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [review, setReview] = useState<ReviewItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runNote, setRunNote] = useState<string | null>(null);
  const [fileTab, setFileTab] = useState('835');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const { user } = useAuth();
  // Retrieval, 276 status requests and ERA posting are billing core only (the APIs refuse
  // Office Manager, who reads this page).
  const canEdit = canEditClaims(user?.role);

  const load = useCallback(async () => {
    try {
      const [o, r] = await Promise.all([
        apiJson<Overview & { success: true }>('/api/waystar/inbound'),
        apiJson<{ success: true; items: ReviewItem[] }>('/api/waystar/remits/review'),
      ]);
      setOverview(o);
      setReview(r.items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load clearinghouse status');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function runNow() {
    setRunning(true); setRunNote(null);
    try {
      const out = await apiJson<{ files: unknown[]; claimUpdates: unknown[]; era: { posted: number; review: number }; eligibilityUpdated: number; notYetArrived: string[]; errors: string[]; listingError?: string }>(
        '/api/waystar/inbound', { method: 'POST' }
      );
      setRunNote(
        `${out.files.length} file(s) applied · ${out.claimUpdates.length} claim update(s) · ${out.era.posted} ERA posted · ${out.era.review} to review · ${out.eligibilityUpdated} eligibility answer(s)` +
          (out.notYetArrived.length ? ` · ${out.notYetArrived.length} still transferring` : '') +
          (out.listingError ? ` · listing: ${out.listingError}` : '') +
          (out.errors.length ? ` · ${out.errors.length} error(s)` : '')
      );
      await load();
    } catch (err) {
      setRunNote(err instanceof Error ? err.message : 'Retrieval failed');
    } finally {
      setRunning(false);
    }
  }

  async function requestStatus() {
    if (!selected.size) return;
    setStatusBusy(true); setStatusNote(null);
    try {
      const out = await apiJson<{ sent: Array<{ displayId: string }>; failed: Array<{ displayId: string; errors: string[] }> }>(
        '/api/billing/claims/waystar-sftp',
        { method: 'POST', body: JSON.stringify({ action: 'request_status', claimIds: Array.from(selected) }) }
      );
      setStatusNote(
        [
          out.sent.length ? `276 sent for ${out.sent.map((s) => s.displayId).join(', ')}; the 277 answer arrives with a later retrieval.` : '',
          ...out.failed.map((f) => `${f.displayId}: ${f.errors.join('; ')}`),
        ].filter(Boolean).join(' ')
      );
      setSelected(new Set());
      await load();
    } catch (err) {
      setStatusNote(err instanceof Error ? err.message : 'Could not send the status request');
    } finally {
      setStatusBusy(false);
    }
  }

  const files = overview?.filesByType[fileTab] ?? [];
  const reviewOpen = useMemo(() => review.filter((r) => r.postingStatus === 'review' || r.postingStatus === 'duplicate'), [review]);

  return (
    <Page>
      <PageHeader
        eyebrow="Billing"
        title="Clearinghouse"
        description={
          <>
            <p>
              Inbound files from Waystar /Download: 999 and 277CA acknowledgments, 835 remittances (posted automatically when the
              claim matches exactly and the amounts reconcile), 271 eligibility answers and 277 claim status answers.
            </p>
            {overview ? (
              <p className="mt-2 text-xs font-medium text-slate-600">
                {overview.active ? (overview.usageIndicator === 'P' ? 'Production (ISA15=P)' : 'Test mode (ISA15=T)') : 'Waystar SFTP is not active on this server'}
                {' · '}Last retrieval {ago(overview.lastRun?.startedAt)}{overview.lastRun ? ` (${overview.lastRun.trigger}, ${overview.lastRun.status})` : ''}
                {' · '}Last scheduled run {ago(overview.lastCronRun?.startedAt)}
              </p>
            ) : null}
          </>
        }
        actions={canEdit ? (
          <button
            type="button"
            disabled={running || !overview?.active}
            onClick={() => void runNow()}
            className={buttonClasses({ variant: 'primary' })}
          >
            {running ? <Loader2 size={16} aria-hidden className="animate-spin" /> : <RefreshCw size={16} aria-hidden />}
            {running ? 'Retrieving (up to a minute)…' : 'Retrieve now'}
          </button>
          ) : (
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600">Read-only. {BILLING_STAFF_ONLY}: retrieve, request status and post ERAs.</p>
          )
        }
      />

      {runNote ? <Alert tone="info">{runNote}</Alert> : null}
      {overview?.lastRun?.error ? <Alert tone="warning">Last run errors: {overview.lastRun.error}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}

      {!overview && !error ? (
        <Card>
          <LoadingState label="Loading clearinghouse status…" />
        </Card>
      ) : null}

      <StatGrid columns={4}>
        <StatCard label="ERA lines to review" value={overview?.reviewCount ?? 0} icon={<AlertTriangle />} tone="warning" />
        <StatCard label="Remittances (recent)" value={overview?.remittances.length ?? 0} icon={<FileText />} tone="brand" />
        <StatCard label="Awaiting adjudication" value={overview?.awaitingAdjudication.length ?? 0} icon={<Clock />} tone="neutral" />
        <StatCard
          label="Eligibility channel"
          value={overview ? (overview.eligibility.waystar ? 'Waystar batch' : overview.eligibility.availity ? 'Availity' : 'None') : '—'}
          icon={<CheckCircle2 />}
          tone="success"
        />
      </StatGrid>

      {/* ERA review queue */}
      <Card>
        <CardHeader
          title={
            <>
              <span className="mb-0.5 block text-xs font-medium uppercase tracking-wider text-slate-500">835 ERA</span>
              ERA review queue
            </>
          }
          description="Remittance lines that were not posted automatically (no exact claim match, amounts that do not reconcile, reversals, claims already paid, duplicates). Post to the right claim or dismiss with a note."
        />
        <CardBody>
          {reviewOpen.length === 0 ? (
            <EmptyState compact icon={<Inbox />} title="Nothing to review." />
          ) : (
            <ul className="space-y-3">
              {reviewOpen.map((item) => <ReviewRow key={item.id} item={item} onDone={load} canEdit={canEdit} />)}
            </ul>
          )}
        </CardBody>
      </Card>

      {/* Remittances */}
      <Card>
        <CardHeader title="Recent remittances" />
        {!overview?.remittances.length ? (
          <EmptyState compact icon={<FileText />} title="No 835 remittances received yet." />
        ) : (
          <>
            <div className="clinic-scroll-x overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-slate-50">
                  <tr className="text-left text-xs font-semibold text-slate-600">
                    <th scope="col" className="px-4 py-2.5">Payer</th>
                    <th scope="col" className="px-4 py-2.5">Check / EFT</th>
                    <th scope="col" className="px-4 py-2.5">Date</th>
                    <th scope="col" className="px-4 py-2.5 text-right">Amount</th>
                    <th scope="col" className="px-4 py-2.5 text-right">Claims</th>
                    <th scope="col" className="px-4 py-2.5 text-right">Provider adj.</th>
                    <th scope="col" className="px-4 py-2.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {overview.remittances.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-semibold text-slate-800">{r.payerName || '—'}</td>
                      <td className="px-4 py-3 font-mono text-xs">{r.traceNumber}</td>
                      <td className="px-4 py-3">{r.paymentDate || '—'}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{money(r.paymentAmount)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{r.claimCount}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{r.plbTotal ? money(r.plbTotal) : '—'}</td>
                      <td className="px-4 py-3">
                        <StatusBadge tone={r.status === 'posted' ? 'success' : r.status === 'partial' ? 'warning' : 'brand'}>
                          {r.status}{r.balanced ? '' : ' · unbalanced'}
                        </StatusBadge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">Posted payments also appear as ERA batches on <Link href="/dashboard/billing/payments" className={cx('rounded font-semibold text-blue-700 hover:underline', FOCUS_RING)}>Payments</Link>.</p>
          </>
        )}
      </Card>

      {/* Claims awaiting adjudication -> 276 */}
      <Card>
        <CardHeader
          title="Claims awaiting adjudication"
          description={<>Sent through Waystar and not yet paid or denied.{canEdit ? ' Select claims to send a 276 status request.' : ''}</>}
          actions={canEdit && (
          <button
            type="button"
            disabled={!selected.size || statusBusy || !overview?.active}
            onClick={() => void requestStatus()}
            className={buttonClasses({ variant: 'secondary', size: 'sm' })}
          >
            {statusBusy ? <Loader2 size={16} aria-hidden className="animate-spin" /> : <Search size={16} aria-hidden />}
            Request status from Waystar{selected.size ? ` (${selected.size})` : ''}
          </button>
            )
          }
        />
        <CardBody className="space-y-3">
          {statusNote ? <Alert tone="neutral">{statusNote}</Alert> : null}
          {!overview?.awaitingAdjudication.length ? (
            <EmptyState compact icon={<Clock />} title="No claims waiting on a payer." />
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {overview.awaitingAdjudication.map((c) => (
                <li key={c.claimId} className="flex items-start gap-3 py-2">
                  {canEdit && <input
                    type="checkbox"
                    aria-label={`Select ${c.displayId}`}
                    checked={selected.has(c.claimId)}
                    onChange={() => setSelected((prev) => { const n = new Set(prev); if (n.has(c.claimId)) n.delete(c.claimId); else n.add(c.claimId); return n; })}
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 accent-blue-600 focus-visible:ring-2 focus-visible:ring-blue-600"
                  />}
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900">{c.displayId} <span className="ml-1 text-xs font-medium text-slate-500">{c.status} · sent {when(c.submittedAt)}</span></p>
                    {c.lastStatus ? <p className="text-xs text-slate-600">{c.lastStatus}</p> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {/* Inbound files by type */}
      <Card>
        <CardHeader title="Inbound files" />
        <div className="px-5 pt-3">
          <Tabs
            label="Inbound file type"
            controlsPanels={false}
            value={fileTab}
            onChange={(key) => setFileTab(key)}
            items={FILE_TYPES.map((t) => ({ key: t.key, label: t.label, count: overview?.filesByType[t.key]?.length ?? 0 }))}
          />
        </div>
        <CardBody>
          {!files.length ? (
            <EmptyState compact icon={<Inbox />} title="No files of this type yet." />
          ) : (
            <ul className="space-y-2 text-sm">
              {files.map((f) => (
                <li key={f.fileName} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 break-all font-mono text-xs font-semibold text-slate-900">{f.fileName}</span>
                    <StatusBadge tone={f.processed ? 'success' : f.error ? 'danger' : 'warning'}>
                      {f.processed ? 'applied' : f.error ? 'retrying' : 'waiting'}
                    </StatusBadge>
                  </div>
                  <p className="text-xs text-slate-500">Received {when(f.receivedAt)}{f.processedAt ? ` · applied ${when(f.processedAt)}` : ''}</p>
                  {f.summary ? (
                    <p className="text-xs text-slate-600">
                      {Object.entries(f.summary).filter(([k]) => k !== 'organizationIds' && k !== 'type').map(([k, v]) => `${k}: ${String(v)}`).join(' · ')}
                    </p>
                  ) : null}
                  {f.error ? <p className="text-xs text-rose-700">{f.error}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {/* Outbound inquiries */}
      <Card>
        <CardHeader title="Eligibility (270) and status (276) files sent" />
        <CardBody className="space-y-3">
          {overview?.eligibility.note ? <Alert tone="brand">{overview.eligibility.note}</Alert> : null}
          {!overview?.outbound.length ? (
            <p className="text-sm text-slate-500">None sent yet. Eligibility checks go out from <Link href="/dashboard/ehr/eligibility" className={cx('rounded font-semibold text-blue-700 hover:underline', FOCUS_RING)}>Insurance Eligibility</Link>.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {overview.outbound.map((o) => (
                <li key={o.batchId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    <Send size={16} aria-hidden className="text-blue-600" />
                    <span className="font-semibold text-slate-900">{o.kind}</span>
                    <span className="font-mono text-xs text-slate-700">{o.batchId}</span>
                    <span className="text-xs text-slate-500">{o.itemCount} item(s) · {when(o.createdAt)}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2 text-xs">
                    <StatusBadge tone={o.status.startsWith('rejected') || o.status === 'failed' ? 'danger' : 'brand'}>{o.status}</StatusBadge>
                    {o.ackDetail ? <span className="text-slate-500">{o.ackDetail}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </Page>
  );
}


function ReviewRow({ item, onDone, canEdit }: { item: ReviewItem; onDone: () => Promise<void>; canEdit: boolean }) {
  const [claimId, setClaimId] = useState(item.claimId || item.suggestions[0]?.claimId || '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function act(action: 'post' | 'dismiss') {
    setBusy(true); setMsg(null);
    try {
      await apiJson('/api/waystar/remits/review', {
        method: 'POST',
        body: JSON.stringify(action === 'post' ? { action, id: item.id, claimId: claimId.trim() || undefined, note: note.trim() || undefined } : { action, id: item.id, note: note.trim() }),
      });
      await onDone();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-slate-900">
            {item.patientLabel || 'Patient'} <span className="font-mono text-xs text-slate-500">CLP01 {item.claimControlNumber}</span>
          </p>
          <p className="text-xs text-slate-600">
            {item.payerName || 'Payer'} · {item.traceNumber} · {item.paymentDate || '—'} · {item.statusText}
            {item.payerClaimControlNumber ? ` · payer ICN ${item.payerClaimControlNumber}` : ''}
            {item.memberId ? ` · member ${item.memberId}` : ''}{item.serviceDate ? ` · DOS ${item.serviceDate}` : ''}
          </p>
        </div>
        <p className="text-right text-xs">
          <span className="block font-semibold tabular-nums text-slate-900">Billed {money(item.charge)} · Paid {money(item.paid)}</span>
          <span className="text-slate-600">Patient responsibility {money(item.patientResponsibility)}</span>
        </p>
      </div>
      <ul className="mt-2 space-y-0.5 text-xs text-amber-800">
        {item.postingStatus === 'duplicate' ? <li className="flex items-center gap-1"><XCircle size={14} aria-hidden /> Duplicate of a remittance already received</li> : null}
        {item.reasons.map((r) => <li key={r} className="flex items-center gap-1"><AlertTriangle size={14} aria-hidden /> {r}</li>)}
      </ul>
      {item.adjustments.length || item.remarks.length ? (
        <p className="mt-2 text-xs text-slate-700">Claim adjustments: {[...item.adjustments, ...item.remarks.map((r) => `RARC ${r}`)].join('; ')}</p>
      ) : null}
      {item.lines.length ? (
        <div className="clinic-scroll-x mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full min-w-[640px] text-xs">
            <thead className="bg-slate-50">
              <tr className="text-left font-semibold text-slate-600">
                <th scope="col" className="px-3 py-2">Line</th>
                <th scope="col" className="px-3 py-2">Procedure</th>
                <th scope="col" className="px-3 py-2">DOS</th>
                <th scope="col" className="px-3 py-2 text-right">Billed</th>
                <th scope="col" className="px-3 py-2 text-right">Paid</th>
                <th scope="col" className="px-3 py-2">Adjustments / remarks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {item.lines.map((l) => (
                <tr key={l.seq} className="align-top">
                  <td className="px-3 py-2">{l.seq}</td><td className="px-3 py-2 font-mono">{l.procedure}</td><td className="px-3 py-2">{l.serviceDate || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(l.charge)}</td><td className="px-3 py-2 text-right tabular-nums">{money(l.paid)}</td>
                  <td className="px-3 py-2">{[...l.adjustments, ...l.remarks.map((r) => `RARC ${r}`)].join('; ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {canEdit && <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="text-xs font-medium text-slate-700">
          Claim
          {item.suggestions.length ? (
            <select value={claimId} onChange={(e) => setClaimId(e.target.value)} className={cx(inputClasses, 'mt-1 w-auto max-w-full')}>
              {item.claimId ? <option value={item.claimId}>{claimLabel(item.claimId)} (matched)</option> : null}
              {item.suggestions.filter((s) => s.claimId !== item.claimId).map((s) => (
                <option key={s.claimId} value={s.claimId}>{claimLabel(s.claimId)} · {s.why.join(', ')}</option>
              ))}
              <option value="">Other (enter claim id)</option>
            </select>
          ) : null}
          {!item.suggestions.length || !claimId ? (
            <input value={claimId} onChange={(e) => setClaimId(e.target.value)} placeholder="Claim id" className={cx(inputClasses, 'mt-1 w-56 max-w-full font-mono')} />
          ) : null}
        </label>
        <label className="min-w-0 flex-1 text-xs font-medium text-slate-700">
          Note
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why (required to dismiss)" className={cx(inputClasses, 'mt-1 min-w-48')} />
        </label>
        <button type="button" disabled={busy || !claimId.trim()} onClick={() => void act('post')} className={buttonClasses({ variant: 'primary', size: 'sm' })}>
          Post to claim
        </button>
        <button type="button" disabled={busy || note.trim().length < 3} onClick={() => void act('dismiss')} className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
          Dismiss
        </button>
      </div>}
      {msg ? <p role="alert" className="mt-2 text-xs font-semibold text-rose-700">{msg}</p> : null}
    </li>
  );
}
