'use client';

/**
 * Collapsible "Template cues" panel beside the live transcript: the selected template's sections
 * with what to cover in each, and (with a linked appointment) the Visit Guide's in-session steps.
 * Display only: nothing here goes to the AI or is stored (templateCues.ts).
 */
import { useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, ClipboardList } from 'lucide-react';
import type { GuideStep } from '@/lib/visits/types';
import { SCRIBE_FORMAT_LABELS, type ScribeFormat } from '@/lib/scribe/settings';
import { guideCues, templateCues, withGuideNoteSteps } from '@/lib/scribe/templateCues';

export function TemplateCuesPanel({ format, guideSteps, guideLabel }: { format: ScribeFormat; guideSteps?: readonly GuideStep[] | null; guideLabel?: string | null }) {
  const [open, setOpen] = useState(true);
  const sections = useMemo(() => withGuideNoteSteps(templateCues(format), guideSteps ?? []), [format, guideSteps]);
  const steps = useMemo(() => guideCues(guideSteps ?? []), [guideSteps]);

  return (
    <aside aria-label="Template cues" className="rounded-xl border border-slate-200 bg-white">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-2 px-4 py-2.5 text-left">
        <ClipboardList size={15} className="text-slate-500" />
        <span className="text-sm font-semibold text-slate-900">Template cues</span>
        <span className="truncate text-xs text-slate-500">{SCRIBE_FORMAT_LABELS[format]}</span>
        <span className="ml-auto text-slate-400">{open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</span>
      </button>
      {open && (
        <div className="max-h-[60vh] space-y-3 overflow-y-auto border-t border-slate-100 px-4 py-3">
          <p className="text-xs text-slate-500">What this note asks for. Cues only: they are not sent to the AI and do not change the draft.</p>
          <ol className="space-y-2">
            {sections.map((s) => (
              <li key={s.heading} className="text-sm">
                <p className="flex flex-wrap items-center gap-1.5 font-semibold text-slate-800">
                  {s.heading}
                  {!s.aiFills && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">You complete</span>}
                </p>
                {s.cue && <p className="text-xs text-slate-600">{s.cue}</p>}
                {s.guide.map((g) => (
                  <p key={g} className="text-xs text-violet-800">
                    Visit Guide: {g}
                  </p>
                ))}
              </li>
            ))}
          </ol>
          {steps.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Visit Guide{guideLabel ? ` · ${guideLabel}` : ''}</p>
              <ul className="space-y-1.5">
                {steps.map((s) => (
                  <li key={s.id} className="flex items-start gap-2 text-sm">
                    <span
                      aria-label={s.done ? 'Done' : 'Not done'}
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${s.done ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300'}`}
                    >
                      {s.done ? <Check size={11} /> : null}
                    </span>
                    <span>
                      <span className="text-slate-800">{s.label}</span>
                      {s.level === 'required' && <span className="ml-1 text-[10px] font-semibold text-[#5C2D91]">required</span>}
                      {s.help && <span className="block text-xs text-slate-500">{s.help}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
