import { apiJson } from '@/lib/api-client';
import type {
  CreateSessionInput,
  TelehealthSession,
  TelehealthSettings,
  TelehealthStats,
  TeleSessionStatus,
} from './types';

export async function fetchTelehealthSessions(
  scope: 'today' | 'upcoming' | 'history' | 'all' = 'all'
): Promise<{ sessions: TelehealthSession[]; stats: TelehealthStats }> {
  const data = await apiJson<{
    success: true;
    sessions: TelehealthSession[];
    stats: TelehealthStats;
  }>(`/api/telehealth/sessions?scope=${scope}`);
  return { sessions: data.sessions, stats: data.stats };
}

export async function fetchTelehealthStats(): Promise<TelehealthStats> {
  const data = await apiJson<
    TelehealthStats & { success: true; stats?: TelehealthStats }
  >('/api/telehealth/stats');
  return (
    data.stats ?? {
      sessionsToday: data.sessionsToday,
      sessionsWeek: data.sessionsWeek,
      avgDuration: data.avgDuration,
      satisfaction: data.satisfaction,
    }
  );
}

export async function fetchTelehealthSettings(): Promise<TelehealthSettings> {
  const data = await apiJson<{ success: true; settings: TelehealthSettings }>(
    '/api/telehealth/settings'
  );
  return data.settings;
}

export async function saveTelehealthSettings(
  settings: Partial<TelehealthSettings>
): Promise<TelehealthSettings> {
  const data = await apiJson<{ success: true; settings: TelehealthSettings }>(
    '/api/telehealth/settings',
    { method: 'PUT', body: JSON.stringify(settings) }
  );
  return data.settings;
}

export async function createTelehealthSession(
  input: CreateSessionInput
): Promise<TelehealthSession> {
  const data = await apiJson<{ success: true; session: TelehealthSession }>(
    '/api/telehealth/sessions',
    { method: 'POST', body: JSON.stringify(input) }
  );
  return data.session;
}

export async function patchTelehealthSession(
  id: string,
  patch: {
    status?: TeleSessionStatus;
    notesSummary?: string | null;
    rating?: number | null;
  }
): Promise<TelehealthSession> {
  const data = await apiJson<{ success: true; session: TelehealthSession }>(
    `/api/telehealth/sessions/${id}`,
    { method: 'PATCH', body: JSON.stringify(patch) }
  );
  return data.session;
}

export async function sendTelehealthLink(id: string): Promise<{
  joinUrl: string;
  sentTo: string;
  emailMode: 'smtp' | 'console';
}> {
  const data = await apiJson<{
    success: true;
    joinUrl: string;
    link: string;
    sentTo: string;
    emailMode: 'smtp' | 'console';
  }>(`/api/telehealth/sessions/${id}/send-link`, { method: 'POST' });
  return {
    joinUrl: data.joinUrl || data.link,
    sentTo: data.sentTo,
    emailMode: data.emailMode,
  };
}
