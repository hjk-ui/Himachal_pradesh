import { apiJson } from '@/lib/api-client';

export type WaitlistStatus = 'waiting' | 'matched' | 'scheduled' | 'closed';
export type WaitlistUrgency = 'routine' | 'urgent' | 'crisis';

export type WaitlistEntry = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  specialty: string;
  urgency: WaitlistUrgency;
  status: WaitlistStatus;
  insurancePayer: string | null;
  referralSource: string | null;
  notes: string | null;
  preferredClinician: string | null;
  clinicianId: string | null;
  clinicianName: string | null;
  convertedClientId: string | null;
  matchedAt: string | null;
  convertedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  daysWaiting: number;
};

export type WaitlistClinician = {
  id: string;
  name: string;
  email: string;
  role: string;
  image: string | null;
};

export type CreateWaitlistInput = {
  name: string;
  email?: string | null;
  phone?: string | null;
  specialty: string;
  urgency?: WaitlistUrgency;
  insurancePayer?: string | null;
  referralSource?: string | null;
  notes?: string | null;
  preferredClinician?: string | null;
};

export async function fetchWaitlist() {
  return apiJson<{
    success: true;
    entries: WaitlistEntry[];
    clinicians: WaitlistClinician[];
  }>('/api/waitlist');
}

export async function createWaitlistEntry(input: CreateWaitlistInput) {
  const data = await apiJson<{ success: true; entry: WaitlistEntry }>('/api/waitlist', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return data.entry;
}

export async function updateWaitlistEntry(
  id: string,
  input: Partial<CreateWaitlistInput> & { status?: WaitlistStatus; action?: 'close' }
) {
  const data = await apiJson<{ success: true; entry: WaitlistEntry }>(`/api/waitlist/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return data.entry;
}

export async function matchWaitlistEntry(id: string, clinicianId: string) {
  const data = await apiJson<{ success: true; entry: WaitlistEntry }>(
    `/api/waitlist/${id}/match`,
    {
      method: 'POST',
      body: JSON.stringify({ clinicianId }),
    }
  );
  return data.entry;
}

export async function convertWaitlistEntry(id: string) {
  return apiJson<{
    success: true;
    entry: WaitlistEntry;
    client: { id: string; name: string };
  }>(`/api/waitlist/${id}/convert`, { method: 'POST' });
}

export async function convertWaitlistToIntake(id: string) {
  return apiJson<{
    success: true;
    invite: {
      id: string;
      token: string;
      clientName: string;
      clientEmail: string;
      status: string;
    };
    reused?: boolean;
  }>(`/api/waitlist/${id}/intake`, { method: 'POST' });
}

export async function closeWaitlistEntry(id: string) {
  return updateWaitlistEntry(id, { action: 'close', status: 'closed' });
}
