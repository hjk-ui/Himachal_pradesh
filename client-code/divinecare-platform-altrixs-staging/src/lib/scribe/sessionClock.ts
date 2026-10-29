/**
 * Session clock from an AI Scribe capture. Pure, browser-safe.
 *
 * Start = when the capture started (wall clock), end = when it stopped (or when it was paused, if
 * it was stopped while paused). Minutes = end − start − paused time (ScribeCapture.pausedSeconds:
 * each pause → resume interval). The note's session start / end time and duration come from here;
 * the clinician corrects them to the actual face-to-face time before signing.
 */
import { toPracticeWallTime } from '@/lib/time/practiceTime';

export type CaptureClock = {
  startedAt: Date | string | null;
  stoppedAt: Date | string | null;
  pausedAt?: Date | string | null;
  pausedSeconds?: number | null;
};

export type SessionClock = {
  date: string;
  startTime: string;
  endTime: string;
  /** Active minutes (pauses removed) */
  minutes: number;
  pausedMinutes: number;
};

const asDate = (d: Date | string | null | undefined) => (d ? new Date(d) : null);

export function sessionClockFromCapture(cap: CaptureClock, timeZone: string): SessionClock | null {
  const start = asDate(cap.startedAt);
  const stop = asDate(cap.stoppedAt);
  if (!start || !stop || Number.isNaN(start.getTime()) || Number.isNaN(stop.getTime())) return null;
  const pausedAt = asDate(cap.pausedAt);
  // Stopped while paused: the session ended when it was paused
  const end = pausedAt && pausedAt.getTime() <= stop.getTime() && pausedAt.getTime() > start.getTime() ? pausedAt : stop;
  if (end.getTime() <= start.getTime()) return null;
  const pausedMs = Math.max(0, (cap.pausedSeconds ?? 0) * 1000);
  const activeMs = Math.max(0, end.getTime() - start.getTime() - pausedMs);
  const s = toPracticeWallTime(start, timeZone);
  const e = toPracticeWallTime(end, timeZone);
  return { date: s.date, startTime: s.time, endTime: e.time, minutes: Math.floor(activeMs / 60000), pausedMinutes: Math.round(pausedMs / 60000) };
}

/** Pause / resume bookkeeping for the control route. */
export function pauseUpdate(action: 'pause' | 'resume' | 'stop', cap: { pausedAt: Date | null; pausedSeconds: number }, now: Date): { pausedAt?: Date | null; pausedSeconds?: number } {
  if (action === 'pause') return cap.pausedAt ? {} : { pausedAt: now };
  if (action === 'resume') {
    if (!cap.pausedAt) return {};
    return { pausedAt: null, pausedSeconds: cap.pausedSeconds + Math.max(0, Math.round((now.getTime() - cap.pausedAt.getTime()) / 1000)) };
  }
  return {};
}

/** "Start time: / End time:" lines for the therapist templates' Session section (the editor restores them). */
export function sessionTimeLines(clock: SessionClock): string {
  return `Start time: ${clock.startTime}\nEnd time: ${clock.endTime}`;
}
