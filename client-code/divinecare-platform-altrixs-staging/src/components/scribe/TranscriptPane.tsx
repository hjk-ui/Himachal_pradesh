'use client';

/** Live / saved transcript with speaker roles the clinician can correct and highlighted cited lines. */
import { useEffect, useRef } from 'react';
import { SPEAKER_LABEL, SPEAKER_ROLES, formatTimestamp, type SpeakerRole, type TranscriptLine } from '@/lib/scribe/diarization';
import { isPasteEngine, transcriptSourceLabel } from '@/lib/scribe/paste';
import { formatGap, interleaveGaps, type RecordingGap } from '@/lib/scribe/recordingMonitor';

const ROLE_CLS: Record<SpeakerRole, string> = {
  CLINICIAN: 'bg-[#F5F3FF] text-[#4A2475]',
  CLIENT: 'bg-teal-50 text-teal-800',
  GUARDIAN: 'bg-sky-50 text-sky-800',
  FAMILY: 'bg-sky-50 text-sky-800',
  INTERPRETER: 'bg-emerald-50 text-emerald-800',
  OTHER: 'bg-amber-50 text-amber-800',
  UNKNOWN: 'bg-slate-100 text-slate-600',
};

export function TranscriptPane({
  lines,
  partial,
  highlight,
  editable,
  onRelabel,
  follow = true,
  engine,
  gaps,
}: {
  lines: TranscriptLine[];
  partial?: string;
  highlight?: Set<string>;
  editable: boolean;
  onRelabel?: (speakerLabel: string, role: SpeakerRole) => void;
  follow?: boolean;
  /** Capture engine: labels the source; pasted / imported text has no timestamps */
  engine?: string | null;
  /** What was not recorded (stream dropped): shown in time order between the lines */
  gaps?: RecordingGap[];
}) {
  const timed = !isPasteEngine(engine);
  const end = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (follow) end.current?.scrollIntoView({ block: 'nearest' });
  }, [lines.length, partial, follow]);
  useEffect(() => {
    const first = highlight && [...highlight][0];
    if (first) document.getElementById(`tl-${first}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [highlight]);
  const labels = [...new Map(lines.map((l) => [l.speakerLabel, l.role])).entries()];
  return (
    <div className="flex h-full flex-col rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2">
        <p className="text-sm font-semibold text-slate-900">Transcript</p>
        <span className="text-xs text-slate-500">{lines.length} {timed ? 'turns' : 'lines'} · {transcriptSourceLabel(engine)}</span>
        {editable && labels.length > 0 && (
          <span className="ml-auto flex flex-wrap gap-2">
            {labels.map(([label, role]) => (
              <label key={label} className="flex items-center gap-1 text-xs text-slate-600">
                <span className="font-mono">{label.startsWith('attendee:') ? 'attendee' : label.replace(/^paste:/, '')}</span>
                <select
                  aria-label={`Role for ${label}`}
                  value={role}
                  onChange={(e) => onRelabel?.(label, e.target.value as SpeakerRole)}
                  className="rounded border border-slate-200 px-1 py-0.5 text-xs"
                >
                  {SPEAKER_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {SPEAKER_LABEL[r]}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </span>
        )}
      </div>
      <div className="max-h-[520px] flex-1 space-y-1.5 overflow-y-auto p-4 text-sm">
        {lines.length === 0 && !partial && <p className="text-slate-400">Nothing transcribed yet.</p>}
        {interleaveGaps(lines, gaps ?? []).map((row) => {
          if (row.kind === 'gap') {
            return (
              <p key={`gap-${row.gap.startMs}`} role="note" className="rounded-lg border border-dashed border-rose-300 bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-800">
                {formatGap(row.gap)}: nothing was recorded here
              </p>
            );
          }
          const l = row.line;
          return (
          <div key={l.id} id={`tl-${l.id}`} className={`flex gap-2 rounded-lg px-2 py-1 ${highlight?.has(l.id) ? 'bg-yellow-100 ring-1 ring-yellow-300' : ''}`}>
            {timed && <span className="w-12 shrink-0 font-mono text-[11px] text-slate-400">{formatTimestamp(l.startMs)}</span>}
            <span className={`h-fit shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold ${ROLE_CLS[l.role]}`}>{SPEAKER_LABEL[l.role]}</span>
            <span className="text-slate-800">{l.text}</span>
            <span className="ml-auto shrink-0 font-mono text-[10px] text-slate-300">{l.id}</span>
          </div>
          );
        })}
        {partial && <p className="px-2 italic text-slate-400">{partial}</p>}
        <div ref={end} />
      </div>
    </div>
  );
}
