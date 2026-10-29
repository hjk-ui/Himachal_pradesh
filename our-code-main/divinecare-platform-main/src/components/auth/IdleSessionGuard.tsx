'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { signOut, useSession } from 'next-auth/react';
import { Button } from '@/components/ui/Button';
import {
  ABSOLUTE_SESSION_MS,
  HEARTBEAT_INTERVAL_MS,
  IDLE_TIMEOUT_MS,
  IDLE_WARNING_MS,
} from '@/lib/security/idleSession';

const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'wheel', 'touchstart', 'pointerdown', 'scroll'] as const;
const STORAGE_ACTIVITY = 'dc:last-activity';
const STORAGE_START_PREFIX = 'dc:session-start:';
const TICK_MS = 1000;
/** Passive pointer moves count too, but are rate-limited so we do not thrash. */
const MOVE_THROTTLE_MS = 5000;

function streamIsLive(stream: MediaStream | null | undefined) {
  return Boolean(stream?.getTracks().some((t) => t.readyState === 'live' && t.enabled));
}

/**
 * Live mic / camera counts as activity (telehealth, calls, scribe). We track streams
 * handed out by getUserMedia and any <video>/<audio> currently playing a live stream.
 */
function installMediaTracker() {
  const streams = new Set<MediaStream>();
  const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
  const original = md?.getUserMedia?.bind(md);
  if (md && original) {
    md.getUserMedia = async (constraints?: MediaStreamConstraints) => {
      const stream = await original(constraints);
      streams.add(stream);
      return stream;
    };
  }

  const hasLiveMedia = () => {
    for (const stream of streams) {
      if (streamIsLive(stream)) return true;
      streams.delete(stream);
    }
    if (typeof document === 'undefined') return false;
    const els = document.querySelectorAll<HTMLMediaElement>('video, audio');
    for (const el of els) {
      const src = el.srcObject;
      if (src && typeof MediaStream !== 'undefined' && src instanceof MediaStream && streamIsLive(src)) {
        return true;
      }
    }
    return false;
  };

  const dispose = () => {
    if (md && original) md.getUserMedia = original;
    streams.clear();
  };
  return { hasLiveMedia, dispose };
}

function formatCountdown(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Staff idle guard. Idle 15 min (warning at 14:00), absolute 12 h.
 *
 * CRITICAL: the heartbeat is a silent `POST /api/auth/session { activity: true }`.
 * It must NEVER call `useSession().update()` — that flips next-auth to "loading"
 * and re-renders every session consumer (the dashboard "blink").
 */
export function IdleSessionGuard() {
  // Read-only: no `update` is destructured on purpose.
  const { data, status } = useSession();
  const userId = data?.user?.id ?? null;
  const loginAt = data?.user?.loginAt ?? null;

  const lastActivityRef = useRef(Date.now());
  const lastBeatRef = useRef(0);
  const lastMoveRef = useRef(0);
  const warningRef = useRef(false);
  const endedRef = useRef(false);
  const [warningMsLeft, setWarningMsLeft] = useState<number | null>(null);

  const endSession = useCallback((reason: 'idle' | 'absolute' | 'manual') => {
    if (endedRef.current) return;
    endedRef.current = true;
    const callbackUrl = reason === 'manual' ? '/login' : '/login?error=SessionExpired';
    void signOut({ callbackUrl });
  }, []);

  const heartbeat = useCallback(
    async (force = false) => {
      const now = Date.now();
      if (!force && now - lastBeatRef.current < HEARTBEAT_INTERVAL_MS) return;
      lastBeatRef.current = now;
      try {
        const res = await fetch('/api/auth/session', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ activity: true }),
          keepalive: true,
        });
        if (res.status === 401) {
          const body = (await res.json().catch(() => null)) as { code?: string } | null;
          endSession(body?.code === 'SESSION_EXPIRED' ? 'absolute' : 'idle');
        }
      } catch {
        /* offline — next tick retries; never surface UI for a failed heartbeat */
      }
    },
    [endSession]
  );

  const markActivity = useCallback(() => {
    if (warningRef.current) return; // only "Stay signed in" dismisses the warning
    const now = Date.now();
    lastActivityRef.current = now;
    try {
      window.localStorage.setItem(STORAGE_ACTIVITY, String(now));
    } catch {
      /* storage blocked */
    }
  }, []);

  const staySignedIn = useCallback(() => {
    const now = Date.now();
    warningRef.current = false;
    lastActivityRef.current = now;
    setWarningMsLeft(null);
    try {
      window.localStorage.setItem(STORAGE_ACTIVITY, String(now));
    } catch {
      /* storage blocked */
    }
    void heartbeat(true);
  }, [heartbeat]);

  useEffect(() => {
    if (status !== 'authenticated' || !userId) return;
    endedRef.current = false;
    lastActivityRef.current = Date.now();

    // Absolute clock: JWT loginAt, else first-seen per user for pre-existing tokens.
    let startedAt = loginAt;
    if (!startedAt) {
      try {
        const key = `${STORAGE_START_PREFIX}${userId}`;
        const stored = Number(window.localStorage.getItem(key));
        startedAt = Number.isFinite(stored) && stored > 0 ? stored : Date.now();
        window.localStorage.setItem(key, String(startedAt));
      } catch {
        startedAt = Date.now();
      }
    }

    const media = installMediaTracker();

    const onActivity = () => markActivity();
    const onMove = () => {
      const now = Date.now();
      if (now - lastMoveRef.current < MOVE_THROTTLE_MS) return;
      lastMoveRef.current = now;
      markActivity();
    };
    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, onActivity, { passive: true, capture: true });
    }
    window.addEventListener('mousemove', onMove, { passive: true });
    const onVisible = () => {
      if (document.visibilityState === 'visible') markActivity();
    };
    document.addEventListener('visibilitychange', onVisible);

    void heartbeat(true);

    const tick = window.setInterval(() => {
      const now = Date.now();

      if (now - (startedAt as number) >= ABSOLUTE_SESSION_MS) {
        endSession('absolute');
        return;
      }

      if (media.hasLiveMedia()) {
        lastActivityRef.current = now;
        if (warningRef.current) {
          warningRef.current = false;
          setWarningMsLeft(null);
        }
      }

      // Activity in another tab counts.
      try {
        const shared = Number(window.localStorage.getItem(STORAGE_ACTIVITY));
        if (Number.isFinite(shared) && shared > lastActivityRef.current && !warningRef.current) {
          lastActivityRef.current = shared;
        }
      } catch {
        /* storage blocked */
      }

      const idle = now - lastActivityRef.current;
      if (idle >= IDLE_TIMEOUT_MS) {
        endSession('idle');
        return;
      }
      if (idle >= IDLE_WARNING_MS) {
        warningRef.current = true;
        setWarningMsLeft(IDLE_TIMEOUT_MS - idle);
        return;
      }
      // Active: keep the server-side activity record fresh (rate-limited, silent).
      if (now - lastBeatRef.current >= HEARTBEAT_INTERVAL_MS && idle < HEARTBEAT_INTERVAL_MS) {
        void heartbeat();
      }
    }, TICK_MS);

    return () => {
      window.clearInterval(tick);
      for (const evt of ACTIVITY_EVENTS) {
        window.removeEventListener(evt, onActivity, { capture: true });
      }
      window.removeEventListener('mousemove', onMove);
      document.removeEventListener('visibilitychange', onVisible);
      media.dispose();
      warningRef.current = false;
    };
  }, [status, userId, loginAt, markActivity, heartbeat, endSession]);

  if (status !== 'authenticated' || warningMsLeft === null) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="idle-guard-title"
        aria-describedby="idle-guard-body"
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"
      >
        <h2 id="idle-guard-title" className="text-lg font-bold text-slate-900">
          Still there?
        </h2>
        <p id="idle-guard-body" className="mt-2 text-sm leading-6 text-slate-600">
          For your patients&apos; privacy you will be signed out in{' '}
          <span className="font-semibold tabular-nums text-slate-900">
            {formatCountdown(warningMsLeft)}
          </span>
          .
        </p>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={() => endSession('manual')}>
            Sign out
          </Button>
          <Button autoFocus onClick={staySignedIn}>
            Stay signed in
          </Button>
        </div>
      </div>
    </div>
  );
}
