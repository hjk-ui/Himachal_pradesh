'use client';

import {
  NEVER_AI_HEADINGS,
  TEMPLATE_CUES_SUB,
  TEMPLATE_CUES_TITLE,
  YOU_COMPLETE_BADGE,
} from '@/lib/scribe/formats';

export function TemplateCues({
  visitGuideLabel,
  sectionLabels,
}: {
  visitGuideLabel?: string | null;
  sectionLabels?: string[];
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
      <h3 className="text-sm font-semibold text-slate-900">{TEMPLATE_CUES_TITLE}</h3>
      <p className="mt-1 text-xs text-slate-500">{TEMPLATE_CUES_SUB}</p>
      {visitGuideLabel ? (
        <p className="mt-2 text-xs font-medium text-slate-700">Visit Guide: {visitGuideLabel}</p>
      ) : null}
      {sectionLabels && sectionLabels.length > 0 ? (
        <ul className="mt-3 space-y-1.5">
          {sectionLabels.map((label) => (
            <li key={label} className="flex items-center justify-between text-sm text-slate-700">
              <span>{label}</span>
              {NEVER_AI_HEADINGS.includes(label as (typeof NEVER_AI_HEADINGS)[number]) ? (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                  {YOU_COMPLETE_BADGE}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {NEVER_AI_HEADINGS.map((h) => (
            <li key={h} className="flex items-center justify-between text-sm text-slate-700">
              <span>{h}</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                {YOU_COMPLETE_BADGE}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
