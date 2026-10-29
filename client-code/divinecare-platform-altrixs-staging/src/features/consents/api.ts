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

export async function fetchConsents(clientId?: string) {
  const q = clientId ? `?clientId=${encodeURIComponent(clientId)}` : '';
  const data = await apiJson<{ success: true; consents: ConsentItem[] }>(`/api/consents${q}`);
  return data.consents;
}

// Creating / signing / resending simple consent records is retired (src/lib/consents/manage.ts):
// consents are sent and signed through the consent library (/api/consents/library, /api/consents/worklist).
