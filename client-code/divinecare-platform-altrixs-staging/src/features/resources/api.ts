'use client';

import { apiJson } from '@/lib/api-client';
import type { AssignmentDto, ResourceItemDto } from '@/lib/resources/types';

export type LibraryResponse = {
  items: ResourceItemDto[];
  recent: string[];
  seededCount: number;
  /** MDH AOT resources (drafts needing a link) not yet added */
  aotSeedMissing?: number;
  canManage: boolean;
  canReview: boolean;
  canAssign: boolean;
};

export const fetchLibrary = (scope: 'patient' | 'staff') => apiJson<LibraryResponse>(`/api/resources/items?scope=${scope}`);

export const saveItem = (id: string | null, body: Record<string, unknown>) =>
  id
    ? apiJson<{ item: ResourceItemDto }>(`/api/resources/items/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) })
    : apiJson<{ item: ResourceItemDto }>('/api/resources/items', { method: 'POST', body: JSON.stringify(body) });

export async function uploadItemFile(id: string, file: File) {
  const form = new FormData();
  form.append('file', file);
  return apiJson<{ item: ResourceItemDto }>(`/api/resources/items/${encodeURIComponent(id)}/file`, { method: 'POST', body: form });
}

export const setFavorite = (id: string, favorite: boolean) =>
  apiJson<{ favorite: boolean }>(`/api/resources/items/${encodeURIComponent(id)}/favorite`, { method: 'PUT', body: JSON.stringify({ favorite }) });

/** Records "recently used" + an audit view row. Fire and forget. */
export function markUsed(id: string) {
  void fetch(`/api/resources/items/${encodeURIComponent(id)}/used`, { method: 'POST' }).catch(() => undefined);
}

export const seedStarter = () => apiJson<{ items: number; community: number; aotDrafts?: number }>('/api/resources/seed', { method: 'POST' });

export const fetchAssignments = (q: { clientId?: string; mine?: boolean }) => {
  const sp = new URLSearchParams();
  if (q.clientId) sp.set('clientId', q.clientId);
  if (q.mine) sp.set('mine', '1');
  return apiJson<{ assignments: AssignmentDto[]; canAssign?: boolean; hiddenProtected?: number }>(`/api/resources/assignments?${sp}`);
};

export const assignResource = (body: {
  itemId: string;
  clientId: string;
  message?: string | null;
  dueDate?: string | null;
  context?: string;
  contextId?: string | null;
  sudContext?: boolean;
}) => apiJson<{ assignment: AssignmentDto }>('/api/resources/assignments', { method: 'POST', body: JSON.stringify(body) });

export const withdrawAssignment = (id: string) =>
  apiJson<{ assignment: AssignmentDto }>(`/api/resources/assignments/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ action: 'withdraw' }) });

/** Staff download of a practice file (audited server-side). */
export async function downloadItemFile(item: Pick<ResourceItemDto, 'id' | 'fileName'>) {
  const res = await fetch(`/api/resources/items/${encodeURIComponent(item.id)}/file`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || 'Could not download the file');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = item.fileName || 'resource';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
