import type { RiskAlert, RiskAlertSummary } from '../types';
import { apiJson } from '@/lib/api-client';

export async function fetchRiskAlerts(unreviewed?: boolean): Promise<{
  alerts: RiskAlert[];
  summary: RiskAlertSummary;
}> {
  const q =
    unreviewed === true ? '?unreviewed=true' : unreviewed === false ? '?unreviewed=false' : '';
  const res = await apiJson<{
    success: true;
    alerts: RiskAlert[];
    summary: RiskAlertSummary;
  }>(`/api/risk-alerts${q}`);
  return { alerts: res.alerts, summary: res.summary };
}

export async function fetchRiskAlertSummary(): Promise<RiskAlertSummary> {
  const res = await apiJson<{ success: true } & RiskAlertSummary>('/api/risk-alerts/summary');
  return {
    high: res.high,
    medium: res.medium,
    low: res.low,
    totalUnreviewed: res.totalUnreviewed,
    total: res.total,
  };
}

export async function reviewRiskAlert(id: string, note?: string): Promise<RiskAlert> {
  const data = await apiJson<{ success: true; alert: RiskAlert }>(
    `/api/risk-alerts/${id}/review`,
    {
      method: 'PATCH',
      body: JSON.stringify({ note: note ?? null }),
    }
  );
  return data.alert;
}
