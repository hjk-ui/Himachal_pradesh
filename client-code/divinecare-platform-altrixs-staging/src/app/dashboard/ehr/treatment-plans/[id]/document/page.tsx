'use client';

/**
 * Treatment plan document: print / save as PDF (browser print). The layout follows the practice's
 * Valant Treatment Plan template; a signed plan shows the document frozen at signing.
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ArrowLeft, Printer } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { smallBtn } from '@/components/notes/structuredNoteUi';
import { TreatmentPlanDocumentView } from '@/components/therapy/TreatmentPlanDocument';
import type { PlanDocument, SignatureBlock } from '@/lib/ehr/therapy/planDocument';
import { Alert } from '@/components/ui';

type View = {
  planId: string;
  clientId: string;
  title: string;
  status: string;
  frozen: boolean;
  document: PlanDocument | null;
  signedText: string | null;
  signatures: SignatureBlock[];
};

export default function TreatmentPlanDocumentPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id || '';
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!id) return;
    apiJson<{ success: true; view: View }>(`/api/ehr/treatment-plans/${encodeURIComponent(id)}/document`)
      .then((res) => setView(res.view))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load the plan document'));
  }, [id]);

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!view) return <p className="text-sm text-slate-500">Loading…</p>;
  return (
    <div className="mx-auto max-w-4xl space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link
          href={`/dashboard/ehr/treatment-plans/therapy?clientId=${encodeURIComponent(view.clientId)}&planId=${encodeURIComponent(view.planId)}`}
          className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline"
        >
          <ArrowLeft size={12} /> Back to the plan
        </Link>
        <button type="button" className={smallBtn} onClick={() => window.print()}>
          <Printer size={12} /> Print / save as PDF
        </button>
      </div>
      <TreatmentPlanDocumentView document={view.document} signatures={view.signatures} signedText={view.signedText} draft={!view.frozen && !view.signedText} />
    </div>
  );
}
