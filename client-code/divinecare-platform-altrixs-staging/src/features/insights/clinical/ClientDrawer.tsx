'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { Bot, ExternalLink, Info, Loader2, RefreshCw, Sparkles, X } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { IconButton, buttonClasses, Alert } from '@/components/ui';
import type { InsightRow } from '@/lib/insights/clinical/population';
import type { TimelineEvent } from '@/lib/insights/clinical/timeline';
import { CATEGORY_LABEL, SIGNAL_CATEGORIES, TIER_LABEL, type Signal, type Tier, type Trajectory } from '@/lib/insights/clinical/types';
import { SignalChip, TierBadge, fmtDay } from './ui';

type Detail = {
  evaluatedAt: string;
  today: string;
  row: InsightRow;
  tier: Tier;
  rules: { id: string; tier: string; text: string }[];
  signals: Signal[];
  trajectories: Trajectory[];
  dataGaps: string[];
  timeline: TimelineEvent[];
  suggestions: { id: string; label: string; because: string[] }[];
  summary: { lastVisit: string | null; nextAppointment: string | null; safetyPlan: boolean; programs: string[] };
};

type Fact = { id: string; text: string };
type SnapshotResult =
  | { status: 'ok'; sentences: { text: string; cites: string[] }[]; actions: { id: string; label: string; cites: string[] }[]; facts: Fact[]; model: string; generatedAt: string; cached: boolean }
  | { status: 'unavailable' | 'rejected'; reason: string; message: string; facts: Fact[] };

const signedNum = (n: number | null) => (n == null ? '—' : n > 0 ? `+${n}` : String(n));

export function ClientDrawer({ clientId, onClose }: { clientId: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ai, setAi] = useState<{ label: string; result: SnapshotResult } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  useEffect(() => {
    const el = dialog.current;
    el?.showModal();
    return () => el?.close();
  }, []);

  useEffect(() => {
    let live = true;
    setDetail(null);
    setError(null);
    setAi(null);
    apiJson<{ success: true } & Detail>(`/api/insights/clinical/${encodeURIComponent(clientId)}`)
      .then((d) => live && setDetail(d))
      .catch((e) => live && setError(e instanceof Error ? e.message : 'Could not load this client'));
    return () => {
      live = false;
    };
  }, [clientId]);

  async function runSnapshot(refresh = false) {
    setAiBusy(true);
    setAiError(null);
    try {
      const r = await apiJson<{ success: true; label: string; result: SnapshotResult }>(`/api/insights/clinical/${encodeURIComponent(clientId)}/ai-snapshot`, {
        method: 'POST',
        body: JSON.stringify({ refresh }),
      });
      setAi({ label: r.label, result: r.result });
    } catch (e) {
      setAiError(e instanceof Error ? e.message : 'AI unavailable');
    } finally {
      setAiBusy(false);
    }
  }

  const name = detail?.row.name ?? 'Client';
  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="fixed inset-y-0 right-0 m-0 ml-auto h-full max-h-full w-full max-w-2xl overflow-y-auto border-l border-slate-200 bg-white p-0 shadow-2xl backdrop:bg-slate-900/30"
    >
      <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4">
        <div className="min-w-0">
          <h2 id={titleId} className="truncate text-lg font-semibold text-slate-900">{name}</h2>
          <p className="text-xs text-slate-500">
            {detail ? <>MRN {detail.row.mrn ?? '—'} · {detail.row.clinician?.name ?? 'No assigned clinician'} · {detail.row.location?.name ?? 'No location'} · evaluated live {fmtDay(detail.today)}</> : 'Loading…'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {detail ? (
            <Link href={`/dashboard/clients/${clientId}`} className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
              Open chart <ExternalLink size={12} aria-hidden />
            </Link>
          ) : null}
          <IconButton label="Close" icon={<X size={18} />} onClick={onClose} className="h-10 w-10 shrink-0 md:h-8 md:w-8 text-slate-500 hover:bg-slate-100" />
        </div>
      </div>

      <div className="space-y-6 px-5 py-5">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {!detail && !error ? (
          <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" aria-hidden /> Loading signals…</p>
        ) : null}

        {detail ? (
          <>
            <section aria-label="Priority">
              <div className="flex flex-wrap items-center gap-2">
                <TierBadge tier={detail.tier} />
                <span className="text-xs text-slate-500">Rule-based priority — not a prediction.</span>
              </div>
              {detail.rules.length ? (
                <ul className="mt-2 space-y-1 text-sm text-slate-700">
                  {detail.rules.map((r) => (
                    <li key={r.id}><span className="mr-1 font-mono text-xs text-slate-500">{r.id}</span>{r.text} <span className="text-xs text-slate-500">({TIER_LABEL[r.tier as Tier] ?? r.tier})</span></li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-slate-600">No tier rule fired in the data on file.</p>
              )}
            </section>

            <section aria-labelledby={`${titleId}-ai`} className="rounded-xl border border-blue-600/20 bg-blue-600/5 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 id={`${titleId}-ai`} className="flex items-center gap-1.5 text-sm font-semibold text-blue-600"><Sparkles size={15} aria-hidden /> AI clinical snapshot</h3>
                <div className="flex gap-2">
                  <button type="button" onClick={() => void runSnapshot(false)} disabled={aiBusy} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
                    {aiBusy ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Bot size={13} aria-hidden />} {ai ? 'Show again' : 'Summarize'}
                  </button>
                  {ai?.result.status === 'ok' ? (
                    <IconButton label="Regenerate (skip cache)" icon={<RefreshCw size={14} />} onClick={() => void runSnapshot(true)} disabled={aiBusy} className="h-10 w-10 border border-blue-600/30 md:h-7 md:w-7 text-blue-600 hover:bg-white" />
                  ) : null}
                </div>
              </div>
              <p className="mt-1 text-xs text-slate-600">On demand. Uses only the numbered facts below — no names, no note text. Labeled decision support; the clinician decides.</p>
              {aiError ? <p role="alert" className="mt-2 text-sm text-rose-700">{aiError}</p> : null}
              {ai ? (
                <div className="mt-3 space-y-3" aria-live="polite">
                  {ai.result.status === 'ok' ? (
                    <>
                      <p className="text-[11px] font-medium uppercase tracking-wide text-blue-600">{ai.label}</p>
                      <div className="space-y-1.5 text-sm text-slate-800">
                        {ai.result.sentences.map((s, i) => (
                          <p key={i}>{s.text} <span className="text-[11px] text-slate-500">[{s.cites.join(', ')}]</span></p>
                        ))}
                      </div>
                      {ai.result.actions.length ? (
                        <div>
                          <p className="text-xs font-semibold text-slate-700">Suggested next actions (AI, from the fixed list)</p>
                          <ul className="mt-1 list-disc pl-5 text-sm text-slate-700">
                            {ai.result.actions.map((a) => <li key={a.id}>{a.label} <span className="text-[11px] text-slate-500">[{a.cites.join(', ')}]</span></li>)}
                          </ul>
                        </div>
                      ) : null}
                      <p className="text-[11px] text-slate-500">{ai.result.model} · {ai.result.cached ? 'cached' : 'generated'} {new Date(ai.result.generatedAt).toLocaleString('en-US')}</p>
                    </>
                  ) : (
                    <p className="flex items-start gap-1.5 rounded-lg bg-white px-3 py-2 text-sm text-slate-700"><Info size={14} className="mt-0.5 shrink-0 text-slate-500" aria-hidden /> {ai.result.message}</p>
                  )}
                  {ai.result.facts.length ? (
                    <details className="text-xs text-slate-600">
                      <summary className="cursor-pointer select-none font-medium">Numbered facts sent to the model ({ai.result.facts.length})</summary>
                      <ol className="mt-1 space-y-0.5">
                        {ai.result.facts.map((f) => <li key={f.id}><span className="font-mono text-slate-500">{f.id}</span> {f.text}</li>)}
                      </ol>
                    </details>
                  ) : null}
                </div>
              ) : null}
              {(!ai || ai.result.status !== 'ok') && detail.suggestions.length ? (
                <div className="mt-3">
                  <p className="text-xs font-semibold text-slate-700">Rule-based suggestions</p>
                  <ul className="mt-1 list-disc pl-5 text-sm text-slate-700">
                    {detail.suggestions.map((s) => <li key={s.id}>{s.label} <span className="text-[11px] text-slate-500">(from {s.because.join(', ').replace(/_/g, ' ')})</span></li>)}
                  </ul>
                </div>
              ) : null}
            </section>

            <section aria-labelledby={`${titleId}-sig`}>
              <h3 id={`${titleId}-sig`} className="text-sm font-semibold text-slate-800">Signals</h3>
              {detail.signals.length === 0 ? <p className="mt-1 text-sm text-slate-600">No signals in the data on file.</p> : null}
              {SIGNAL_CATEGORIES.map((cat) => {
                const list = detail.signals.filter((s) => s.category === cat);
                if (!list.length) return null;
                return (
                  <div key={cat} className="mt-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{CATEGORY_LABEL[cat]}</p>
                    <ul className="mt-1 space-y-1.5">
                      {list.map((s, i) => (
                        <li key={`${s.key}-${i}`} className="flex flex-wrap items-start gap-2 text-sm text-slate-700">
                          <SignalChip signal={s} />
                          <span>{s.detail}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </section>

            <section aria-labelledby={`${titleId}-traj`}>
              <h3 id={`${titleId}-traj`} className="text-sm font-semibold text-slate-800">Symptom trajectory</h3>
              {detail.trajectories.length === 0 ? (
                <p className="mt-1 text-sm text-slate-600">— No PHQ-9, GAD-7 or PCL-5 scores in the last 12 months.</p>
              ) : (
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full min-w-[560px] text-left text-sm">
                    <thead className="text-xs text-slate-500">
                      <tr><th scope="col" className="py-1 pr-3 font-medium">Measure</th><th scope="col" className="py-1 pr-3 font-medium">Latest</th><th scope="col" className="py-1 pr-3 font-medium">Prior</th><th scope="col" className="py-1 pr-3 font-medium">Baseline</th><th scope="col" className="py-1 pr-3 font-medium">Change</th><th scope="col" className="py-1 font-medium">Status</th></tr>
                    </thead>
                    <tbody>
                      {detail.trajectories.map((t) => (
                        <tr key={t.instrument} className="border-t border-slate-100 align-top">
                          <td className="py-1.5 pr-3 font-medium text-slate-800">{t.label}<span className="block text-[11px] font-normal text-slate-500">reliable change ≥ {t.threshold}</span></td>
                          <td className="py-1.5 pr-3">{t.latest.score}<span className="block text-[11px] text-slate-500">{t.latest.date}</span></td>
                          <td className="py-1.5 pr-3">{t.prior ? <>{t.prior.score}<span className="block text-[11px] text-slate-500">{t.prior.date}</span></> : <span className="text-slate-500">— one score</span>}</td>
                          <td className="py-1.5 pr-3">{t.baseline ? <>{t.baseline.score}<span className="block text-[11px] text-slate-500">{t.baseline.date}</span></> : <span className="text-slate-500">—</span>}</td>
                          <td className="py-1.5 pr-3">{signedNum(t.changeVsBaseline)} vs baseline<span className="block text-[11px] text-slate-500">{signedNum(t.changeVsPrior)} vs prior</span></td>
                          <td className="py-1.5">{t.status.replace('_', ' ')}{t.stale ? <span className="block text-[11px] text-amber-700">latest over 90 days old</span> : null}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {detail.dataGaps.length ? (
              <section aria-labelledby={`${titleId}-gaps`}>
                <h3 id={`${titleId}-gaps`} className="text-sm font-semibold text-slate-800">Missing from the chart</h3>
                <ul className="mt-1 list-disc pl-5 text-sm text-slate-600">
                  {detail.dataGaps.map((g) => <li key={g}>{g}</li>)}
                </ul>
              </section>
            ) : null}

            <section aria-labelledby={`${titleId}-tl`}>
              <h3 id={`${titleId}-tl`} className="text-sm font-semibold text-slate-800">Timeline</h3>
              {detail.timeline.length === 0 ? (
                <p className="mt-1 text-sm text-slate-600">— No dated events on file.</p>
              ) : (
                <ol className="mt-2 space-y-1 border-l border-slate-200 pl-4">
                  {detail.timeline.map((e, i) => (
                    <li key={`${e.date}-${i}`} className="text-sm text-slate-700">
                      <span className="mr-2 inline-block w-24 font-mono text-xs text-slate-500">{e.date}</span>{e.text}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </>
        ) : null}
      </div>
    </dialog>
  );
}
