'use client';

/** Always-visible "Recording" indicator with mic level, timer, pause / resume / stop, "Dismiss scribe" and consent withdrawal. */
import { Loader2, Mic, MicOff, Pause, Play, Square, UserX } from 'lucide-react';
import { formatTimestamp } from '@/lib/scribe/diarization';
import type { DismissReason } from '@/lib/scribe/dismiss';
import { DismissScribe } from './DismissScribe';

export type BarState = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'paused' | 'stopped' | 'error';

export function RecordingBar({
  state,
  level,
  elapsedSeconds,
  engineLabel,
  onPause,
  onResume,
  onStop,
  onWithdraw,
  onDismiss,
}: {
  state: BarState;
  level: number | null;
  elapsedSeconds: number;
  engineLabel: string;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onWithdraw: () => void;
  /** Stop and discard the capture (asks first); omitted = not offered */
  onDismiss?: (reason?: DismissReason) => Promise<void> | void;
}) {
  const live = state === 'live';
  return (
    <div
      role="status"
      aria-live="polite"
      className={`sticky top-0 z-20 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-2.5 shadow-sm ${
        live ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-white'
      }`}
    >
      <span className={`flex items-center gap-2 text-sm font-bold ${live ? 'text-red-700' : 'text-slate-600'}`}>
        {state === 'connecting' || state === 'reconnecting' ? (
          <Loader2 size={14} className="animate-spin" />
        ) : live ? (
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-600" />
        ) : (
          <MicOff size={14} />
        )}
        {state === 'connecting' ? 'Connecting…' : state === 'reconnecting' ? 'Reconnecting… (recording interrupted)' : live ? 'Recording' : state === 'paused' ? 'Paused, not recording' : state === 'stopped' ? 'Stopped' : 'Not recording'}
      </span>
      <span className="font-mono text-sm text-slate-700">{formatTimestamp(elapsedSeconds * 1000)}</span>
      {level != null && (
        <span className="flex items-center gap-1.5" aria-label="Microphone level">
          <Mic size={14} className="text-slate-500" />
          <span className="h-2 w-24 overflow-hidden rounded-full bg-slate-200">
            <span className="block h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${Math.round((live ? level : 0) * 100)}%` }} />
          </span>
        </span>
      )}
      <span className="text-xs text-slate-500">{engineLabel}</span>
      <span className="ml-auto flex flex-wrap gap-2">
        {live && (
          <button type="button" onClick={onPause} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
            <Pause size={13} /> Pause
          </button>
        )}
        {state === 'paused' && (
          <button type="button" onClick={onResume} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
            <Play size={13} /> Resume
          </button>
        )}
        {(live || state === 'paused' || state === 'reconnecting') && (
          <button type="button" onClick={onStop} className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white">
            <Square size={13} /> Stop
          </button>
        )}
        {onDismiss && state !== 'idle' && <DismissScribe onConfirm={onDismiss} />}
        {state !== 'idle' && (
          <button type="button" onClick={onWithdraw} className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700">
            <UserX size={13} /> Consent withdrawn
          </button>
        )}
      </span>
    </div>
  );
}
