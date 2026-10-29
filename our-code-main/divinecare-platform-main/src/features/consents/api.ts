import { apiJson } from '@/lib/api-client';

export type ConsentStatus = 'pending' | 'signed' | 'expired' | 'declined';

export type ConsentItem = {
  id: string;
  clientId: string;
  clientName: string;
  type: string;
  status: ConsentStatus;
  method: string;
  sentAt: string;
  signedAt: string | null;
  expiresAt: string | null;
  signedByName: string | null;
  notes: string | null;
};

export type CreateConsentInput = {
  clientId: string;
  types: string[];
  method?: string;
  notes?: string | null;
};

export async function fetchConsents(clientId?: string) {
  const q = clientId ? `?clientId=${encodeURIComponent(clientId)}` : '';
  const data = await apiJson<{ success: true; consents: ConsentItem[] }>(`/api/consents${q}`);
  return data.consents;
}

export async function createConsents(input: CreateConsentInput) {
  const data = await apiJson<{ success: true; consents: ConsentItem[] }>('/api/consents', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return data.consents;
}

export async function signConsent(id: string, signedByName?: string) {
  const data = await apiJson<{ success: true; consent: ConsentItem }>(
    `/api/consents/${id}/sign`,
    {
      method: 'POST',
      body: JSON.stringify({ signedByName: signedByName || null }),
    }
  );
  return data.consent;
}

export async function declineConsent(id: string) {
  const data = await apiJson<{ success: true; consent: ConsentItem }>(
    `/api/consents/${id}/decline`,
    { method: 'POST' }
  );
  return data.consent;
}

export async function resendConsent(id: string) {
  const data = await apiJson<{ success: true; consent: ConsentItem }>(
    `/api/consents/${id}/resend`,
    { method: 'POST' }
  );
  return data.consent;
}
