/**
 * Recording status bar copy and state (Oct 25 scribe field feedback). Pure — no I/O.
 */

export const RECORDING_LABEL = 'Recording';
export const PAUSED_LABEL = 'Paused';
export const PAUSE_LABEL = 'Pause';
export const RESUME_LABEL = 'Resume';
export const STOP_LABEL = 'Stop';

export const MAX_RECONNECT_ATTEMPTS = 6;
export const NO_AUDIO_SECONDS = 60;
export const NO_AUDIO_CODE = 'NO_AUDIO';
export const NO_AUDIO_MESSAGE =
  'No audio heard for 60 seconds. Check the microphone, then Resume or Stop.';

export function formatElapsed(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** `Recording interrupted: {reason}. Reconnecting… (attempt N of 6)` */
export function reconnectMessage(reason: string, attempt: number): string {
  const n = Math.min(Math.max(1, Math.floor(attempt)), MAX_RECONNECT_ATTEMPTS);
  return `Recording interrupted: ${reason}. Reconnecting… (attempt ${n} of ${MAX_RECONNECT_ATTEMPTS})`;
}

export type RecordingGap = { startedAt: string; endedAt: string | null; reason: string };

/** True once silence has lasted the full NO_AUDIO window. */
export function isNoAudio(silentSeconds: number): boolean {
  return silentSeconds >= NO_AUDIO_SECONDS;
}
