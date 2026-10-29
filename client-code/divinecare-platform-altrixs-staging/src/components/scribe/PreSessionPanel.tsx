'use client';

/** Pre-session: the existing AI pre-visit brief plus the last plan / homework, open goals and measures due. */
import { AlertTriangle, ClipboardList, Lightbulb, Target } from 'lucide-react';
import { PreVisitBriefCard } from '@/components/ai/PreVisitBriefCard';
import type { Cue } from '@/lib/scribe/cues';
import type { ScribeContextResponse } from './types';

export function PreSessionPanel({ clientId, data }: { clientId: string; data: ScribeContextResponse | null }) {
  const ctx = data?.context;
  return (
    <div className="space-y-3">
      <PreVisitBriefCard clientId={clientId} />
      {ctx && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="mb-1 flex items-center gap-1.5 text-xs font-bold uppercase text-slate-500">
              <ClipboardList size={13} /> Last plan / homework
            </p>
            <p className="whitespace-pre-wrap text-sm text-slate-700">{ctx.lastPlan || 'None recorded.'}</p>
            {ctx.lastPlanDate && <p className="mt-1 text-[11px] text-slate-400">From the note of {ctx.lastPlanDate}</p>}
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="mb-1 flex items-center gap-1.5 text-xs font-bold uppercase text-slate-500">
              <Target size={13} /> Open goals{ctx.planTitle ? ` — ${ctx.planTitle}` : ''}
            </p>
            {ctx.goals.length ? (
              <ol className="list-decimal space-y-0.5 pl-4 text-sm text-slate-700">
                {ctx.goals.map((g) => (
                  <li key={g.id}>{g.text}</li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-slate-500">No active signed treatment plan.</p>
            )}
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="mb-1 flex items-center gap-1.5 text-xs font-bold uppercase text-slate-500">
              <AlertTriangle size={13} /> Measures due
            </p>
            {ctx.measuresDue.length ? (
              <ul className="space-y-0.5 text-sm text-slate-700">
                {ctx.measuresDue.map((m) => (
                  <li key={m.instrument}>
                    <strong>{m.instrument}</strong>: {m.detail}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">None due.</p>
            )}
            {ctx.scores.length > 0 && <p className="mt-1 text-[11px] text-slate-500">Latest: {ctx.scores.join(' · ')}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

export function LiveCues({ cues, onJump }: { cues: Cue[]; onJump: (lineId: string) => void }) {
  if (!cues.length) return null;
  return (
    <div className="flex flex-wrap gap-2" aria-label="In-session cues">
      {cues.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => c.lineId && onJump(c.lineId)}
          className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${
            c.kind === 'risk' ? 'bg-rose-100 text-rose-800' : c.kind === 'goal' ? 'bg-teal-50 text-teal-800' : 'bg-amber-50 text-amber-800'
          }`}
        >
          <Lightbulb size={12} /> {c.text}
        </button>
      ))}
    </div>
  );
}
