'use client';

/**
 * After an AI Scribe draft: (1) withheld AI sentences offered back under their section as one-click
 * suggestions (never inserted by the AI; the clinician checks the transcript and clicks), and (2)
 * measures the clinician said are to be completed, with one "Assign these measures" click. Nothing
 * is assigned from speech: the click creates "once" schedules due on the next visit, and sending
 * follows the practice's measure settings and the client's contact consents (the measures job).
 */
import { useMemo, useState } from 'react';
import { ClipboardList, Loader2, Plus } from 'lucide-react';
import { WITHHOLD_LABEL } from '@/lib/scribe/grounding';
import { suggestionsFromWithheld, type DraftSuggestion } from '@/lib/scribe/suggestions';
import { measureAssignments } from '@/lib/scribe/spokenMeasures';
import type { DraftContent } from './types';

type AssignResult = { instrumentId: string; ok: boolean; message: string };

export function DraftSuggestions({
  content,
  clientId,
  onInsert,
  onCite,
  readOnly,
}: {
  content: DraftContent;
  clientId: string | null;
  /** Insert an accepted suggestion into its section (omitted / readOnly: listed only) */
  onInsert?: (s: DraftSuggestion) => void;
  onCite?: (cites: string[]) => void;
  readOnly?: boolean;
}) {
  const suggestions = useMemo(() => suggestionsFromWithheld(content.withheld ?? []), [content.withheld]);
  const [inserted, setInserted] = useState<Set<string>>(new Set());
  const plan = content.measurePlan ?? [];
  const [assigning, setAssigning] = useState(false);
  const [results, setResults] = useState<AssignResult[] | null>(null);
  const byHeading = useMemo(() => {
    const m = new Map<string, DraftSuggestion[]>();
    for (const s of suggestions) m.set(s.heading, [...(m.get(s.heading) ?? []), s]);
    return m;
  }, [suggestions]);
  const toAssign = clientId ? measureAssignments(plan, { clientId, nextAppointmentDate: content.nextAppointmentDate ?? null }) : [];

  const assign = async () => {
    setAssigning(true);
    const out: AssignResult[] = [];
    for (const a of toAssign) {
      try {
        const res = await fetch('/api/clinical/measure-assignments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(a) });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        out.push({ instrumentId: a.instrumentId, ok: res.ok, message: res.ok ? 'Assigned' : res.status === 409 ? 'Already scheduled' : data.error || 'Could not assign' });
      } catch {
        out.push({ instrumentId: a.instrumentId, ok: false, message: 'Could not reach the server' });
      }
    }
    setResults(out);
    setAssigning(false);
  };

  if (!suggestions.length && !plan.length) return null;
  return (
    <div className="space-y-3">
      {suggestions.length > 0 && (
        <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-sm">
          <p className="font-semibold text-amber-900">AI suggestions withheld from the note ({suggestions.length})</p>
          <p className="text-xs text-amber-900">
            The AI drafted these but they did not pass the transcript check, so they were not inserted. Check the transcript lines, then insert the ones that are right.
          </p>
          {[...byHeading.entries()].map(([heading, list]) => (
            <div key={heading} className="rounded-lg border border-amber-100 bg-white p-2">
              <p className="text-[11px] font-bold uppercase tracking-wide text-[#5C2D91]">{heading}</p>
              <ul className="mt-1 space-y-1">
                {list.map((s) => {
                  const key = `${s.heading}|${s.insert}`;
                  return (
                    <li key={key} className="flex flex-wrap items-start gap-2 text-xs text-slate-700">
                      <span className="min-w-0 flex-1">
                        {s.insert}{' '}
                        <button type="button" className="font-mono text-slate-400 underline" onClick={() => onCite?.(s.cites)}>
                          [{s.cites.join(', ')}]
                        </button>
                        <span className="block text-[11px] text-amber-800">{s.reason ? WITHHOLD_LABEL[s.reason] : 'Withheld'}{s.detail ? ` (${s.detail})` : ''}</span>
                      </span>
                      {inserted.has(key) ? (
                        <span className="font-semibold text-emerald-700">Inserted</span>
                      ) : onInsert && !readOnly ? (
                        <button
                          type="button"
                          onClick={() => {
                            onInsert(s);
                            setInserted((prev) => new Set(prev).add(key));
                          }}
                          className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-0.5 font-semibold text-slate-700"
                        >
                          <Plus size={12} aria-hidden /> Insert
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
      {plan.length > 0 && (
        <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700">
          <p className="flex items-center gap-1.5 font-semibold">
            <ClipboardList size={14} aria-hidden /> Measures you said to complete
          </p>
          <ul className="space-y-1 text-xs">
            {plan.map((m) => {
              const r = results?.find((x) => x.instrumentId === m.instrumentId);
              return (
                <li key={m.instrumentId ?? m.name} className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{m.name}</span>
                  <button type="button" className="font-mono text-slate-400 underline" onClick={() => onCite?.(m.cites)}>
                    [{m.cites.join(', ')}]
                  </button>
                  <span className={m.status === 'sendable' ? 'text-emerald-700' : 'text-amber-800'}>
                    {r ? r.message : m.status === 'sendable' ? 'Can be assigned' : m.note}
                  </span>
                </li>
              );
            })}
          </ul>
          {toAssign.length > 0 && !results ? (
            <button
              type="button"
              disabled={assigning || readOnly}
              onClick={() => void assign()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#5C2D91] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {assigning ? <Loader2 size={12} className="animate-spin" aria-hidden /> : null}
              Assign these measures ({toAssign.length}){content.nextAppointmentDate ? `, due ${content.nextAppointmentDate}` : ''}
            </button>
          ) : null}
          <p className="text-[11px] text-slate-500">
            Nothing is assigned from what was said: the click schedules each measure once{content.nextAppointmentDate ? ' for the next visit' : ''}. Links go out under the practice&apos;s measure settings and the client&apos;s contact consents.
          </p>
        </div>
      )}
    </div>
  );
}
