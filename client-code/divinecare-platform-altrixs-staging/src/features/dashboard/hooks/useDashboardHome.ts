'use client';

import { useEffect, useState } from 'react';
import { apiJson } from '@/lib/api-client';
import { useLocation } from '@/context/LocationContext';
import type { DashboardHome } from '@/lib/dashboard/homeData';

type State = { data: DashboardHome | null; loading: boolean; error: string | null };

/** Several home widgets share one request: identical in-flight / recent reads are reused */
const cache = new Map<string, { at: number; promise: Promise<DashboardHome> }>();
const TTL_MS = 15_000;

function load(url: string): Promise<DashboardHome> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.promise;
  const promise = apiJson<{ success: true; home: DashboardHome }>(url).then((r) => r.home);
  cache.set(url, { at: Date.now(), promise });
  promise.catch(() => cache.delete(url));
  return promise;
}

/** GET /api/dashboard/home for the signed-in user, narrowed to the sidebar location when one is chosen */
export function useDashboardHome(): State {
  const { activeLocationId, isAllLocations } = useLocation();
  const [state, setState] = useState<State>({ data: null, loading: true, error: null });
  const url = `/api/dashboard/home${isAllLocations ? '' : `?location=${encodeURIComponent(activeLocationId)}`}`;

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    load(url)
      .then((data) => {
        if (!cancelled) setState({ data, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ data: null, loading: false, error: err instanceof Error ? err.message : 'Could not load the home dashboard' });
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return state;
}
