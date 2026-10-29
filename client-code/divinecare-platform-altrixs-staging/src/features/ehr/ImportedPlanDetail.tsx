'use client';

/**
 * Body of the plan view for a plan imported from Valant: Valant's dates and the rewrite action,
 * the client's diagnoses from the chart (labeled: Valant's plan grid has none), and the Valant
 * plan document when one was filed through Smart Doc Intake, so clinicians can read the goals.
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ExternalLink, FileText } from 'lucide-react';
import { ImportedPlanNotice } from '@/features/ehr/ImportedPlanNotice';
import { fetchImportedPlanContext, type ImportedPlanContext } from '@/features/ehr/treatmentPlansApi';
import { CHART_DX_LABEL } from '@/lib/ehr/importedPlans';
import type { ImportedPlanSource } from '@/lib/migration/valantTreatmentPlans';

export function ImportedPlanDetail({
  plan,
  preview = false,
}: {
  plan: { id: string; clientId: string; reviewDueAt: string | null; status: string; source: ImportedPlanSource };
  /** Demo data: no server calls */
  preview?: boolean;
}) {
  const [ctx, setCtx] = useState<ImportedPlanContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (preview) return;
    let live = true;
    fetchImportedPlanContext(plan.id)
      .then((c) => live && setCtx(c))
      .catch((err: unknown) => live && setError(err instanceof Error ? err.message : 'Could not load chart diagnoses and documents'));
    return () => {
      live = false;
    };
  }, [plan.id, preview]);

  return (
    <div className="space-y-4">
      <ImportedPlanNotice
        source={plan.source}
        reviewDueAt={plan.reviewDueAt}
        status={plan.status}
        clientId={plan.clientId}
        planId={plan.id}
        rewriteDraftId={ctx?.rewriteDraftId ?? null}
      />

      <div className="rounded-xl bg-blue-50 p-4">
        <p className="text-xs font-bold uppercase text-blue-500">Diagnoses</p>
        <p className="mb-2 text-[11px] font-semibold text-blue-700">{CHART_DX_LABEL}</p>
        {error ? <p className="text-xs text-amber-700">{error}</p> : null}
        {!ctx && !error ? <p className="text-xs text-slate-500">{preview ? 'Not available in preview.' : 'Loading…'}</p> : null}
        {ctx && !ctx.chartDiagnoses.length ? (
          <p className="text-xs text-slate-600">No diagnoses on the chart yet. Add them on the client chart (Diagnoses) before rewriting the plan.</p>
        ) : null}
        <ul className="space-y-1">
          {ctx?.chartDiagnoses.map((d, i) => (
            <li key={`${d.code ?? d.description}-${i}`} className="flex flex-wrap items-center gap-2 text-sm">
              <span className={`rounded px-1.5 py-0.5 text-xs font-bold ${d.isPrimary ? 'bg-blue-200 text-blue-800' : 'bg-slate-200 text-slate-700'}`}>
                {d.isPrimary ? 'Primary' : 'Secondary'}
              </span>
              <span className="font-semibold text-slate-800">{d.code ?? 'Not coded'}</span>
              {d.description ? <span className="text-slate-700">{d.description}</span> : null}
              <span className="text-[11px] text-slate-500">({d.from})</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-xl border border-slate-200 p-4">
        <p className="mb-1 text-sm font-bold text-slate-700">Treatment Goals</p>
        {ctx?.documents.length ? (
          <div className="space-y-2">
            <p className="text-xs text-slate-600">The goals, objectives and interventions are in the Valant plan document filed to this chart:</p>
            <ul className="space-y-1.5">
              {ctx.documents.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <FileText size={14} className="text-blue-600" />
                  <span className="font-medium text-slate-800">{d.name}</span>
                  {d.filedAt ? <span className="text-[11px] text-slate-500">filed {d.filedAt}</span> : null}
                  {d.url ? (
                    <a href={d.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline">
                      View Valant plan document <ExternalLink size={11} />
                    </a>
                  ) : (
                    <span className="text-[11px] text-slate-500">File not available</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-xs text-slate-600">
            Goals, objectives and interventions for this plan are in Valant. No Valant plan document is filed to this chart yet: print the plan
            from Valant (or export the clinic&apos;s plan PDFs) and upload them in bulk through{' '}
            <Link href="/dashboard/ehr/doc-intake" className="font-semibold text-blue-600 hover:underline">
              Smart Doc Intake
            </Link>
            , which matches each PDF to its client and files it as a Treatment Plan. The rewrite can then offer its goals as suggestions.
          </p>
        )}
      </div>
    </div>
  );
}
