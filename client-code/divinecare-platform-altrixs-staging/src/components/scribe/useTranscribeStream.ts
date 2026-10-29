'use client';

/**
 * AI Scribe capture hooks (browser). The ONLY speech-to-text paths for PHI in Altrixs:
 *  - useTranscribeStream: microphone → AudioWorklet → 16 kHz PCM → presigned WebSocket straight to
 *    AWS Transcribe streaming (standard or Medical, per the practice setting; BAA). The server only signs the URL.
 *  - useChimeTranscript: telehealth; Chime runs Transcribe on the meeting audio inside AWS and
 *    delivers transcript events over the meeting data channel.
 * No browser speech service (Web Speech API) is used anywhere, and no audio is stored.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { downsample, floatToPcm16, meterLevel } from '@/lib/scribe/audio';
import { encodeAudioEvent, parseTranscribeMessage } from '@/lib/scribe/eventStream';
import { segmentsFromChimeResult, segmentsFromTranscribeResult, type ChimeResultLike, type RawSegment } from '@/lib/scribe/diarization';
import { TRIAL_SCRIBE_LIMIT_MESSAGE } from '@/lib/scribe/trialCap';
import type { DismissReason } from '@/lib/scribe/dismiss';
import {
  INITIAL_MONITOR,
  REPLAY_BUFFER_MS,
  backoffMs,
  reduceMonitor,
  type InterruptReason,
  type MonitorEvent,
  type MonitorState,
  type RecordingGap,
} from '@/lib/scribe/recordingMonitor';

export type StreamState = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'paused' | 'stopped' | 'error';
export type SeqSegment = RawSegment & { seq: number };

type ControlResponse = {
  success?: boolean;
  error?: string;
  code?: string;
  /** maxSeconds: live seconds left in the free trial (null = no trial cap). */
  stream?:
    | { kind: 'websocket'; url: string; sampleRate: number; type: 'CONVERSATION' | 'DICTATION'; engine?: 'standard' | 'medical'; maxSeconds?: number | null }
    | { kind: 'chime'; engine?: 'standard' | 'medical'; maxSeconds?: number | null };
};

/** Individual captures; group captures use /api/scribe/group-captures (same control / segments contract). */
export const SCRIBE_CAPTURES_API = '/api/scribe/captures';

export async function controlCapture(
  captureId: string,
  action: 'start' | 'resume' | 'reconnect' | 'gaps' | 'pause' | 'stop' | 'withdraw' | 'dismiss',
  capturedSeconds?: number,
  extra: { reason?: DismissReason; apiBase?: string; gaps?: RecordingGap[] } = {}
): Promise<ControlResponse & { status: number }> {
  try {
    const res = await fetch(`${extra.apiBase ?? SCRIBE_CAPTURES_API}/${encodeURIComponent(captureId)}/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...(capturedSeconds != null ? { capturedSeconds: Math.floor(capturedSeconds) } : {}), ...(extra.reason ? { reason: extra.reason } : {}), ...(extra.gaps ? { gaps: extra.gaps } : {}) }),
    });
    const data = (await res.json().catch(() => ({}))) as ControlResponse;
    return { ...data, status: res.status };
  } catch {
    return { success: false, error: 'Could not reach the server.', status: 0 };
  }
}

/** Batches finalized segments to the server; failed posts are retried with the next batch (idempotent by seq). */
function useSegmentSink(captureId: string | null, persist: boolean, apiBase = SCRIBE_CAPTURES_API) {
  const queue = useRef<SeqSegment[]>([]);
  const flushing = useRef(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const flush = useCallback(async () => {
    if (!persist || !captureId || flushing.current || !queue.current.length) return;
    flushing.current = true;
    const batch = queue.current.slice(0, 200);
    try {
      const res = await fetch(`${apiBase}/${encodeURIComponent(captureId)}/segments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ segments: batch }),
      });
      if (res.ok) {
        queue.current = queue.current.slice(batch.length);
        setSaveError(null);
      } else setSaveError('Transcript could not be saved; it will retry.');
    } catch {
      setSaveError('Transcript could not be saved; it will retry.');
    } finally {
      flushing.current = false;
    }
  }, [captureId, persist, apiBase]);
  useEffect(() => {
    const t = setInterval(() => void flush(), 3000);
    return () => clearInterval(t);
  }, [flush]);
  const push = useCallback((s: SeqSegment[]) => {
    queue.current.push(...s);
  }, []);
  /** Dismissed capture: drop unsent turns (never uploaded) */
  const clear = useCallback(() => {
    queue.current = [];
    setSaveError(null);
  }, []);
  return { push, flush, clear, saveError };
}

export function useTranscribeStream(opts: {
  captureId: string | null;
  kind: 'conversation' | 'dictation';
  /** Store finalized turns on the capture (sessions: yes; editor dictation: no) */
  persist: boolean;
  initialSeq?: number;
  onSegments?: (segments: SeqSegment[]) => void;
  /** Capture API base (group captures: /api/scribe/group-captures) */
  apiBase?: string;
}) {
  const apiBase = opts.apiBase ?? SCRIBE_CAPTURES_API;
  const [state, setState] = useState<StreamState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [partial, setPartial] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const ws = useRef<WebSocket | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const node = useRef<AudioWorkletNode | null>(null);
  const media = useRef<MediaStream | null>(null);
  const seq = useRef(opts.initialSeq ?? 0);
  const activeMs = useRef(0);
  const liveSince = useRef<number | null>(null);
  const streamOffset = useRef(0);
  const unreported = useRef(0);
  const onSeg = useRef(opts.onSegments);
  onSeg.current = opts.onSegments;
  /** activeMs at which the free-trial minutes run out (null = no cap) */
  const limitAtMs = useRef<number | null>(null);
  const pauseRef = useRef<(() => Promise<void>) | null>(null);
  const idRef = useRef<string | null>(opts.captureId);
  if (opts.captureId) idRef.current = opts.captureId;
  const sink = useSegmentSink(opts.captureId, opts.persist, apiBase);
  // Recording health (recordingMonitor.ts): unexpected stops, auto-reconnect, gaps, no-audio
  const [monitor, setMonitor] = useState<MonitorState>(INITIAL_MONITOR);
  const monitorRef = useRef<MonitorState>(INITIAL_MONITOR);
  const dispatch = useCallback((e: MonitorEvent) => {
    const next = reduceMonitor(monitorRef.current, e);
    monitorRef.current = next;
    setMonitor(next);
    return next;
  }, []);
  /** PCM16 chunks kept while reconnecting (replayed once the stream is back; never stored) */
  const replay = useRef<{ bytes: Uint8Array; ms: number }[]>([]);
  const replayMs = useRef(0);
  const peakLevel = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectRef = useRef<(() => Promise<void>) | null>(null);
  const interruptRef = useRef<((reason: InterruptReason) => void) | null>(null);
  const captureNow = useCallback(() => activeMs.current + (liveSince.current ? Date.now() - liveSince.current : 0), []);

  useEffect(() => {
    if (state !== 'live' && state !== 'reconnecting') return;
    const t = setInterval(() => {
      const total = captureNow();
      setElapsed(Math.floor(total / 1000));
      if (state === 'live') {
        dispatch({ type: 'audio', level: peakLevel.current, at: total });
        peakLevel.current = 0;
        if (monitorRef.current.status === 'live') dispatch({ type: 'tick', at: total });
      }
      if (limitAtMs.current !== null && total >= limitAtMs.current) {
        limitAtMs.current = null;
        void pauseRef.current?.().then(() => setError(TRIAL_SCRIBE_LIMIT_MESSAGE));
      }
    }, 500);
    return () => clearInterval(t);
  }, [state, dispatch, captureNow]);

  const closeSocket = useCallback(() => {
    const s = ws.current;
    ws.current = null;
    if (!s) return;
    try {
      if (s.readyState === WebSocket.OPEN) s.send(encodeAudioEvent(new Uint8Array(0)));
    } catch {
      /* closing anyway */
    }
    setTimeout(() => s.close(), 1500);
  }, []);

  const markInactive = useCallback(() => {
    if (liveSince.current) {
      const d = Date.now() - liveSince.current;
      activeMs.current += d;
      unreported.current += d;
      liveSince.current = null;
    }
  }, []);

  const openSocket = useCallback(
    (url: string, sampleRate: number) =>
      new Promise<void>((resolve, reject) => {
        const s = new WebSocket(url);
        s.binaryType = 'arraybuffer';
        let opened = false;
        s.onopen = () => {
          opened = true;
          resolve();
        };
        s.onerror = () => {
          if (!opened) reject(new Error('AWS Transcribe refused the connection (check the server role has transcribe:StartStreamTranscriptionWebSocket and transcribe:StartMedicalStreamTranscriptionWebSocket).'));
        };
        s.onclose = (ev) => {
          // Unexpected close while recording: reconnect on the same capture (with backoff)
          if (ws.current === s && ev.code !== 1000) {
            ws.current = null;
            interruptRef.current?.(navigator.onLine === false ? 'network_offline' : 'socket_closed');
          }
        };
        s.onmessage = (ev) => {
          let msg;
          try {
            msg = parseTranscribeMessage(new Uint8Array(ev.data as ArrayBuffer));
          } catch {
            return;
          }
          if (!msg) return;
          if (msg.type === 'exception') {
            setError(`Transcription error: ${msg.message}`);
            return;
          }
          for (const r of msg.results) {
            if (r.IsPartial) {
              setPartial(r.Alternatives?.[0]?.Transcript || '');
              continue;
            }
            setPartial('');
            const segs = segmentsFromTranscribeResult(r, streamOffset.current, opts.kind).map((x) => ({ ...x, seq: seq.current++ }));
            if (!segs.length) continue;
            sink.push(segs);
            onSeg.current?.(segs);
          }
        };
        ws.current = s;
        void sampleRate;
      }),
    [opts.kind, sink]
  );

  /** Tear down the audio graph only (the capture clock and the capture stay). */
  const releaseAudio = useCallback(() => {
    node.current?.port.postMessage({ paused: true });
    media.current?.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    media.current = null;
    void ctx.current?.close().catch(() => undefined);
    ctx.current = null;
    node.current = null;
  }, []);

  /** Microphone → worklet → Transcribe (or the replay buffer while reconnecting). */
  const ensureAudio = useCallback(async (sampleRate: number) => {
    const track = media.current?.getAudioTracks()[0];
    if (media.current && (!track || track.readyState === 'ended')) releaseAudio();
    if (!media.current) {
      media.current = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      const t = media.current.getAudioTracks()[0];
      if (t) t.onended = () => interruptRef.current?.('mic_ended');
    }
    if (!ctx.current) {
      const ac = new AudioContext();
      await ac.audioWorklet.addModule('/scribe/pcm-capture-worklet.js');
      const src = ac.createMediaStreamSource(media.current);
      const n = new AudioWorkletNode(ac, 'pcm-capture');
      n.port.onmessage = (e: MessageEvent<Float32Array>) => {
        const block = e.data;
        const lv = meterLevel(block);
        setLevel(lv);
        if (lv > peakLevel.current) peakLevel.current = lv;
        const s = ws.current;
        const pcm = () => encodeAudioEvent(floatToPcm16(downsample(block, ac.sampleRate, sampleRate)));
        if (s && s.readyState === WebSocket.OPEN) s.send(pcm());
        else if (monitorRef.current.status === 'reconnecting') {
          // Keep the most recent REPLAY_BUFFER_MS of audio for when the stream comes back
          const ms = (block.length / ac.sampleRate) * 1000;
          replay.current.push({ bytes: pcm(), ms });
          replayMs.current += ms;
          while (replayMs.current > REPLAY_BUFFER_MS && replay.current.length) replayMs.current -= replay.current.shift()!.ms;
        }
      };
      src.connect(n);
      ctx.current = ac;
      node.current = n;
    }
  }, [releaseAudio]);

  const reportGaps = useCallback(
    (gaps: RecordingGap[]) => {
      if (idRef.current && gaps.length) void controlCapture(idRef.current, 'gaps', undefined, { apiBase, gaps });
    },
    [apiBase]
  );

  const connect = useCallback(
    async (action: 'start' | 'resume', idOverride?: string) => {
      if (idOverride) idRef.current = idOverride;
      const captureId = idRef.current;
      if (!captureId) return;
      setError(null);
      setState('connecting');
      const res = await controlCapture(captureId, action, unreported.current / 1000, { apiBase });
      unreported.current = 0;
      if (!res.success || !res.stream || res.stream.kind !== 'websocket') {
        setError(res.error || 'Capture could not start. Nothing was captured.');
        setState(action === 'start' ? 'error' : 'paused');
        return;
      }
      const { url, sampleRate, maxSeconds } = res.stream;
      limitAtMs.current = typeof maxSeconds === 'number' ? activeMs.current + maxSeconds * 1000 : null;
      try {
        await ensureAudio(sampleRate);
        streamOffset.current = activeMs.current;
        await openSocket(url, sampleRate);
        node.current?.port.postMessage({ paused: false });
        liveSince.current = Date.now();
        setState('live');
        const prevGaps = monitorRef.current.gaps.length;
        const next = dispatch({ type: action === 'start' ? 'start' : 'resume', at: activeMs.current });
        if (next.gaps.length > prevGaps) reportGaps(next.gaps);
      } catch (err) {
        setError(err instanceof Error && err.name === 'NotAllowedError' ? 'Microphone permission was denied. Nothing was captured.' : err instanceof Error ? err.message : 'Could not start the microphone.');
        setState(action === 'start' ? 'error' : 'paused');
        void controlCapture(captureId, 'pause', undefined, { apiBase });
      }
    },
    [openSocket, ensureAudio, apiBase, dispatch, reportGaps]
  );

  /** Gave up reconnecting (or permission revoked): pause the capture so the session clock stops; Resume continues it. */
  const giveUp = useCallback(async () => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = null;
    replay.current = [];
    replayMs.current = 0;
    node.current?.port.postMessage({ paused: true });
    markInactive();
    setLevel(0);
    setPartial('');
    setState('paused');
    if (idRef.current) await controlCapture(idRef.current, 'pause', unreported.current / 1000, { apiBase });
    unreported.current = 0;
    void sink.flush();
  }, [markInactive, sink, apiBase]);

  /** One reconnect attempt on the same capture: new presigned URL, microphone re-acquired if it ended, buffered audio replayed. */
  const reconnect = useCallback(async () => {
    retryTimer.current = null;
    const captureId = idRef.current;
    if (!captureId || monitorRef.current.status !== 'reconnecting') return;
    const res = await controlCapture(captureId, 'reconnect', unreported.current / 1000, { apiBase });
    if (res.success) unreported.current = 0;
    try {
      if (!res.success || !res.stream || res.stream.kind !== 'websocket') throw new Error(res.error || 'reconnect refused');
      await ensureAudio(res.stream.sampleRate);
      const buffered = replay.current;
      const bufferedMs = replayMs.current;
      replay.current = [];
      replayMs.current = 0;
      streamOffset.current = Math.max(0, captureNow() - bufferedMs);
      await openSocket(res.stream.url, res.stream.sampleRate);
      for (const c of buffered) ws.current?.send(c.bytes);
      node.current?.port.postMessage({ paused: false });
      if (!liveSince.current) liveSince.current = Date.now();
      setError(null);
      setState('live');
      const next = dispatch({ type: 'reconnected', at: captureNow(), replayedMs: bufferedMs });
      reportGaps(next.gaps);
    } catch (err) {
      if (err instanceof Error && err.name === 'NotAllowedError') {
        dispatch({ type: 'interrupt', reason: 'permission_revoked', at: captureNow() });
        await giveUp();
        return;
      }
      if (res.status === 403 || res.status === 409) {
        // Consent revoked / trial cap / capture closed on the server: do not keep retrying
        setError(res.error || 'The capture can no longer record.');
        dispatch({ type: 'give_up', at: captureNow() });
        await giveUp();
        return;
      }
      const next = dispatch({ type: 'retry_failed', at: captureNow() });
      if (next.status === 'interrupted') {
        await giveUp();
        return;
      }
      retryTimer.current = setTimeout(() => void reconnectRef.current?.(), backoffMs(next.attempts));
    }
  }, [apiBase, ensureAudio, openSocket, dispatch, reportGaps, giveUp, captureNow]);
  useEffect(() => {
    reconnectRef.current = reconnect;
  }, [reconnect]);

  const interrupt = useCallback(
    (reason: InterruptReason) => {
      const before = monitorRef.current.status;
      if (before !== 'live' && before !== 'reconnecting') return;
      const next = dispatch({ type: 'interrupt', reason, at: captureNow() });
      if (before === 'live') {
        setState(next.status === 'reconnecting' ? 'reconnecting' : 'paused');
        setPartial('');
        if (ws.current) {
          const s = ws.current;
          ws.current = null;
          try {
            s.close();
          } catch {
            /* already closed */
          }
        }
      }
      if (next.status === 'interrupted') {
        void giveUp();
        return;
      }
      if (next.status === 'reconnecting' && !retryTimer.current) retryTimer.current = setTimeout(() => void reconnectRef.current?.(), backoffMs(next.attempts));
    },
    [dispatch, giveUp, captureNow]
  );
  useEffect(() => {
    interruptRef.current = interrupt;
  }, [interrupt]);

  // Device unplugged / switched, network down / back, microphone permission turned off
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onDevice = () => {
      const t = media.current?.getAudioTracks()[0];
      if (t && (t.readyState === 'ended' || t.muted)) interruptRef.current?.('device_changed');
    };
    const onOffline = () => interruptRef.current?.('network_offline');
    const onOnline = () => {
      if (monitorRef.current.status === 'reconnecting') {
        if (retryTimer.current) clearTimeout(retryTimer.current);
        retryTimer.current = setTimeout(() => void reconnectRef.current?.(), 250);
      }
    };
    navigator.mediaDevices?.addEventListener?.('devicechange', onDevice);
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    let perm: PermissionStatus | null = null;
    const onPerm = () => {
      if (perm?.state === 'denied') interruptRef.current?.('permission_revoked');
    };
    void navigator.permissions
      ?.query({ name: 'microphone' as PermissionName })
      .then((p) => {
        perm = p;
        p.addEventListener('change', onPerm);
      })
      .catch(() => undefined);
    return () => {
      navigator.mediaDevices?.removeEventListener?.('devicechange', onDevice);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
      perm?.removeEventListener('change', onPerm);
    };
  }, []);

  const pause = useCallback(async () => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = null;
    replay.current = [];
    replayMs.current = 0;
    node.current?.port.postMessage({ paused: true });
    const at = captureNow();
    markInactive();
    closeSocket();
    setLevel(0);
    setPartial('');
    setState('paused');
    const prevGaps = monitorRef.current.gaps.length;
    const next = dispatch({ type: 'pause', at });
    if (idRef.current) await controlCapture(idRef.current, 'pause', unreported.current / 1000, { apiBase, ...(next.gaps.length > prevGaps ? { gaps: next.gaps } : {}) });
    unreported.current = 0;
    void sink.flush();
  }, [closeSocket, markInactive, sink, apiBase, dispatch, captureNow]);
  pauseRef.current = pause;

  const release = useCallback(() => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = null;
    closeSocket();
    releaseAudio();
  }, [closeSocket, releaseAudio]);

  const stop = useCallback(async () => {
    const at = captureNow();
    markInactive();
    release();
    setLevel(0);
    setPartial('');
    setState('stopped');
    const prevGaps = monitorRef.current.gaps.length;
    const next = dispatch({ type: 'stop', at });
    if (idRef.current) await controlCapture(idRef.current, 'stop', unreported.current / 1000, { apiBase, ...(next.gaps.length > prevGaps ? { gaps: next.gaps } : {}) });
    unreported.current = 0;
    await new Promise((r) => setTimeout(r, 1600));
    await sink.flush();
  }, [markInactive, release, sink, apiBase, dispatch, captureNow]);

  /**
   * "Dismiss scribe": stop the microphone and the Transcribe stream at once and drop unsent turns
   * (nothing more is uploaded). The caller sends the 'dismiss' control call, which deletes what was
   * stored; returns the unreported seconds for metering.
   */
  const discard = useCallback((): number => {
    markInactive();
    // Close now, without waiting for Transcribe's final results (they would be thrown away)
    const s = ws.current;
    ws.current = null;
    if (s) {
      s.onmessage = null;
      s.onclose = null;
      try {
        s.close();
      } catch {
        /* already closed */
      }
    }
    release();
    sink.clear();
    setLevel(0);
    setPartial('');
    setState('stopped');
    const seconds = unreported.current / 1000;
    unreported.current = 0;
    return seconds;
  }, [markInactive, release, sink]);

  useEffect(() => () => release(), [release]);

  return {
    state,
    error,
    level,
    partial,
    elapsed,
    /** Recording health: reconnecting / interrupted / no audio, and the gaps so far (capture clock) */
    monitor,
    gaps: monitor.gaps,
    saveError: sink.saveError,
    start: (captureId?: string) => connect('start', captureId),
    resume: () => connect('resume'),
    pause,
    stop,
    discard,
    flush: sink.flush,
  };
}

type TranscriptionControllerLike = {
  subscribeToTranscriptEvent(cb: (e: unknown) => void): void;
  unsubscribeFromTranscriptEvent(cb: (e: unknown) => void): void;
};

/** Telehealth: subscribe to Chime transcript events and store final turns on the capture. */
export function useChimeTranscript(opts: {
  captureId: string | null;
  controller: TranscriptionControllerLike | null | undefined;
  /** Epoch ms when capture started (session clock zero) */
  startedAtMs: number | null;
  enabled: boolean;
  initialSeq?: number;
  onSegments?: (segments: SeqSegment[]) => void;
}) {
  const seq = useRef(opts.initialSeq ?? 0);
  const [partial, setPartial] = useState('');
  const sink = useSegmentSink(opts.captureId, true);
  const onSeg = useRef(opts.onSegments);
  onSeg.current = opts.onSegments;
  useEffect(() => {
    const c = opts.controller;
    if (!c || !opts.enabled || opts.startedAtMs == null) return;
    const start = opts.startedAtMs;
    const cb = (e: unknown) => {
      const results = (e as { results?: ChimeResultLike[] })?.results;
      if (!Array.isArray(results)) return;
      for (const r of results) {
        if (r.isPartial) {
          setPartial(r.alternatives?.[0]?.transcript || '');
          continue;
        }
        setPartial('');
        const segs = segmentsFromChimeResult(r, start).map((x) => ({ ...x, seq: seq.current++ }));
        if (!segs.length) continue;
        sink.push(segs);
        onSeg.current?.(segs);
      }
    };
    c.subscribeToTranscriptEvent(cb);
    return () => {
      c.unsubscribeFromTranscriptEvent(cb);
      void sink.flush();
    };
  }, [opts.controller, opts.enabled, opts.startedAtMs, sink]);
  /** Dismissed capture: drop unsent turns */
  const discard = useCallback(() => {
    sink.clear();
    setPartial('');
  }, [sink]);
  return { partial, saveError: sink.saveError, flush: sink.flush, discard };
}
