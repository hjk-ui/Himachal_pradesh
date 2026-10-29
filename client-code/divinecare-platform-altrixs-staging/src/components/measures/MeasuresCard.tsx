'use client';

/**
 * Chart Measures card: per measure the latest score, change since last, trend sparkline, how it was
 * given (in clinic / patient link / "Paper — entered by <staff>") and the status of pending sends.
 * Actions: "Send measure" (pick measures; email / text link or patient portal), "Send now" (due
 * scheduled measures), "Upload paper measure", "Give in session", "Measure guide", and per measure
 * "How to read" (guide entry next to the score) and "Print" (results summary, audited).
 * "Mark reviewed" clears the inbox "Measures completed" / "Worsening" items.
 * GET /api/clinical/measure-requests.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, BookOpen, ClipboardList, FileText, Info, Minus, Printer, Send, TrendingDown, TrendingUp, Upload } from 'lucide-react';
import { Card, cx } from '@/components/ui';
import { useAuth } from '@/features/auth';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { measureGuideEntry } from '@/lib/measures/guide';
import { SendStatusBadge, TrendSparkline, giveInSessionHref, sendMeasuresNow } from './shared';
import { SendMeasureModal } from './SendMeasureModal';
import { PaperMeasureModal } from './PaperMeasureModal';
import { MeasureGuidePanel } from './MeasureGuidePanel';

type Point = { id: string; score: number | null; severity: string | null; date: string; source: string | null; safetyFlagged: boolean; how?: string; scanUrl?: string | null };
type Summary = {
  instrumentId: string;
  measure: string;
  maxScore: number | null;
  latest: Point;
  previous: Point | null;
  change: number | null;
  worsening: boolean;
  safetyItem: { item: string; score: number | null } | null;
  series: Point[];
};
type Req = { id: string; status: string; instrumentIds: string[]; sentAt: string | null; completedAt: string | null; reviewedAt: string | null; notSentReason: string | null };
type Assignment = { id: string; instrumentId: string; measure: string; sendable: boolean; status: string };
type Data = { summaries: Summary[]; requests: Req[]; pendingCount: number; unreviewedRequestIds: string[]; assignments: Assignment[] };

const md = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });

export function MeasuresCard({ clientId }: { clientId: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<'send' | 'paper' | null>(null);
  const [infoFor, setInfoFor] = useState<string | null>(null);
  const { user } = useAuth();
  // Paper entry: the roles that enter assessments (EHR > Assessments); the route re-checks
  const canEnterPaper = useMemo(() => canAccessPath(user?.role, '/dashboard/ehr/assessments'), [user?.role]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/clinical/measure-requests?clientId=${encodeURIComponent(clientId)}`, { cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) {
        setError(res.status === 403 ? null : body.error || `Could not load measures (${res.status})`);
        if (res.status === 403) setData(null);
        return;
      }
      setData(body);
      setError(null);
    } catch {
      setError('Could not load measures (network error)');
    }
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!data && !error) return null;

  const due = (data?.assignments ?? []).filter((a) => a.sendable && a.status === 'active');
  const pending = (data?.requests ?? []).filter((r) => ['Sent', 'Opened', 'Started', 'Not sent', 'Locked'].includes(r.status)).slice(0, 3);
  const nameOf = (id: string) => data?.summaries.find((s) => s.instrumentId === id)?.measure ?? data?.assignments.find((a) => a.instrumentId === id)?.measure ?? id.toUpperCase();

  async function sendNow() {
    if (!due.length) return;
    setBusy(true);
    const r = await sendMeasuresNow(clientId, due.map((a) => a.instrumentId), due.map((a) => a.id));
    setMsg({ ok: r.sent, text: r.message });
    setBusy(false);
    void load();
  }

  async function markReviewed() {
    setBusy(true);
    await fetch('/api/clinical/measure-requests', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId }) }).catch(() => undefined);
    setBusy(false);
    void load();
  }

  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-slate-900">Measures</h3>
          <p className="text-xs text-slate-500">Latest scores (in clinic or completed by the patient from a link) and pending questionnaires</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data?.unreviewedRequestIds.length ? (
            <button type="button" disabled={busy} onClick={() => void markReviewed()} className="rounded-lg border border-emerald-300 px-2.5 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-50">
              Mark reviewed ({data.unreviewedRequestIds.length})
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setModal('send')}
            className="inline-flex items-center gap-1 rounded-lg border border-blue-300 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-800 hover:bg-blue-100"
          >
            <Send className="h-3.5 w-3.5" aria-hidden /> Send measure
          </button>
          {canEnterPaper ? (
            <button
              type="button"
              onClick={() => setModal('paper')}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <Upload className="h-3.5 w-3.5" aria-hidden /> Upload paper measure
            </button>
          ) : null}
          {due.length ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void sendNow()}
              title={`Email / text a link for ${due.map((a) => a.measure).join(', ')} (consent, date of birth and Part 2 are checked)`}
              className="inline-flex items-center gap-1 rounded-lg border border-blue-200 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" aria-hidden /> Send now
            </button>
          ) : null}
          <Link
            href={giveInSessionHref(clientId, data?.summaries[0]?.measure ?? 'PHQ-9')}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <ClipboardList className="h-3.5 w-3.5" aria-hidden /> Give in session
          </Link>
          <Link
            href="/dashboard/mbc/guide"
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <BookOpen className="h-3.5 w-3.5" aria-hidden /> Measure guide
          </Link>
        </div>
      </div>
      {modal === 'send' ? (
        <SendMeasureModal
          clientId={clientId}
          onClose={() => setModal(null)}
          onSent={(text, ok) => {
            setMsg({ ok, text });
            void load();
          }}
        />
      ) : null}
      {modal === 'paper' ? (
        <PaperMeasureModal
          clientId={clientId}
          onClose={() => setModal(null)}
          onSaved={(text, ok) => {
            setMsg({ ok, text });
            void load();
          }}
        />
      ) : null}
      {error ? <p className="text-xs text-rose-700">{error}</p> : null}
      {msg ? <p className={cx('mb-2 text-xs', msg.ok ? 'text-emerald-700' : 'text-rose-700')}>{msg.text}</p> : null}
      {data && !data.summaries.length ? <p className="text-xs text-slate-500">No measures on file yet.</p> : null}
      {data?.summaries.length ? (
        <ul className="divide-y divide-slate-100">
          {data.summaries.slice(0, 8).map((s) => {
            const scores = s.series.map((p) => p.score).filter((n): n is number => n != null);
            const tone = s.worsening ? 'danger' : s.change != null && s.change < 0 ? 'success' : 'neutral';
            const guide = measureGuideEntry(s.instrumentId);
            const open = infoFor === s.instrumentId;
            return (
              <li key={s.instrumentId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900">
                    {s.measure} <span className="tabular-nums">{s.latest.score ?? '—'}</span>
                    {s.maxScore != null ? <span className="text-xs font-normal text-slate-500"> / {s.maxScore}</span> : null}
                    {s.latest.severity ? <span className="ml-1 text-xs font-normal text-slate-600">({s.latest.severity})</span> : null}
                    {guide ? (
                      <button
                        type="button"
                        onClick={() => setInfoFor(open ? null : s.instrumentId)}
                        aria-expanded={open}
                        aria-label={`How to read ${s.measure}`}
                        title="How to read this score"
                        className="ml-1 inline-flex items-center rounded p-0.5 align-middle text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                      >
                        <Info className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    ) : null}
                  </div>
                  <div className="text-xs text-slate-500">
                    {md(s.latest.date)} · {s.latest.how ?? (s.latest.source === 'patient_portal' ? 'Patient link' : 'In clinic')}
                    {s.latest.scanUrl ? (
                      <a href={s.latest.scanUrl} target="_blank" rel="noreferrer" className="ml-1 inline-flex items-center gap-0.5 font-semibold text-blue-700 hover:underline">
                        <FileText className="inline h-3 w-3" aria-hidden /> scan
                      </a>
                    ) : null}
                    {s.change != null ? (
                      <span className={cx('ml-1', s.change > 0 ? 'text-rose-700' : s.change < 0 ? 'text-emerald-700' : '')}>
                        {s.change > 0 ? <TrendingUp className="inline h-3 w-3" aria-hidden /> : s.change < 0 ? <TrendingDown className="inline h-3 w-3" aria-hidden /> : <Minus className="inline h-3 w-3" aria-hidden />}
                        {s.change > 0 ? '+' : ''}
                        {s.change} since {s.previous ? md(s.previous.date) : 'last'}
                      </span>
                    ) : null}
                    {s.safetyItem && s.safetyItem.score != null ? <span className={cx('ml-1', s.safetyItem.score > 0 ? 'font-semibold text-rose-700' : '')}>· item {s.safetyItem.item} = {s.safetyItem.score}</span> : null}
                  </div>
                  {s.worsening || s.latest.safetyFlagged ? (
                    <div className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-rose-700">
                      <AlertTriangle className="h-3 w-3" aria-hidden /> {s.latest.safetyFlagged ? 'Safety item endorsed' : 'Worsening'}
                    </div>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <TrendSparkline scores={scores} tone={tone} width={96} height={32} />
                  <Link
                    href={`/dashboard/mbc/print?clientId=${encodeURIComponent(clientId)}&instrumentId=${encodeURIComponent(s.instrumentId)}`}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    title={`Print ${s.measure} results (score, severity, trend)`}
                  >
                    <Printer className="h-3.5 w-3.5" aria-hidden /> Print
                  </Link>
                </div>
                {open && guide ? (
                  <div className="w-full rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <MeasureGuidePanel entry={guide} score={s.latest.score} compact />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {pending.length ? (
        <div className="mt-3 border-t border-slate-100 pt-2">
          <div className="mb-1 text-xs font-semibold text-slate-600">Questionnaires sent to the patient</div>
          <ul className="space-y-1">
            {pending.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                <SendStatusBadge status={r.status} title={r.notSentReason ?? undefined} />
                <span>{r.instrumentIds.map(nameOf).join(', ')}</span>
                {r.sentAt ? <span className="text-slate-400">sent {md(r.sentAt)}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}
