'use client';

import { useEffect, useState } from 'react';
import type { CaseloadCountsResponse, StaffCaseloadCount } from '@/lib/clients/caseloadCounts';

/**
 * Server caseload counts (GET /api/clients/caseload-counts) across every active client in scope.
 * Never computed from the loaded page of the client list. `counts` is null while loading or
 * when the role may not see them (403): callers then show no number rather than a wrong one.
 */
export function useCaseloadCounts(opts: { locationId?: string; enabled?: boolean; reloadKey?: number } = {}) {
  const { locationId, enabled = true, reloadKey = 0 } = opts;
  const [data, setData] = useState<CaseloadCountsResponse | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const qs = locationId ? `?locationId=${encodeURIComponent(locationId)}` : '';
    fetch(`/api/clients/caseload-counts${qs}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.success) throw new Error(body.error || 'Could not load caseload counts');
        return body as CaseloadCountsResponse;
      })
      .then((body) => {
        if (!cancelled) setData({ counts: body.counts ?? {}, unassigned: body.unassigned ?? 0, activeTotal: body.activeTotal ?? 0 });
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setData(null);
          setError(err.message);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [locationId, enabled, reloadKey]);

  return {
    counts: data?.counts ?? null,
    unassigned: data?.unassigned ?? null,
    activeTotal: data?.activeTotal ?? null,
    loading,
    error,
  };
}

export type { StaffCaseloadCount };
