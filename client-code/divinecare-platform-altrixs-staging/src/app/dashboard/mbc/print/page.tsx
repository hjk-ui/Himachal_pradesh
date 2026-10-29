'use client';

/**
 * Print a client's results for one measure (chart Assessments & outcomes > Print on a measure):
 * minimum PHI header (name, date of birth, MRN), every score with severity and how it was given,
 * change from baseline, the latest item responses, and the guide entry (same source as the
 * scoring). Opening this page is audited (MEASURE_PRINT).
 */
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, Printer } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import type { MeasurePrint } from '@/lib/measures/printView';
import { Alert, LoadingState, buttonClasses } from '@/components/ui';
import { MeasureGuidePanel } from '@/components/measures/MeasureGuidePanel';
import { TrendSparkline } from '@/components/measures/shared';

const day = (iso: string) => iso.slice(0, 10);

function MeasureResultsPrint() {
  const sp = useSearchParams();
  const clientId = sp?.get('clientId') ?? '';
  const instrumentId = sp?.get('instrumentId') ?? '';
  const [data, setData] = useState<MeasurePrint | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!clientId || !instrumentId) {
      setError('Open Print from a measure on the client chart.');
      return;
    }
    apiJson<{ success: true; printable: MeasurePrint }>(
      `/api/clinical/measure-results/print?clientId=${encodeURIComponent(clientId)}&instrumentId=${encodeURIComponent(instrumentId)}`,
    )
      .then((r) => setData(r.printable))
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the results'));
  }, [clientId, instrumentId]);

  const s = data?.summary;
  const scores = data?.points.map((p) => p.score).filter((n): n is number => n != null) ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <style>{`@media print { body * { visibility: hidden !important; } #measure-print, #measure-print * { visibility: visible !important; } #measure-print { position: absolute; left: 0; top: 0; width: 100%; padding: 0 12mm; } #measure-print details > *:not(summary) { display: block !important; } #measure-print [data-print-hide] { display: none !important; } }`}</style>
      <div className="flex flex-wrap items-center justify-between gap-2" data-print-hide>
        <Link href={clientId ? `/dashboard/clients/${encodeURIComponent(clientId)}?tab=assessments` : '/dashboard/clients'} className="inline-flex items-center gap-1 rounded text-sm font-semibold text-slate-600 hover:text-slate-900">
          <ArrowLeft size={14} aria-hidden /> Chart
        </Link>
        <button type="button" onClick={() => window.print()} disabled={!data} className={buttonClasses({ variant: 'primary' })}>
          <Printer size={14} aria-hidden /> Print / Save as PDF
        </button>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {!data && !error ? <LoadingState label="Loading results…" /> : null}
      {data ? (
        <article id="measure-print" className="rounded-xl border border-slate-200 bg-white p-4 text-slate-900 sm:p-6 print:border-0">
          <h1 className="text-lg font-semibold">{data.title}</h1>
          <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {data.header.map((h) => (
              <div key={h.label} className="flex gap-2">
                <dt className="font-semibold text-slate-600">{h.label}:</dt>
                <dd className="min-w-0 break-words">{h.value}</dd>
              </div>
            ))}
          </dl>

          {s?.latest ? (
            <section className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3">
              <div className="text-sm">
                <div>
                  <span className="font-semibold">Latest:</span> {s.latest.score} {s.latest.severity ? `(${s.latest.severity})` : ''} on {day(s.latest.date)}
                </div>
                {s.baseline && s.change != null ? (
                  <div>
                    <span className="font-semibold">Since baseline</span> ({s.baseline.score} on {day(s.baseline.date)}): {s.change > 0 ? '+' : ''}
                    {s.change}
                    {s.percentChange != null ? ` (${s.percentChange > 0 ? '+' : ''}${s.percentChange}%)` : ''}
                  </div>
                ) : null}
              </div>
              <TrendSparkline scores={scores} tone="brand" width={160} height={44} />
            </section>
          ) : (
            <p className="mt-4 text-sm text-slate-600">No scores on file for this measure.</p>
          )}

          {data.points.length ? (
            <section className="mt-4">
              <h2 className="text-xs font-bold uppercase tracking-wide text-slate-600">Scores</h2>
              <div className="mt-1 overflow-x-auto">
                <table className="w-full min-w-[420px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-300 text-xs text-slate-600">
                      <th className="py-1 pr-2">Date</th>
                      <th className="py-1 pr-2">Score</th>
                      <th className="py-1 pr-2">Severity</th>
                      <th className="py-1">How given</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.points.map((p) => (
                      <tr key={p.id} className="border-b border-slate-100">
                        <td className="py-1 pr-2 tabular-nums">{day(p.date)}</td>
                        <td className="py-1 pr-2 tabular-nums">
                          {p.score ?? '—'}
                          {p.safetyFlagged ? ' (safety flag)' : ''}
                        </td>
                        <td className="py-1 pr-2">{p.severity ?? '—'}</td>
                        <td className="py-1">{p.how}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {data.latestItems.length ? (
            <section className="mt-4">
              <h2 className="text-xs font-bold uppercase tracking-wide text-slate-600">Latest item responses</h2>
              <ol className="mt-1 space-y-0.5 text-sm">
                {data.latestItems.map((it, idx) => (
                  <li key={it.itemId} className={it.flagged ? 'font-semibold text-rose-800' : ''}>
                    {idx + 1}. {it.questionText}: {it.selectedText ?? it.scoreValue} ({it.scoreValue})
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          {data.guide ? (
            <section className="mt-4 border-t border-slate-200 pt-3">
              <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-600">How to read this measure</h2>
              <MeasureGuidePanel entry={data.guide} score={s?.latest?.score ?? null} compact />
            </section>
          ) : null}

          <footer className="mt-5 space-y-0.5 border-t border-slate-300 pt-2 text-xs text-slate-600">
            {data.footer.map((l) => (
              <p key={l}>{l}</p>
            ))}
          </footer>
        </article>
      ) : null}
    </div>
  );
}

export default function MeasureResultsPrintPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading results…" />}>
      <MeasureResultsPrint />
    </Suspense>
  );
}
