'use client';

/**
 * Always-visible recording status, fixed to the top of the viewport while an AI Scribe capture is
 * open, whatever the scroll position or the dock state: red pulsing dot, "Recording 12:34", Pause /
 * Resume / Stop. When the stream stops unexpectedly it turns into a banner ("Recording interrupted …
 * Reconnecting", "Recording stopped … Resume", "No audio detected"), plays a short sound cue, and
 * shows a browser notification when the tab is hidden (permission asked once when recording starts).
 * The tab title is prefixed while recording / interrupted.
 */
import { useEffect, useRef } from 'react';
import { AlertTriangle, Loader2, MicOff, Pause, Play, Square } from 'lucide-react';
import { formatTimestamp } from '@/lib/scribe/diarization';
import { alertFor, monitorBanner, type MonitorState } from '@/lib/scribe/recordingMonitor';
import type { StreamState } from './useTranscribeStream';

function beep() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ac = new Ctx();
    [880, 660].forEach((f, i) => {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.frequency.value = f;
      g.gain.value = 0.08;
      o.connect(g).connect(ac.destination);
      o.start(ac.currentTime + i * 0.22);
      o.stop(ac.currentTime + i * 0.22 + 0.18);
    });
    setTimeout(() => void ac.close().catch(() => undefined), 800);
  } catch {
    /* no audio output: the banner still shows */
  }
}

function notify(text: string) {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    // No PHI: the text names the recording state only
    new Notification('Altrixs AI Scribe', { body: text, tag: 'altrixs-scribe-recording' });
  } catch {
    /* notifications unavailable */
  }
}

export function RecordingStatusBar({
  state,
  elapsedSeconds,
  monitor,
  onPause,
  onResume,
  onStop,
}: {
  state: StreamState;
  elapsedSeconds: number;
  monitor: MonitorState;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}) {
  const prev = useRef<MonitorState>(monitor);
  const asked = useRef(false);
  const banner = monitorBanner(monitor);

  useEffect(() => {
    const before = prev.current;
    prev.current = monitor;
    const a = alertFor(before, monitor, typeof document !== 'undefined' && document.hidden);
    const text = monitorBanner(monitor)?.text;
    if (a.sound) beep();
    if (a.notify && text) notify(text);
  }, [monitor]);

  useEffect(() => {
    if (state !== 'live' || asked.current) return;
    asked.current = true;
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') void Notification.requestPermission().catch(() => undefined);
    } catch {
      /* ignore */
    }
  }, [state]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const base = document.title.replace(/^(● REC|Recording stopped!) · /, '');
    if (state === 'live') document.title = `● REC · ${base}`;
    else if (state === 'reconnecting' || banner?.tone === 'danger') document.title = `Recording stopped! · ${base}`;
    else document.title = base;
    return () => {
      document.title = document.title.replace(/^(● REC|Recording stopped!) · /, '');
    };
  }, [state, banner?.tone]);

  if (state === 'idle' || state === 'stopped' || state === 'error') return null;
  const live = state === 'live';
  const danger = banner?.tone === 'danger';
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex justify-center px-2 pt-2" data-testid="recording-status-bar">
      <div
        role={danger ? 'alert' : 'status'}
        aria-live={danger ? 'assertive' : 'polite'}
        className={`pointer-events-auto flex max-w-3xl flex-wrap items-center gap-2 rounded-full border px-4 py-1.5 text-sm shadow-lg ${
          danger ? 'border-rose-300 bg-rose-600 text-white' : banner ? 'border-amber-300 bg-amber-50 text-amber-900' : live ? 'border-red-200 bg-white text-red-700' : 'border-slate-200 bg-white text-slate-700'
        }`}
      >
        <span className="flex items-center gap-2 font-bold">
          {state === 'reconnecting' || state === 'connecting' ? (
            <Loader2 size={14} className="animate-spin" aria-hidden />
          ) : live ? (
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-600" aria-hidden />
          ) : danger ? (
            <AlertTriangle size={14} aria-hidden />
          ) : (
            <MicOff size={14} aria-hidden />
          )}
          {state === 'reconnecting' ? 'Reconnecting' : state === 'connecting' ? 'Connecting' : live ? 'Recording' : danger ? 'Recording stopped' : 'Paused'}
          <span className="font-mono font-normal">{formatTimestamp(elapsedSeconds * 1000)}</span>
        </span>
        {banner ? <span className="text-xs">{banner.text}</span> : null}
        <span className="flex gap-1.5">
          {live ? (
            <button type="button" onClick={onPause} className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-2.5 py-0.5 text-xs font-semibold text-slate-700">
              <Pause size={12} aria-hidden /> Pause
            </button>
          ) : null}
          {state === 'paused' ? (
            <button type="button" onClick={onResume} className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-2.5 py-0.5 text-xs font-semibold text-slate-700">
              <Play size={12} aria-hidden /> Resume
            </button>
          ) : null}
          {live || state === 'paused' || state === 'reconnecting' ? (
            <button type="button" onClick={onStop} className="inline-flex items-center gap-1 rounded-full bg-slate-800 px-2.5 py-0.5 text-xs font-semibold text-white">
              <Square size={12} aria-hidden /> Stop
            </button>
          ) : null}
        </span>
      </div>
    </div>
  );
}
