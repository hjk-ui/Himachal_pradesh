'use client';

/**
 * Shown in the Treatment Plan editor when the plan replaces a plan imported from Valant: the
 * Valant plan's metadata, the chart diagnoses used for the pre-fill, the filed Valant plan
 * documents, and "Import goals from the document": goal / objective / intervention lines read
 * from the document's OCR text, each quoted, that the clinician ticks and adds. Nothing is
 * saved until the clinician saves the draft.
 */
import { useState } from 'react';
import Link from 'next/link';
import { ExternalLink, FileInput, FileText, Quote } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { CHART_DX_LABEL, planDateView, type ChartDiagnosis, type GoalSuggestions, type SuggestedGoal } from '@/lib/ehr/importedPlans';
import type { ImportedPlanSource } from '@/lib/migration/valantTreatmentPlans';
import { smallBtn } from '@/components/notes/structuredNoteUi';
import { buttonClasses } from '@/components/ui';

export type RewriteInfo = {
  importedPlanId: string;
  source: ImportedPlanSource;
  reviewDueAt: string | null;
  status: string;
  chartDiagnoses: ChartDiagnosis[];
  documents: { id: string; name: string; filedAt: string | null; url: string | null; hasText: boolean }[];
};

type Loaded = { documentId: string; name: string; suggestions: GoalSuggestions };

function SourceQuote({ lines }: { lines: string[] }) {
  return (
    <blockquote className="mt-0.5 flex gap-1 border-l-2 border-slate-300 pl-2 text-[11px] italic text-slate-500">
      <Quote size={10} className="mt-0.5 shrink-0" />
      <span>{lines.join(' / ')}</span>
    </blockquote>
  );
}

export function RewriteFromValantPanel({
  rewrite,
  clientId,
  today,
  disabled,
  onAddGoals,
}: {
  rewrite: RewriteInfo;
  clientId: string;
  today: string;
  disabled: boolean;
  /** Add the ticked suggestions to the plan's goals (editor state only) */
  onAddGoals: (goals: SuggestedGoal[]) => void;
}) {
  const dates = planDateView({ source: rewrite.source, createdAt: null, reviewDueAt: rewrite.reviewDueAt, status: rewrite.status, today });
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [added, setAdded] = useState<string | null>(null);

  const load = async (doc: RewriteInfo['documents'][number]) => {
    setLoading(doc.id);
    setError(null);
    setAdded(null);
    try {
      const qs = new URLSearchParams({ clientId, documentId: doc.id });
      const res = await apiJson<{ success: true; document: { id: string; name: string }; suggestions: GoalSuggestions }>(
        `/api/ehr/treatment-plans/template/goal-suggestions?${qs.toString()}`
      );
      setLoaded({ documentId: res.document.id, name: res.document.name, suggestions: res.suggestions });
      setPicked(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the document');
    } finally {
      setLoading(null);
    }
  };

  // Lines found before any goal line become one more group, with the long-term goal left blank
  const groups: SuggestedGoal[] = loaded
    ? [
        ...loaded.suggestions.goals,
        ...(loaded.suggestions.unattached.length
          ? [
              {
                text: '',
                sourceLines: [],
                problem: null,
                objectives: loaded.suggestions.unattached.filter((u) => u.kind === 'objective').map((u) => ({ ...u.item, targetDateInSource: null })),
                interventions: loaded.suggestions.unattached.filter((u) => u.kind === 'intervention').map((u) => u.item),
              },
            ]
          : []),
      ]
    : [];

  return (
    <section className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
      <p className="flex items-center gap-1.5 text-sm font-bold">
        <FileInput size={14} /> Rewriting the plan imported from Valant
      </p>
      <p className="text-xs">
        {[rewrite.source.owner ? `Valant author: ${rewrite.source.owner}` : null, dates.lastUpdatedLabel, dates.startLabel].filter(Boolean).join(' · ')} ·{' '}
        <span className={dates.overdue ? 'font-bold text-rose-700' : ''}>{dates.reviewLabel}</span>
        {rewrite.source.supervisor ? ` · Supervisor: ${rewrite.source.supervisor}` : ''}
      </p>
      <p className="text-xs">
        When this plan is signed (and co-signed when required) it becomes the active plan and the Valant plan is closed. Valant&apos;s goals were not in
        the export, so they are not pre-filled.
      </p>

      <div className="rounded-lg bg-white/70 p-3">
        <p className="text-[11px] font-semibold uppercase text-slate-500">Diagnoses pre-filled · {CHART_DX_LABEL}</p>
        {rewrite.chartDiagnoses.length ? (
          <ul className="mt-1 space-y-0.5 text-xs text-slate-700">
            {rewrite.chartDiagnoses.map((d, i) => (
              <li key={`${d.code ?? d.description}-${i}`}>
                {d.isPrimary ? 'Primary: ' : ''}
                <span className="font-semibold">{d.code ?? 'Not coded'}</span> {d.description} <span className="text-slate-500">({d.from}{d.code ? '' : ', not added: no ICD-10 code'})</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-xs text-slate-600">No diagnoses on the chart. Add them below.</p>
        )}
      </div>

      <div className="rounded-lg bg-white/70 p-3">
        <p className="text-[11px] font-semibold uppercase text-slate-500">Valant plan document</p>
        {rewrite.documents.length ? (
          <ul className="mt-1 space-y-1.5">
            {rewrite.documents.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 text-xs">
                <FileText size={13} className="text-blue-600" />
                <span className="font-medium text-slate-800">{d.name}</span>
                {d.filedAt ? <span className="text-slate-500">filed {d.filedAt}</span> : null}
                {d.url ? (
                  <a href={d.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-blue-600 hover:underline">
                    View Valant plan document <ExternalLink size={11} />
                  </a>
                ) : null}
                {d.hasText ? (
                  <button type="button" className={smallBtn} disabled={disabled || loading === d.id} onClick={() => void load(d)}>
                    {loading === d.id ? 'Reading…' : 'Import goals from the document'}
                  </button>
                ) : (
                  <span className="text-slate-500">No text read from this file (OCR), so goals cannot be suggested: read it and type them in.</span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-xs text-slate-600">
            None filed to this chart. Print the plan from Valant (or export the clinic&apos;s plan PDFs) and upload them in bulk through{' '}
            <Link href="/dashboard/ehr/doc-intake" className="font-semibold text-blue-600 hover:underline">
              Smart Doc Intake
            </Link>{' '}
            (filed as Treatment Plan); the goals can then be suggested here.
          </p>
        )}
        {error ? <p className="mt-2 text-xs text-rose-700">{error}</p> : null}
      </div>

      {loaded ? (
        <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
          <p className="text-xs font-semibold text-slate-700">Suggestions from “{loaded.name}”</p>
          {!groups.length ? (
            <p className="text-xs text-slate-600">
              No labeled goal, objective or intervention lines were found in this document&apos;s text. Read the document and type the goals in.
            </p>
          ) : (
            <>
              <p className="text-[11px] text-slate-500">
                Lines quoted exactly as read from the document. Tick the goals to add, then edit them with the client: set new target dates (the
                document&apos;s dates are shown, not copied), intervention type, frequency and responsible staff.
              </p>
              <ul className="space-y-2">
                {groups.map((g, i) => (
                  <li key={i} className="rounded-lg border border-slate-100 p-2">
                    <label className="flex items-start gap-2 text-xs text-slate-800">
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 accent-blue-600"
                        checked={picked.has(i)}
                        onChange={(e) => {
                          const next = new Set(picked);
                          if (e.target.checked) next.add(i);
                          else next.delete(i);
                          setPicked(next);
                        }}
                      />
                      <span className="flex-1">
                        {g.problem ? <span className="block text-[11px] text-slate-500">Problem: {g.problem}</span> : null}
                        <span className="font-semibold">{g.text ? `Goal: ${g.text}` : 'Lines not under a goal (you write the long-term goal)'}</span>
                        {g.sourceLines.length ? <SourceQuote lines={g.sourceLines} /> : null}
                        {g.objectives.map((o, j) => (
                          <span key={`o${j}`} className="mt-1 block pl-2">
                            Objective: {o.text}
                            {o.targetDateInSource ? <span className="text-slate-500"> (document target date {o.targetDateInSource}, not copied)</span> : null}
                            <SourceQuote lines={o.sourceLines} />
                          </span>
                        ))}
                        {g.interventions.map((iv, j) => (
                          <span key={`i${j}`} className="mt-1 block pl-2">
                            Intervention: {iv.text}
                            <SourceQuote lines={iv.sourceLines} />
                          </span>
                        ))}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={disabled || picked.size === 0}
                  className={buttonClasses({ variant: 'primary', size: 'sm' })}
                  onClick={() => {
                    onAddGoals(groups.filter((_, i) => picked.has(i)));
                    setAdded(`${picked.size} goal${picked.size === 1 ? '' : 's'} added below. Review each one; nothing is saved until you save the draft.`);
                    setPicked(new Set());
                  }}
                >
                  Add selected to the plan
                </button>
                {added ? <span className="text-xs font-semibold text-emerald-700">{added}</span> : null}
              </div>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
