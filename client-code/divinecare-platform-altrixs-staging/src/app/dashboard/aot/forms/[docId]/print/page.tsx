'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ArrowLeft, Printer } from 'lucide-react';
import FormDocument, { type PrintableDocument } from '@/components/aot/forms/FormDocument';
import { getDefinition } from '@/lib/aot/forms';

/**
 * Print / save-as-PDF view of an MDH AOT form. Loading it is audited as PRINT. The dashboard chrome is
 * hidden by the global @media print rules (aside, header, nav, [data-print-hide]).
 */
export default function AotFormPrintPage() {
  const params = useParams<{ docId: string }>();
  const docId = String(params?.docId ?? '');
  const [doc, setDoc] = useState<(PrintableDocument & { id: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!docId) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/aot/documents/${encodeURIComponent(docId)}?purpose=print`);
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) throw new Error(json?.error || `Could not load the form (${res.status})`);
        if (alive) setDoc({ ...json.document, id: json.document.id });
      } catch (err: unknown) {
        if (alive) setError(err instanceof Error ? err.message : 'Could not load the form');
      }
    })();
    return () => {
      alive = false;
    };
  }, [docId]);

  const def = doc ? getDefinition(doc.formType) : null;

  return (
    <div className="max-w-4xl mx-auto">
      <style>{`@media print { @page { size: letter; margin: 0.6in; } .aot-print-sheet { box-shadow: none !important; border: 0 !important; padding: 0 !important; } }`}</style>
      <div data-print-hide className="flex flex-wrap items-center gap-3 mb-4">
        <a href={`/dashboard/aot/forms/${docId}`} className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-brand-700">
          <ArrowLeft className="h-4 w-4" /> Back to the form
        </a>
        <button
          onClick={() => window.print()}
          disabled={!doc}
          className="ml-auto inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-40"
        >
          <Printer className="h-4 w-4" /> Print / Save as PDF
        </button>
      </div>
      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
      {!error && !doc && <p className="text-sm text-gray-500">Loading…</p>}
      {doc && def && (
        <div className="aot-print-sheet bg-white border border-gray-200 shadow-sm p-4 text-black sm:p-8 print:p-8">
          <FormDocument def={def} doc={doc} />
        </div>
      )}
    </div>
  );
}
