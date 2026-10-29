'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Inbox, Loader2, RefreshCw, Search } from 'lucide-react';
import { apiJson } from '@/lib/api-client';

export type WaystarBatchSummary = {
  batchId: string;
  fileName: string;
  sentAt: string;
  usageIndicator: string;
  delivery: string;
  claimCount: number;
  rowStatus: string | null;
  transferId: string | null;
  claims: Array<{ claimId: string; displayId: string; status: string; lastResponse: string | null }>;
};

export type WaystarChannel = {
  active: boolean;
  configured: boolean;
  usageIndicator: 'T' | 'P';
  statusLine: string | null;
  configProblems: string[];
  batches: WaystarBatchSummary[];
};

type CheckOutcome = {
  listedFiles: number;
  listingError?: string;
  listingTruncated: boolean;
  newlyRequested: string[];
  notYetArrived: string[];
  files: Array<{ fileName: string; type: string; summary: string; unmatched: string[] }>;
  claimUpdates: Array<{ claimId: string; displayId: string; from: string; to: string; type: string; reason: string }>;
  era?: { posted: number; review: number; duplicates: number };
  eligibilityUpdated?: number;
  errors?: string[];
};

type StatusOutcome = {
  sent: Array<{ claimId: string; displayId: string }>;
  failed: Array<{ claimId: string; displayId: string; errors: string[] }>;
  batch: null | { batchId: string; delivery: string; deliveryNote?: string; usageIndicator: 'T' | 'P' };
};

const BATCH_STATUS: Record<string, string> = {
  transferred: 'Sent',
  acknowledged_999: '999 received',
  rejected_277ca: '277CA rejected',
  failed: 'Failed / rejected',
  staged: 'Staged',
  demo: 'Demo',
};

const STATUS_REQUESTABLE = new Set(['SUBMITTED', 'ACCEPTED', 'DENIED']);

export function WaystarResponsesPanel({ channel, onChanged }: { channel: WaystarChannel; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<CheckOutcome | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusOutcome, setStatusOutcome] = useState<StatusOutcome | null>(null);

  async function check() {
    setBusy(true); setError(null); setOutcome(null);
    try {
      const data = await apiJson<CheckOutcome>('/api/billing/claims/waystar-sftp', { method: 'POST' });
      setOutcome(data);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not check Waystar responses');
    } finally {
      setBusy(false);
    }
  }

  async function requestStatus() {
    if (!selected.size) return;
    setStatusBusy(true); setError(null); setStatusOutcome(null);
    try {
      const data = await apiJson<StatusOutcome>('/api/billing/claims/waystar-sftp', {
        method: 'POST',
        body: JSON.stringify({ action: 'request_status', claimIds: Array.from(selected) }),
      });
      setStatusOutcome(data);
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not request claim status');
    } finally {
      setStatusBusy(false);
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <section className="space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Waystar SFTP</p>
          <h2 className="mt-1 text-lg font-black text-slate-900">Batches and responses</h2>
          <p className="mt-1 text-sm text-slate-500">
            Pulls new files from Waystar /Download and applies 999 acknowledgments, 277CA / 277 claim statuses, 835 remittances
            (auto-posted when they match and reconcile) and 271 eligibility answers. The same pull also runs on a schedule.{' '}
            <Link href="/dashboard/billing/clearinghouse" className="font-bold text-[#5C2D91] underline-offset-2 hover:underline">
              Open Clearinghouse
            </Link>
          </p>
        </div>
        <button
          type="button"
          disabled={busy || !channel.active}
          onClick={() => void check()}
          className="inline-flex items-center gap-2 rounded-xl bg-[#5C2D91] px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          {busy ? 'Checking (up to a minute)…' : 'Check Waystar responses'}
        </button>
      </div>

      {error ? <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</p> : null}

      {outcome ? (
        <div role="status" className="space-y-3 rounded-2xl bg-slate-50 p-4 text-sm">
          <p className="font-bold text-slate-800">
            {outcome.listedFiles} file{outcome.listedFiles === 1 ? '' : 's'} in /Download · {outcome.newlyRequested.length} new pulled ·{' '}
            {outcome.files.length} applied · {outcome.claimUpdates.length} claim status change{outcome.claimUpdates.length === 1 ? '' : 's'}
            {outcome.era ? ` · ${outcome.era.posted} ERA posted, ${outcome.era.review} to review` : ''}
            {outcome.eligibilityUpdated ? ` · ${outcome.eligibilityUpdated} eligibility answer${outcome.eligibilityUpdated === 1 ? '' : 's'}` : ''}
          </p>
          {outcome.era?.review ? (
            <p className="text-amber-800">
              {outcome.era.review} remittance line{outcome.era.review === 1 ? ' needs' : 's need'} review.{' '}
              <Link href="/dashboard/billing/clearinghouse" className="font-bold underline">Open the ERA review queue</Link>
            </p>
          ) : null}
          {outcome.listingError ? <p className="text-amber-800">Listing: {outcome.listingError}</p> : null}
          {outcome.listingTruncated ? <p className="text-amber-800">The listing was truncated; check again for the rest.</p> : null}
          {outcome.notYetArrived.length ? (
            <p className="text-amber-800">Still transferring (check again shortly): {outcome.notYetArrived.join(', ')}</p>
          ) : null}
          {outcome.errors?.length ? <p className="text-rose-800">Errors: {outcome.errors.join('; ')}</p> : null}
          {outcome.claimUpdates.length ? (
            <ul className="space-y-1">
              {outcome.claimUpdates.map((u) => (
                <li key={`${u.claimId}:${u.type}`} className={u.to === 'DENIED' ? 'text-rose-800' : 'text-emerald-800'}>
                  <span className="font-bold">{u.displayId}</span> {u.from} → {u.to} ({u.type}): {u.reason}
                </li>
              ))}
            </ul>
          ) : null}
          {outcome.files.length ? (
            <ul className="space-y-2">
              {outcome.files.map((f) => (
                <li key={f.fileName} className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
                  <p className="font-bold text-slate-900">{f.fileName} <span className="ml-1 rounded-full bg-violet-50 px-2 py-0.5 text-xs text-[#5C2D91]">{f.type}</span></p>
                  <p className="text-slate-600">{f.summary}</p>
                  {f.unmatched.length ? (
                    <p className="mt-1 text-amber-800">Not matched to a claim here: {f.unmatched.join('; ')}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Recent batches</p>
          <button
            type="button"
            disabled={!selected.size || statusBusy || !channel.active}
            onClick={() => void requestStatus()}
            title="Sends a 276 claim status request; the 277 answer arrives with a later retrieval"
            className="inline-flex items-center gap-1.5 rounded-xl border border-[#5C2D91] px-3 py-1.5 text-xs font-bold text-[#5C2D91] disabled:opacity-40"
          >
            {statusBusy ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
            Request status from Waystar{selected.size ? ` (${selected.size})` : ''}
          </button>
        </div>
        {statusOutcome ? (
          <div role="status" className="mt-2 rounded-xl bg-slate-50 p-3 text-xs">
            {statusOutcome.sent.length ? (
              <p className="text-emerald-800">
                276 sent for {statusOutcome.sent.map((s) => s.displayId).join(', ')}
                {statusOutcome.batch ? ` (batch ${statusOutcome.batch.batchId}, ${statusOutcome.batch.delivery})` : ''}. The 277 answer is applied by the next retrieval.
              </p>
            ) : null}
            {statusOutcome.failed.map((f) => (
              <p key={f.claimId} className="text-rose-800"><span className="font-bold">{f.displayId}</span>: {f.errors.join('; ')}</p>
            ))}
          </div>
        ) : null}
        {channel.batches.length === 0 ? (
          <p className="mt-2 flex items-center gap-2 text-sm text-slate-500"><Inbox size={15} /> No claims sent through Waystar SFTP yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {channel.batches.map((b) => (
              <li key={b.batchId} className="rounded-xl border border-slate-100 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-slate-900">{b.batchId}</span>
                  <span className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-bold text-[#5C2D91]">
                    {(b.rowStatus && BATCH_STATUS[b.rowStatus]) || b.rowStatus || 'Sent'} · {b.usageIndicator === 'P' ? 'production' : 'test'}
                  </span>
                </div>
                <p className="text-xs text-slate-500">
                  {new Date(b.sentAt).toLocaleString()} · {b.claimCount} claim{b.claimCount === 1 ? '' : 's'} · {b.delivery === 'completed' ? 'delivered' : 'delivery not confirmed'}
                </p>
                <ul className="mt-2 space-y-1 text-xs">
                  {b.claims.map((c) => (
                    <li key={c.claimId} className="flex items-start gap-2 text-slate-700">
                      {STATUS_REQUESTABLE.has(c.status) ? (
                        <input
                          type="checkbox"
                          aria-label={`Select ${c.displayId} for a status request`}
                          checked={selected.has(c.claimId)}
                          onChange={() => toggle(c.claimId)}
                          className="mt-0.5 accent-[#5C2D91]"
                        />
                      ) : <span className="inline-block w-[13px]" />}
                      <span>
                        <span className="font-bold">{c.displayId}</span> · {c.status}
                        {c.lastResponse ? <span className="text-slate-500"> · {c.lastResponse}</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
