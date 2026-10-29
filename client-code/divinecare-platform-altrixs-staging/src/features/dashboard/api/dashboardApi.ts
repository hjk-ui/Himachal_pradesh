import type { DashboardOverview } from '../types';

const EMPTY_OVERVIEW: DashboardOverview = {
  stats: [],
  alerts: [],
  appointments: [],
  clients: [],
  weekly: [],
  riskBreakdown: [],
};

/** Home dashboard aggregates — live from Postgres when authenticated */
export async function fetchDashboardOverview(): Promise<DashboardOverview> {
  const res = await fetch('/api/dashboard/overview', {
    method: 'GET',
    cache: 'no-store',
  });

  if (!res.ok) {
    const err = new Error(`Dashboard overview failed (${res.status})`);
    (err as Error & { empty?: DashboardOverview }).empty = EMPTY_OVERVIEW;
    throw err;
  }

  const json = (await res.json()) as { success: boolean; data?: DashboardOverview; error?: string };
  if (!json.success || !json.data) {
    throw new Error(json.error || 'Dashboard overview unavailable');
  }
  return json.data;
}
