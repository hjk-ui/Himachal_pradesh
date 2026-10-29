'use client';

import { useEffect } from 'react';
import toast from 'react-hot-toast';
import { dispatchDrFirstSynced } from '@/lib/drfirst/openRcopiaClient';

/** A tab hidden for less than this (a quick alt-tab) is not treated as a trip to DrFirst. */
const MIN_HIDDEN_MS = 3_000;

/**
 * Return from DrFirst: when the prescriber comes back to this tab (it becomes visible after being
 * hidden for 3 s or more), POST /api/drfirst/sync/return refreshes the chart of the patient they last
 * opened in Rcopia, so the chart shows what they just did there (DrFirst: "when you close the
 * screen"). Open charts and the E-Prescribing page reload on the 'altrixs:drfirst-synced' event.
 * Errors are silent: the practice-wide sync still catches up within 5 minutes.
 */
export function DrFirstReturnSync() {
  useEffect(() => {
    let hiddenAt: number | null = document.visibilityState === 'hidden' ? Date.now() : null;

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        return;
      }
      const away = hiddenAt === null ? 0 : Date.now() - hiddenAt;
      hiddenAt = null;
      if (away < MIN_HIDDEN_MS) return;
      void refresh();
    };

    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  return null;
}

async function refresh() {
  try {
    const res = await fetch('/api/drfirst/sync/return', { method: 'POST', cache: 'no-store' });
    if (!res.ok) return;
    const data = (await res.json().catch(() => ({}))) as {
      synced?: boolean; clientId?: string; totals?: Record<string, number>; throttled?: boolean; retryAfterSeconds?: number;
    };
    if (!data.synced || !data.clientId) return;
    const totals = data.totals ?? {};
    const throttled = Boolean(data.throttled);
    dispatchDrFirstSynced({ clientId: data.clientId, totals, throttled });
    const changes = (totals.created || 0) + (totals.updated || 0);
    if (changes > 0) {
      toast.success(`Updated from DrFirst: ${changes} change${changes === 1 ? '' : 's'}.`);
    } else if (throttled) {
      const minutes = Math.max(1, Math.ceil((data.retryAfterSeconds || 0) / 60));
      toast(`DrFirst allows one refresh every 5 minutes for a patient; this chart updates again in about ${minutes} min.`);
    }
  } catch {
    /* silent: the practice-wide sync catches up */
  }
}
