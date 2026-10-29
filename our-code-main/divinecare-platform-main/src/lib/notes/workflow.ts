import { apiJson } from '@/lib/api-client';

export type ProgressNoteStatus = 'Draft' | 'Signed' | 'Locked';

export interface LockedNoteSnapshot {
  noteId: string;
  clientId: string;
  clientName: string;
  clientImage: string | null;
  clinicianName: string | null;
  clinicianImage: string | null;
  body: string;
  createdAt: string;
  lockedAt: string;
}

export async function updateProgressNoteStatus(
  noteId: string,
  status: Exclude<ProgressNoteStatus, 'Draft'>,
  opts?: { riskAttestationReason?: string | null }
): Promise<{ status: ProgressNoteStatus; exceptionLabel?: string | null }> {
  const data = await apiJson<{
    success: true;
    status: ProgressNoteStatus;
    exceptionLabel?: string | null;
  }>(`/api/ehr/notes/${noteId}/workflow`, {
    method: 'PATCH',
    body: JSON.stringify({
      status,
      ...(opts?.riskAttestationReason ? { riskAttestationReason: opts.riskAttestationReason } : {}),
    }),
  });
  return data;
}

export async function loadLockedNotes(): Promise<LockedNoteSnapshot[]> {
  const data = await apiJson<{ success: true; notes: LockedNoteSnapshot[] }>(
    '/api/billing/locked-notes'
  );
  return data.notes;
}
