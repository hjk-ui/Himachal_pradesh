'use client';

import { useEffect, useState } from 'react';
import { fetchDashboardOverview } from '../api/dashboardApi';
import type { DashboardOverview } from '../types';

const EMPTY: DashboardOverview = {
  stats: [],
  alerts: [],
  appointments: [],
  clients: [],
  weekly: [],
  riskBreakdown: [],
};

type Options = {
  enabled?: boolean;
};

export function useDashboardOverview(options: Options = {}) {
  const enabled = options.enabled !== false;
  const [data, setData] = useState<DashboardOverview | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      setData(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchDashboardOverview()
      .then((overview) => {
        if (!cancelled) {
          setError(null);
          setData(overview);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message || 'Failed to load dashboard');
          setData(EMPTY);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { data, loading, error };
}
