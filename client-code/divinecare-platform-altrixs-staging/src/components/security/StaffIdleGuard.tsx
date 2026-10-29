'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getCsrfToken, signOut, useSession } from 'next-auth/react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { hasLiveMedia } from '@/lib/client/liveMedia';
import {
  ABSOLUTE_SESSION_MS,
  ACTIVITY_HEARTBEAT_MS,
  IDLE_TIMEOUT_MS,
  IDLE_WARNING_MS,
} from '@/lib/auth/sessionPolicy';

const SHARED_KEY = 'altrixs:lastActivity';
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'mousemove', 'scroll'] as const;

function readShared(): number {
  try {
    return Number(window.localStorage.getItem(SHARED_KEY)) || 0;
  } catch {
    return 0;
  }
}

/**
 * Activity heartbeat: re-issues the session cookie (the server's 15-minute idle check reads it) WITHOUT
 * useSession().update(). update() flips the whole app to status "loading" and swaps the session
 * object, so every screen that waits on sign-in blinked and refetched once a minute while in use.
 * Returns false only when the server says the session is gone.
 */
async function silentActivityBeat(): Promise<boolean> {
  const csrfToken = await getCsrfToken();
  const res = await fetch('/api/auth/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ csrfToken, data: { activity: true } }),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`session heartbeat ${res.status}`);
  const session = (await res.json().catch(() => null)) as { user?: unknown } | null;
  return Boolean(session && session.user);
}

function writeShared(ms: number) {
  try {
    window.localStorage.setItem(SHARED_KEY, String(ms));
  } catch {
    // private mode / storage blocked: this tab still tracks its own activity
  }
}

/**
 * Staff automatic logoff (HIPAA 164.312(a)(2)(iii)): 15 minutes without activity -> "Still there?"
 * at 14:00 with a 60-second countdown -> sign-out. Activity in any open Altrixs tab counts, and so
 * does a live microphone / camera (telehealth call, AI scribe recording). While active, the session
 * is refreshed at most once a minute (silentActivityBeat), which the server's 15-minute idle
 * check reads; the server also ends every session 12 hours after sign-in.
 */
export function StaffIdleGuard() {
  const { status, data } = useSession();
  // Set when the timer starts (page load counts as activity)
  const lastInput = useRef(0);
  const lastBeat = useRef(0);
  const lastShared = useRef(0);
  const signingOut = useRef(false);
  const warningOpen = useRef(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const authTime = typeof data?.authTime === 'number' ? data.authTime : null;

  const end = useCallback((reason: 'idle' | 'expired') => {
    if (signingOut.current) return;
    signingOut.current = true;
    void signOut({ redirectTo: `/login?reason=${reason}` });
  }, []);

  const beat = useCallback(() => {
    lastBeat.current = Date.now();
    void silentActivityBeat()
      .then((alive) => {
        if (!alive) end('idle');
      })
      .catch(() => {
        // network blip: the next beat retries; the server still enforces the limits
      });
  }, [end]);

  const markActive = useCallback((now = Date.now()) => {
    lastInput.current = now;
    if (now - lastShared.current > 5000) {
      lastShared.current = now;
      writeShared(now);
    }
  }, []);

  useEffect(() => {
    if (status !== 'authenticated') return;
    const started = Date.now();
    if (lastInput.current < started - IDLE_TIMEOUT_MS) lastInput.current = started;
    if (!lastBeat.current) lastBeat.current = started;
    const onActivity = () => {
      // While "Still there?" is open only its button counts, so a stray mouse move cannot dismiss it
      if (!warningOpen.current) markActive();
    };
    for (const ev of ACTIVITY_EVENTS) window.addEventListener(ev, onActivity, { passive: true, capture: true });
    const onStorage = (e: StorageEvent) => {
      if (e.key === SHARED_KEY && e.newValue) {
        const ms = Number(e.newValue);
        if (ms > lastInput.current) lastInput.current = ms;
      }
    };
    window.addEventListener('storage', onStorage);

    const timer = window.setInterval(() => {
      if (signingOut.current) return;
      const now = Date.now();
      if (authTime !== null && now - authTime >= ABSOLUTE_SESSION_MS) {
        end('expired');
        return;
      }
      if (hasLiveMedia()) markActive(now);
      const shared = readShared();
      if (shared > lastInput.current) lastInput.current = shared;
      const idle = now - lastInput.current;
      if (idle >= IDLE_TIMEOUT_MS) {
        end('idle');
        return;
      }
      if (idle >= IDLE_TIMEOUT_MS - IDLE_WARNING_MS) {
        warningOpen.current = true;
        setSecondsLeft(Math.max(1, Math.ceil((IDLE_TIMEOUT_MS - idle) / 1000)));
      } else if (warningOpen.current) {
        // Activity in another tab or a live call ended the idle period
        warningOpen.current = false;
        setSecondsLeft(null);
      }
      if (lastInput.current > lastBeat.current && now - lastBeat.current >= ACTIVITY_HEARTBEAT_MS) beat();
    }, 1000);

    return () => {
      for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, onActivity, { capture: true });
      window.removeEventListener('storage', onStorage);
      window.clearInterval(timer);
    };
  }, [status, authTime, markActive, beat, end]);

  if (secondsLeft === null) return null;
  return (
    <ConfirmDialog
      title="Still there?"
      confirmLabel="Stay signed in"
      cancelLabel="Sign out"
      onConfirm={() => {
        warningOpen.current = false;
        setSecondsLeft(null);
        markActive();
        lastShared.current = 0;
        writeShared(Date.now());
        beat();
      }}
      onCancel={() => end('idle')}
    >
      For your security, you will be signed out in {secondsLeft} second{secondsLeft === 1 ? '' : 's'} because
      there has been no activity for almost 15 minutes.
    </ConfirmDialog>
  );
}
