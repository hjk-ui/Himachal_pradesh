'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchRiskAlerts, reviewRiskAlert } from '../api/alertsApi';
import type { RiskAlert, RiskAlertSummary } from '../types';

const emptySummary: RiskAlertSummary = {
  high: 0,
  medium: 0,
  low: 0,
  totalUnreviewed: 0,
  total: 0,
};

export function useAlerts() {
  const [alerts, setAlerts] = useState<RiskAlert[]>([]);
  const [summary, setSummary] = useState<RiskAlertSummary>(emptySummary);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchRiskAlerts();
      setAlerts(data.alerts);
      setSummary(data.summary);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load alerts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const markReviewed = async (id: string, note?: string) => {
    try {
      const updated = await reviewRiskAlert(id, note);
      setAlerts((prev) => prev.map((a) => (a.id === id ? updated : a)));
      setSummary((prev) => ({
        ...prev,
        totalUnreviewed: Math.max(0, prev.totalUnreviewed - 1),
        high:
          updated.severity === 'high'
            ? Math.max(0, prev.high - 1)
            : prev.high,
        medium:
          updated.severity === 'medium'
            ? Math.max(0, prev.medium - 1)
            : prev.medium,
        low: updated.severity === 'low' ? Math.max(0, prev.low - 1) : prev.low,
      }));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not review alert');
      throw err;
    }
  };

  return { alerts, summary, loading, error, reload, markReviewed, setAlerts };
}
