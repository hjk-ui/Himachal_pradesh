/**
 * Live recording health for the AI Scribe (browser-safe, pure). A reducer the capture hook drives:
 *
 *  - An unexpected stop (Transcribe WebSocket closed, microphone track ended, device unplugged /
 *    switched, permission revoked, network offline, stream error) moves 'live' → 'reconnecting'.
 *    The hook reconnects with backoff (backoffMs) on the SAME capture, re-acquiring the microphone
 *    when it ended, and replays the audio it buffered meanwhile (REPLAY_BUFFER_MS); after
 *    MAX_RECONNECT_ATTEMPTS it gives up → 'interrupted' (the clinician presses Resume).
 *    Permission revoked never auto-retries.
 *  - Audio the buffer could not hold is a gap: [start, end] on the capture clock, kept in the
 *    capture's metadata and shown in the transcript ("Recording gap 10:02–10:05").
 *  - No audio above SILENCE_LEVEL for NO_AUDIO_MS while live → noAudio ("No audio detected — check
 *    your mic").
 * Times are capture-clock milliseconds (the transcript's timeline).
 */
import { formatTimestamp } from './diarization';

export type RecordingStatus = 'idle' | 'live' | 'reconnecting' | 'interrupted' | 'paused' | 'stopped';
export type InterruptReason = 'socket_closed' | 'mic_ended' | 'device_changed' | 'permission_revoked' | 'network_offline' | 'stream_error';
export type RecordingGap = { startMs: number; endMs: number; reason: InterruptReason };

export const MAX_RECONNECT_ATTEMPTS = 6;
export const NO_AUDIO_MS = 60_000;
export const SILENCE_LEVEL = 0.02;
/** Audio kept while reconnecting and sent once the stream is back (nothing is stored) */
export const REPLAY_BUFFER_MS = 30_000;
/** Gaps shorter than this are not worth showing */
export const MIN_GAP_MS = 1_000;

export type MonitorState = {
  status: RecordingStatus;
  reason: InterruptReason | null;
  attempts: number;
  /** Capture time the stream dropped (while reconnecting / interrupted) */
  dropAtMs: number | null;
  gaps: RecordingGap[];
  /** Last capture time audio was above SILENCE_LEVEL */
  lastAudioAtMs: number | null;
  noAudio: boolean;
};

export type MonitorEvent =
  | { type: 'start'; at: number }
  | { type: 'interrupt'; reason: InterruptReason; at: number }
  | { type: 'reconnected'; at: number; replayedMs?: number }
  | { type: 'retry_failed'; at: number }
  /** The server refused (consent revoked, trial cap, capture closed): stop retrying */
  | { type: 'give_up'; at: number }
  | { type: 'pause'; at: number }
  | { type: 'resume'; at: number }
  | { type: 'stop'; at: number }
  | { type: 'audio'; level: number; at: number }
  | { type: 'tick'; at: number };

export const INITIAL_MONITOR: MonitorState = { status: 'idle', reason: null, attempts: 0, dropAtMs: null, gaps: [], lastAudioAtMs: null, noAudio: false };

/** Reconnect delay for attempt n (0-based): 1 s, 2 s, 4 s, 8 s, 15 s… */
export function backoffMs(attempt: number): number {
  return Math.min(15_000, 1_000 * 2 ** Math.max(0, attempt));
}

/** Auto-reconnect is attempted for every reason except a revoked microphone permission. */
export function autoReconnects(reason: InterruptReason): boolean {
  return reason !== 'permission_revoked';
}

function closeGap(s: MonitorState, at: number, replayedMs = 0): RecordingGap[] {
  if (s.dropAtMs == null || !s.reason) return s.gaps;
  // Buffered audio covers the end of the gap ([at - replayed, at] was sent once the stream came back)
  const end = Math.max(s.dropAtMs, at - Math.max(0, replayedMs));
  if (end - s.dropAtMs < MIN_GAP_MS) return s.gaps;
  return [...s.gaps, { startMs: s.dropAtMs, endMs: end, reason: s.reason }];
}

export function reduceMonitor(s: MonitorState, e: MonitorEvent): MonitorState {
  switch (e.type) {
    case 'start':
      return { ...s, status: 'live', reason: null, attempts: 0, dropAtMs: null, lastAudioAtMs: e.at, noAudio: false };
    case 'interrupt': {
      if (s.status === 'stopped' || s.status === 'idle' || s.status === 'paused') return s;
      if (s.status === 'reconnecting' || s.status === 'interrupted') {
        // A second cause during the same drop (socket close after the mic ended): a revoked permission wins
        return e.reason === 'permission_revoked' ? { ...s, status: 'interrupted', reason: e.reason } : s;
      }
      return { ...s, status: autoReconnects(e.reason) ? 'reconnecting' : 'interrupted', reason: e.reason, attempts: 0, dropAtMs: e.at };
    }
    case 'retry_failed': {
      if (s.status !== 'reconnecting') return s;
      const attempts = s.attempts + 1;
      return attempts >= MAX_RECONNECT_ATTEMPTS ? { ...s, status: 'interrupted', attempts } : { ...s, attempts };
    }
    case 'give_up':
      return s.status === 'reconnecting' ? { ...s, status: 'interrupted' } : s;
    case 'reconnected':
    case 'resume':
      if (s.status === 'stopped') return s;
      return { ...s, status: 'live', gaps: closeGap(s, e.at, e.type === 'reconnected' ? e.replayedMs : 0), reason: null, attempts: 0, dropAtMs: null, lastAudioAtMs: e.at, noAudio: false };
    case 'pause':
      return { ...s, status: 'paused', gaps: closeGap(s, e.at), reason: null, dropAtMs: null, noAudio: false };
    case 'stop':
      return { ...s, status: 'stopped', gaps: closeGap(s, e.at), reason: null, dropAtMs: null, noAudio: false };
    case 'audio':
      if (s.status !== 'live') return s;
      return e.level >= SILENCE_LEVEL ? { ...s, lastAudioAtMs: e.at, noAudio: false } : s;
    case 'tick':
      if (s.status !== 'live' || s.lastAudioAtMs == null) return s;
      return e.at - s.lastAudioAtMs >= NO_AUDIO_MS ? (s.noAudio ? s : { ...s, noAudio: true }) : s.noAudio ? { ...s, noAudio: false } : s;
    default:
      return s;
  }
}

export const INTERRUPT_TEXT: Record<InterruptReason, string> = {
  socket_closed: 'The transcription connection dropped',
  mic_ended: 'The microphone stopped',
  device_changed: 'The microphone was unplugged or switched',
  permission_revoked: 'Microphone permission was turned off',
  network_offline: 'The network connection was lost',
  stream_error: 'The transcription stream reported an error',
};

/** Banner text for the current state (null when recording normally). */
export function monitorBanner(s: MonitorState): { tone: 'danger' | 'warn'; text: string } | null {
  if (s.status === 'reconnecting' && s.reason) return { tone: 'danger', text: `Recording interrupted: ${INTERRUPT_TEXT[s.reason]}. Reconnecting… (attempt ${s.attempts + 1} of ${MAX_RECONNECT_ATTEMPTS})` };
  if (s.status === 'interrupted' && s.reason) {
    return {
      tone: 'danger',
      text: `Recording stopped: ${INTERRUPT_TEXT[s.reason]}. ${s.reason === 'permission_revoked' ? 'Allow the microphone in the browser, then press Resume.' : 'Press Resume to continue on this capture.'}`,
    };
  }
  if (s.status === 'live' && s.noAudio) return { tone: 'warn', text: 'No audio detected for over a minute — check your mic (muted, unplugged or the wrong input).' };
  return null;
}

/** "Recording gap 10:02–10:05 (the network connection was lost)" */
export function formatGap(g: RecordingGap): string {
  return `Recording gap ${formatTimestamp(g.startMs)}–${formatTimestamp(g.endMs)} (${INTERRUPT_TEXT[g.reason].replace(/^The /, 'the ')})`;
}

/** Sound cue + browser notification: on an interruption, and the notification only when the tab is hidden. */
export function alertFor(prev: MonitorState, next: MonitorState, tabHidden: boolean): { sound: boolean; notify: boolean } {
  const became = (st: RecordingStatus) => next.status === st && prev.status !== st;
  const interrupted = became('reconnecting') || became('interrupted');
  const silent = next.noAudio && !prev.noAudio;
  return { sound: interrupted || silent, notify: (interrupted || silent) && tabHidden };
}

/** Sanitized gaps from a client report (capture metadata; numbers and enums only). */
export function sanitizeGaps(input: unknown, max = 100): RecordingGap[] {
  if (!Array.isArray(input)) return [];
  const reasons = new Set(Object.keys(INTERRUPT_TEXT));
  return input
    .map((g) => g as Partial<RecordingGap>)
    .filter((g) => Number.isFinite(g.startMs) && Number.isFinite(g.endMs) && Number(g.endMs) >= Number(g.startMs) && reasons.has(String(g.reason)))
    .map((g) => ({ startMs: Math.round(Number(g.startMs)), endMs: Math.round(Number(g.endMs)), reason: g.reason as InterruptReason }))
    .slice(-max);
}

/** Transcript rows with the gaps in time order ("Recording gap 10:02–10:05" between the lines around it). */
export function interleaveGaps<L extends { startMs: number }>(lines: L[], gaps: RecordingGap[]): ({ kind: 'line'; line: L } | { kind: 'gap'; gap: RecordingGap })[] {
  const sorted = [...gaps].sort((a, b) => a.startMs - b.startMs);
  const out: ({ kind: 'line'; line: L } | { kind: 'gap'; gap: RecordingGap })[] = [];
  let g = 0;
  for (const line of lines) {
    while (g < sorted.length && sorted[g].startMs <= line.startMs) out.push({ kind: 'gap', gap: sorted[g++] });
    out.push({ kind: 'line', line });
  }
  while (g < sorted.length) out.push({ kind: 'gap', gap: sorted[g++] });
  return out;
}
