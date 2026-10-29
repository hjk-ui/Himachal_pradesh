'use client';

import {
  NO_AUDIO_MESSAGE,
  PAUSED_LABEL,
  PAUSE_LABEL,
  RECORDING_LABEL,
  RESUME_LABEL,
  STOP_LABEL,
  formatElapsed,
  reconnectMessage,
} from '@/lib/scribe-feedback/recordingStatus';

type Props = {
  elapsedSeconds: number;
  paused: boolean;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  /** Set while the capture connection is being re-established */
  reconnect?: { reason: string; attempt: number } | null;
  /** True after 60 seconds with no audio */
  noAudio?: boolean;
  className?: string;
};

export function RecordingStatusBar({
  elapsedSeconds,
  paused,
  onPause,
  onResume,
  onStop,
  reconnect = null,
  noAudio = false,
  className = '',
}: Props) {
  return (
    <div className={`space-y-2 ${className}`} data-testid="recording-status-bar">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-100 bg-red-50 px-4 py-2.5">
        <div className="flex items-center gap-2" role="status" aria-live="polite">
          <span
            className={`h-2.5 w-2.5 rounded-full bg-red-500 ${paused ? '' : 'animate-pulse'}`}
            aria-hidden="true"
          />
          <span className="text-sm font-semibold text-red-800">
            {paused ? PAUSED_LABEL : RECORDING_LABEL}
          </span>
          <span className="text-sm font-bold tabular-nums text-red-700">{formatElapsed(elapsedSeconds)}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={paused ? onResume : onPause}
            className="min-h-11 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            {paused ? RESUME_LABEL : PAUSE_LABEL}
          </button>
          <button
            type="button"
            onClick={onStop}
            className="min-h-11 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700"
          >
            {STOP_LABEL}
          </button>
        </div>
      </div>

      {reconnect ? (
        <p
          role="alert"
          className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          {reconnectMessage(reconnect.reason, reconnect.attempt)}
        </p>
      ) : null}

      {noAudio ? (
        <p
          role="alert"
          className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          {NO_AUDIO_MESSAGE}
        </p>
      ) : null}
    </div>
  );
}
