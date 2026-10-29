'use client';

/**
 * Print a BLANK measure form (Measure guide > Print blank form). Only free-to-reproduce instruments
 * with their items in the catalog (the API refuses licensed / permission-only forms). Header lines
 * for the patient to fill in on paper; no patient data comes from Altrixs. Audited
 * MEASURE_BLANK_PRINT. Completed forms go back in through the chart: Upload paper measure.
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ArrowLeft, Printer } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import type { BlankForm } from '@/lib/measures/printView';
import { Alert, LoadingState, buttonClasses } from '@/components/ui';

export default function BlankMeasurePrintPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ? decodeURIComponent(params.id) : '';
  const [form, setForm] = useState<BlankForm | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    apiJson<{ success: true; form: BlankForm }>(`/api/clinical/measure-results/blank-form?instrumentId=${encodeURIComponent(id)}`)
      .then((r) => setForm(r.form))
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the form'));
  }, [id]);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <style>{`@media print { body * { visibility: hidden !important; } #measure-print, #measure-print * { visibility: visible !important; } #measure-print { position: absolute; left: 0; top: 0; width: 100%; padding: 0 12mm; } #measure-print li { break-inside: avoid; } }`}</style>
      <div className="flex flex-wrap items-center justify-between gap-2" data-print-hide>
        <Link href={`/dashboard/mbc/guide#${encodeURIComponent(id)}`} className="inline-flex items-center gap-1 rounded text-sm font-semibold text-slate-600 hover:text-slate-900">
          <ArrowLeft size={14} aria-hidden /> Measure guide
        </Link>
        <button type="button" onClick={() => window.print()} disabled={!form} className={buttonClasses({ variant: 'primary' })}>
          <Printer size={14} aria-hidden /> Print / Save as PDF
        </button>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {!form && !error ? <LoadingState label="Loading form…" /> : null}
      {form ? (
        <article id="measure-print" className="rounded-xl border border-slate-200 bg-white p-4 text-slate-900 sm:p-6 print:border-0">
          <h1 className="text-lg font-semibold">
            {form.name} — {form.fullName}
          </h1>
          <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
            {['Name', 'Date of birth', 'Date'].map((l) => (
              <div key={l} className="flex items-end gap-2">
                <span className="font-semibold text-slate-600">{l}:</span>
                <span className="min-w-0 flex-1 border-b border-slate-400">&nbsp;</span>
              </div>
            ))}
          </div>
          {form.instructions ? <p className="mt-4 text-sm font-medium">{form.instructions}</p> : null}
          <ol className="mt-3 space-y-3">
            {form.items.map((q) => (
              <li key={q.n} className="text-sm">
                <div>
                  <span className="font-semibold">{q.n}.</span> {q.text}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 pl-4">
                  {q.options.map((o) => (
                    <span key={`${q.n}-${o.label}`} className="inline-flex items-center gap-1.5">
                      <span className="inline-block h-3.5 w-3.5 rounded-sm border border-slate-500" aria-hidden />
                      {o.label}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ol>
          <footer className="mt-5 border-t border-slate-300 pt-2 text-xs text-slate-600">
            <p>Source: {form.citation}. Reproduced for clinical use.</p>
            <p>Office use: enter in Altrixs from the client chart, Assessments &amp; outcomes, Upload paper measure.</p>
          </footer>
        </article>
      ) : null}
    </div>
  );
}
