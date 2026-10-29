import { apiJson } from '@/lib/api-client';

const STORAGE_PREFIX = 'altrixs.telehealth.join.';

export async function getOrCreateJoinToken(appointmentId: string, clientId: string) {
  if (typeof window !== 'undefined') {
    try {
      const stored = sessionStorage.getItem(STORAGE_PREFIX + appointmentId);
      if (stored) {
        const check = await fetch(`/api/telehealth/join/${stored}`);
        if (check.ok) return stored;
      }
    } catch {
      // mint a new token
    }
  }

  const data = await apiJson<{ success: true; token: string }>(`/api/telehealth/token`, {
    method: 'POST',
    body: JSON.stringify({ appointmentId, clientId }),
  });

  if (typeof window !== 'undefined') {
    try {
      sessionStorage.setItem(STORAGE_PREFIX + appointmentId, data.token);
    } catch {
      // ignore
    }
  }
  return data.token;
}
