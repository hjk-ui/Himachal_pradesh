'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiJson } from '@/lib/api-client';
import type { InboxSummary } from '@/lib/inbox/types';

export const INBOX_REFRESH_MS = 60_000;

/**
 * Inbox counts from GET /api/inbox/summary, refreshed every 60s while the tab is visible
 * (and right away when it becomes visible again). `total` counts each item once.
 */
export function useInboxCounts(opts: { enabled?: boolean; intervalMs?: number } = {}) {
  const { enabled = true, intervalMs = INBOX_REFRESH_MS } = opts;
  const [summary, setSummary] = useState<InboxSummary | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const data = await apiJson<{ success: true; summary: InboxSummary }>('/api/inbox/summary');
      setSummary(data.summary);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not load inbox counts');
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let timer: number | null = null;
    const start = () => {
      if (timer == null) timer = window.setInterval(() => void refresh(), intervalMs);
    };
    const stop = () => {
      if (timer != null) window.clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void refresh();
        start();
      } else {
        stop();
      }
    };
    void refresh();
    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, intervalMs, refresh]);

  return {
    summary,
    total: summary?.total ?? 0,
    urgent: summary?.urgent ?? 0,
    sections: summary?.sections ?? [],
    loading,
    error,
    refresh,
  };
}
