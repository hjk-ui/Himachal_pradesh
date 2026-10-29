import { apiJson } from '@/lib/api-client';
import type {
  Client,
  ClientCheckIn,
  ClientProgressNote,
  CreateCheckInInput,
  CreateClientInput,
  EhrProgressNote,
  UpdateClientInput,
  UpdateClientInsuranceInput,
} from '../types';

const MAX_CLIENT_AVATAR_BYTES = 10 * 1024 * 1024;
const ALLOWED_CLIENT_AVATAR_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

/** Live Postgres list — Phase 2 (not Firestore). Caseload roles are assigned-only. */
export async function fetchClients(_scope?: 'prescribe'): Promise<Client[]> {
  const data = await apiJson<{ success: true; clients: Client[] }>('/api/clients');
  return Array.isArray(data?.clients) ? data.clients : [];
}

export type FetchClientsPagedResult = {
  clients: Client[];
  total: number;
  page: number;
  totalPages: number;
  limit: number;
};

export async function fetchClientsPaged(params?: {
  page?: number;
  limit?: number;
  search?: string;
  scope?: 'prescribe';
}): Promise<FetchClientsPagedResult> {
  const query = new URLSearchParams();
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.search) query.set('q', params.search);
  const qs = query.toString();
  const url = qs ? `/api/clients?${qs}` : '/api/clients';
  const data = await apiJson<{
    success: true;
    clients: Client[];
    total?: number;
    page?: number;
    totalPages?: number;
    limit?: number;
  }>(url);
  const clients = Array.isArray(data?.clients) ? data.clients : [];
  return {
    clients,
    total: typeof data?.total === 'number' ? data.total : clients.length,
    page: data?.page || 1,
    totalPages: data?.totalPages || 1,
    limit: data?.limit || clients.length || 250,
  };
}

export async function createClient(input: CreateClientInput) {
  const payload: CreateClientInput = {
    ...input,
    assignedToId: input.assignedToId?.trim() ? input.assignedToId.trim() : null,
    locationId: input.locationId?.trim() ? input.locationId.trim() : null,
  };
  const data = await apiJson<{
    success: true;
    client: Partial<Client>;
    appInvite?: { invited: boolean; emailMode?: string; error?: string };
  }>('/api/clients', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return { client: data.client, appInvite: data.appInvite };
}

export async function fetchClient(id: string): Promise<Client | undefined> {
  const data = await apiJson<{ success: true; client: Client }>(`/api/clients/${id}`);
  return data.client as Client;
}

export async function fetchClientNotes(id: string): Promise<ClientProgressNote[]> {
  const data = await apiJson<{ success: true; notes: ClientProgressNote[] }>(
    `/api/clients/${id}/notes`
  );
  return data.notes;
}

export async function fetchEhrProgressNotes(opts?: {
  includeDismissed?: boolean;
}): Promise<{
  notes: EhrProgressNote[];
  stats: { today: number; unsigned: number; thisWeek: number; total: number };
}> {
  const q = opts?.includeDismissed ? '?includeDismissed=1' : '';
  const data = await apiJson<{
    success: true;
    notes: EhrProgressNote[];
    stats?: { today: number; unsigned: number; thisWeek: number; total: number };
  }>(`/api/ehr/notes${q}`);
  return {
    notes: data.notes,
    stats: data.stats ?? {
      today: 0,
      unsigned: 0,
      thisWeek: 0,
      total: data.notes.length,
    },
  };
}

export async function createClientNote(id: string, body: string): Promise<ClientProgressNote> {
  const data = await apiJson<{ success: true; note: ClientProgressNote }>(
    `/api/clients/${id}/notes`,
    {
      method: 'POST',
      body: JSON.stringify({ body }),
    }
  );
  return data.note;
}

export async function updateClientStatus(
  id: string,
  status: 'ACTIVE' | 'INACTIVE' | 'DISCHARGED'
) {
  const data = await apiJson<{ success: true; client: { id: string; status: string } }>(
    `/api/clients/${id}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }
  );
  return data.client;
}

export async function updateClientInsurance(id: string, input: UpdateClientInsuranceInput) {
  const data = await apiJson<{
    success: true;
    client: {
      id: string;
      insurancePayer: string | null;
      insuranceMemberId: string | null;
      insuranceGroupNumber: string | null;
    };
  }>(`/api/clients/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return data.client;
}

export async function updateClient(id: string, input: UpdateClientInput) {
  const data = await apiJson<{
    success: true;
    client: Partial<Client>;
    portalSyncNotice?: { synced: boolean; inviteSent: boolean; message?: string } | null;
  }>(`/api/clients/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return Object.assign(data.client, { portalSyncNotice: data.portalSyncNotice });
}

export async function sendPortalInvite(id: string) {
  const data = await apiJson<{
    success: boolean;
    message?: string;
    email?: string;
    error?: string;
  }>(`/api/clients/${id}/invite`, {
    method: 'POST',
  });
  return data;
}

export async function updateClientTreatmentTeam(
  id: string,
  treatmentTeam: NonNullable<Client['treatmentTeam']>,
  assignedToId?: string | null
) {
  const data = await apiJson<{
    success: true;
    client: {
      id: string;
      assignedToId: string | null;
      treatmentTeam: Client['treatmentTeam'];
    };
  }>(`/api/clients/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      treatmentTeam,
      ...(assignedToId !== undefined ? { assignedToId } : {}),
    }),
  });
  return data.client;
}

export async function markClientHieQueried(id: string) {
  const data = await apiJson<{
    success: true;
    client: { id: string; hieLastQueryAt: string | null };
  }>(`/api/clients/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ hieLastQueryAt: new Date().toISOString() }),
  });
  return data.client;
}

export async function createClientCheckIn(id: string, input: CreateCheckInInput) {
  const data = await apiJson<{
    success: true;
    checkIn: ClientCheckIn & { id: string; dateLabel?: string };
    client: {
      checkInStreak: number;
      riskLevel: 'HIGH' | 'MEDIUM' | 'LOW';
      avgMood: number | null;
      avgStress: number | null;
      avgSleep: number | null;
    };
  }>(`/api/clients/${id}/check-ins`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return data;
}

export async function uploadClientAvatar(id: string, file: File) {
  if (!ALLOWED_CLIENT_AVATAR_TYPES.has(file.type)) {
    throw new Error('Use JPG, PNG, WEBP, or GIF');
  }

  if (file.size > MAX_CLIENT_AVATAR_BYTES) {
    throw new Error('Image must be under 10MB');
  }

  const body = new FormData();
  body.append('avatar', await shrinkClientPhoto(file), 'photo.jpg');

  const res = await fetch(`/api/clients/${id}/avatar`, {
    method: 'POST',
    body,
  });
  const text = await res.text();
  let data: { success?: boolean; client?: { id: string; image: string | null }; error?: string };
  try {
    data = JSON.parse(text) as typeof data;
  } catch {
    throw new Error(
      'Photo did not reach the upload API (server sent a web page, not JSON). Use a smaller JPG, then try again.'
    );
  }

  if (!res.ok || !data.success || !data.client) {
    throw new Error(data.error || 'Could not upload client photo');
  }

  return data.client;
}

async function shrinkClientPhoto(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const size = 400;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    const scale = Math.max(size / bitmap.width, size / bitmap.height);
    const w = bitmap.width * scale;
    const h = bitmap.height * scale;
    ctx.drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((next) => resolve(next), 'image/jpeg', 0.85);
    });
    return blob || file;
  } catch {
    return file;
  }
}

export async function removeClientAvatar(id: string) {
  const data = await apiJson<{ success: true; client: { id: string; image: string | null } }>(
    `/api/clients/${id}/avatar`,
    { method: 'DELETE' }
  );

  return data.client;
}
