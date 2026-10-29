'use client';

/**
 * Note quality checklist: before a supervisor co-signs (mode "cosign") and as the author's
 * pre-sign checklist (mode "presign"). Suggestions only: the reviewer decides, and nothing here
 * changes the note. AI items show the note text they rely on.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardCheck, CornerUpLeft, Loader2, MinusCircle, RefreshCw, Shield, Sparkles, XCircle } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import {
  QUALITY_CATEGORY_LABELS,
  findingsOf,
  type QualityCategory,
  type QualityItem,
  type QualityMode,
  type QualityReport,
  type QualityStatus,
} from '@/lib/ai/noteQuality/types';

const STATUS_ICON: Record<QualityStatus, { icon: typeof CheckCircle2; cls: string; label: string }> = {
  pass: { icon: CheckCircle2, cls: 'text-emerald-600', label: 'Pass' },
  warn: { icon: AlertTriangle, cls: 'text-amber-600', label: 'Check' },
  fail: { icon: XCircle, cls: 'text-red-600', label: 'Fix' },
  na: { icon: MinusCircle, cls: 'text-slate-400', label: 'N/A' },
};

const CATEGORY_ORDER: QualityCategory[] = ['required', 'time', 'telehealth', 'diagnosis', 'plan', 'risk', 'narrative', 'signature', 'timeliness', 'cosign'];

function fmt(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function ItemRow({ item }: { item: QualityItem }) {
  const s = STATUS_ICON[item.status];
  const Icon = s.icon;
  return (
    <li className="flex gap-2.5 py-2">
      <Icon size={16} className={`mt-0.5 shrink-0 ${s.cls}`} aria-label={s.label} />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold text-slate-800">
          {item.label}
          {item.source === 'ai' && (
            <span className="ml-1.5 inline-flex items-center gap-0.5 rounded-full bg-[#5C2D91]/10 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-[#5C2D91]">
              <Sparkles size={10} /> AI
            </span>
          )}
        </p>
        <p className="text-slate-600">{item.detail}</p>
        {item.fix && <p className="mt-0.5 text-xs font-medium text-slate-700">Fix: {item.fix}</p>}
        {item.quotes?.map((q) => (
          <blockquote key={q} className="mt-1 border-l-2 border-[#5C2D91]/30 pl-2 text-xs italic text-slate-500">
            “{q}”
          </blockquote>
        ))}
      </div>
    </li>
  );
}

export function NoteQualityPanel({
  noteId,
  mode,
  comment = '',
  onCosigned,
  onReturned,
}: {
  noteId: string;
  mode: QualityMode;
  /** Supervisor comment typed on the page; saved with "Co-sign anyway" / "Return to author" */
  comment?: string;
  onCosigned?: (noteId: string) => void;
  onReturned?: (noteId: string) => void;
}) {
  const [report, setReport] = useState<QualityReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showNa, setShowNa] = useState(false);
  const [acting, setActing] = useState<'return' | 'cosign' | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  /** Pre-sign mode for someone who is not the author: render nothing */
  const [hidden, setHidden] = useState(false);

  const run = useCallback(
    async (ai: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiJson<{ success: true; report: QualityReport }>(`/api/notes/${encodeURIComponent(noteId)}/quality-check`, {
          method: 'POST',
          credentials: 'include',
          body: JSON.stringify({ mode, ai }),
        });
        setReport(res.report);
      } catch (err) {
        if (mode === 'presign' && (err as { status?: number }).status === 403) setHidden(true);
        else setError(err instanceof Error ? err.message : 'Could not run the quality check');
      } finally {
        setLoading(false);
      }
    },
    [noteId, mode]
  );

  useEffect(() => {
    setReport(null);
    setActionMsg(null);
    // Rule checks run on open; the AI narrative pass is one click (it sends text to the model)
    void run(false);
  }, [run]);

  const grouped = useMemo(() => {
    const items = (report?.items ?? []).filter((i) => showNa || i.status !== 'na');
    return CATEGORY_ORDER.map((c) => ({ category: c, items: items.filter((i) => i.category === c) })).filter((g) => g.items.length);
  }, [report, showNa]);

  const findings = report ? findingsOf(report.items) : [];
  const naCount = report?.counts.na ?? 0;

  async function act(action: 'return' | 'cosign') {
    if (!report || acting) return;
    setActing(action);
    setActionMsg(null);
    try {
      await apiJson(`/api/notes/${encodeURIComponent(noteId)}/quality-check/review`, {
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ action, findings, ...(comment.trim() ? { comment: comment.trim() } : {}) }),
      });
      if (action === 'cosign') onCosigned?.(noteId);
      else {
        setActionMsg('Returned to the author with this checklist. The note stays in the queue until it is co-signed.');
        onReturned?.(noteId);
        void run(false);
      }
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActing(null);
    }
  }

  const review = report?.lastReview ?? null;
  if (hidden) return null;

  return (
    <section className="rounded-xl border border-slate-200 bg-white" aria-label="Note quality check">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <ClipboardCheck size={16} className="text-[#5C2D91]" />
          <h3 className="text-sm font-bold text-slate-900">{mode === 'cosign' ? 'Quality check before co-sign' : 'Pre-sign checklist'}</h3>
          {report && (
            <span className="text-xs text-slate-500">
              {report.counts.fail} to fix · {report.counts.warn} to check · {report.counts.pass} pass
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => void run(true)}
            disabled={loading}
            className="inline-flex items-center gap-1 rounded-lg border border-[#5C2D91]/30 px-2.5 py-1 text-xs font-semibold text-[#5C2D91] hover:bg-[#5C2D91]/5 disabled:opacity-50"
          >
            <Sparkles size={12} /> AI narrative check
          </button>
          <button
            type="button"
            onClick={() => void run(false)}
            disabled={loading}
            aria-label="Re-run checks"
            className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 disabled:opacity-50"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          </button>
        </div>
      </div>

      <div className="px-4 py-2">
        {review && (
          <div className={`my-2 rounded-lg border px-3 py-2 text-xs ${review.action === 'RETURNED' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
            <p className="font-semibold">
              {review.action === 'RETURNED' ? 'Returned to author' : 'Co-signed with findings'} by {review.reviewerName || 'a supervisor'} · {fmt(review.createdAt)}
              {review.action === 'RETURNED' && ` · ${review.addendaSince ? `${review.addendaSince} addendum${review.addendaSince === 1 ? '' : 'a'} added since` : 'no addendum yet'}`}
            </p>
            {review.comment && <p className="mt-0.5">“{review.comment}”</p>}
            {review.findings.length > 0 && (
              <ul className="mt-1 list-disc pl-4">
                {review.findings.slice(0, 8).map((f) => (
                  <li key={f.id}>
                    {f.label}
                    {f.fix ? `: ${f.fix}` : ''}
                  </li>
                ))}
              </ul>
            )}
            {review.action === 'RETURNED' && mode === 'presign' && <p className="mt-1">A signed note is corrected with an addendum.</p>}
          </div>
        )}

        {error && <p className="my-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
        {!report && loading && <p className="py-4 text-center text-xs text-slate-500">Checking the note…</p>}

        {report && (
          <>
            <p className="mt-1 text-[11px] text-slate-500">
              {report.ai.state === 'used'
                ? 'AI narrative checks ran on the note text with names removed; every AI finding quotes the note.'
                : report.ai.state === 'skipped'
                  ? `Narrative items are rule checks: ${report.ai.reason}.`
                  : `Narrative items are rule checks: AI unavailable (${report.ai.reason}).`}
            </p>
            {grouped.map((g) => (
              <div key={g.category} className="mt-2">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{QUALITY_CATEGORY_LABELS[g.category]}</p>
                <ul className="divide-y divide-slate-50">
                  {g.items.map((i) => (
                    <ItemRow key={i.id} item={i} />
                  ))}
                </ul>
              </div>
            ))}
            {naCount > 0 && (
              <button type="button" onClick={() => setShowNa((v) => !v)} className="mt-1 text-xs font-medium text-slate-500 underline-offset-2 hover:underline">
                {showNa ? 'Hide' : 'Show'} {naCount} not applicable
              </button>
            )}
          </>
        )}

        <p className="mt-3 text-[11px] text-slate-500">
          Suggestions only. {mode === 'cosign' ? 'You decide whether to co-sign.' : 'You decide what to change before signing.'} Nothing here edits the note.
        </p>

        {mode === 'cosign' && report && (
          <div className="mt-3 flex flex-wrap gap-2 pb-2">
            <button
              type="button"
              onClick={() => void act('return')}
              disabled={Boolean(acting) || (findings.length === 0 && !comment.trim())}
              title={findings.length === 0 && !comment.trim() ? 'Add a comment to return a note with no findings' : undefined}
              className="inline-flex items-center gap-1.5 rounded-xl border border-amber-300 px-3 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-50 disabled:opacity-50"
            >
              <CornerUpLeft size={14} /> {acting === 'return' ? 'Returning…' : 'Return to author'}
            </button>
            <button
              type="button"
              onClick={() => void act('cosign')}
              disabled={Boolean(acting)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#5C2D91] px-3 py-2 text-sm font-semibold text-white hover:bg-[#4A2475] disabled:opacity-50"
            >
              <Shield size={14} /> {acting === 'cosign' ? 'Co-signing…' : findings.length ? 'Co-sign anyway' : 'Co-sign with checklist'}
            </button>
            <span className="self-center text-[11px] text-slate-500">The comment above and these findings are recorded.</span>
          </div>
        )}
        {actionMsg && <p className="pb-2 text-xs font-medium text-slate-700">{actionMsg}</p>}
      </div>
    </section>
  );
}
