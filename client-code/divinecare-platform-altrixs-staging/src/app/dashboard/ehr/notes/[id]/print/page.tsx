'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ArrowLeft, Printer } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import type { PrintableNote } from '@/lib/notes/standard';
import { Alert, LoadingState, buttonClasses } from '@/components/ui';

/**
 * Print / Save as PDF view of a signed progress note: header, sections exactly as signed,
 * addenda, signature block with credentials and times. Psychotherapy notes are never included.
 * Opening this page is audited (NOTE_PRINT).
 */
export default function PrintNotePage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [note, setNote] = useState<PrintableNote | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    apiJson<{ success: true; printable: PrintableNote }>(`/api/notes/${encodeURIComponent(id)}/print`)
      .then((r) => setNote(r.printable))
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the note'));
  }, [id]);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <style>{`@media print { body * { visibility: hidden !important; } #note-print, #note-print * { visibility: visible !important; } #note-print { position: absolute; left: 0; top: 0; width: 100%; padding: 0 12mm; } }`}</style>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href="/dashboard/ehr/notes" className="inline-flex items-center gap-1 rounded text-sm font-semibold text-slate-600 hover:text-slate-900">
          <ArrowLeft size={14} aria-hidden /> Notes
        </Link>
        <button
          type="button"
          onClick={() => window.print()}
          disabled={!note}
          className={buttonClasses({ variant: 'primary' })}
        >
          <Printer size={14} aria-hidden /> Print / Save as PDF
        </button>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {!note && !error ? <LoadingState label="Loading note…" /> : null}
      {note ? (
        <article id="note-print" className="rounded-xl border border-slate-200 bg-white p-6 text-slate-900 print:border-0">
          <h1 className="text-lg font-semibold">{note.title}</h1>
          <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {note.header.map((h) => (
              <div key={h.label} className="flex gap-2">
                <dt className="font-semibold text-slate-600">{h.label}:</dt>
                <dd>{h.value}</dd>
              </div>
            ))}
          </dl>
          {note.banners.length ? (
            <div className="mt-3 space-y-1">
              {note.banners.map((b) => (
                <p key={b} className="rounded border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-semibold">
                  {b}
                </p>
              ))}
            </div>
          ) : null}
          <div className="mt-4 space-y-3">
            {note.sections.map((s, i) => (
              <section key={`${s.title}-${i}`}>
                <h2 className="text-xs font-bold uppercase tracking-wide text-slate-600">{s.title}</h2>
                <p className="mt-0.5 whitespace-pre-wrap text-sm leading-6">{s.text}</p>
              </section>
            ))}
          </div>
          {note.addenda.length ? (
            <div className="mt-4 space-y-2 border-t border-slate-200 pt-3">
              {note.addenda.map((a, i) => (
                <section key={i}>
                  <h2 className="text-xs font-bold text-slate-700">{a.heading}</h2>
                  <p className="mt-0.5 whitespace-pre-wrap text-sm leading-6">{a.text}</p>
                </section>
              ))}
            </div>
          ) : null}
          <footer className="mt-5 space-y-1 border-t border-slate-300 pt-3 text-xs text-slate-700">
            {note.signature.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </footer>
        </article>
      ) : null}
    </div>
  );
}
