import { apiJson } from '@/lib/api-client';

export type ProgressNoteStatus = 'Draft' | 'Signed' | 'Locked';

export interface LockedNoteSnapshot {
  noteId: string;
  clientId: string;
  clientName: string;
  clientImage: string | null;
  clinicianName: string | null;
  clinicianImage: string | null;
  /** Not sent by /api/billing/locked-notes (metadata only); kept optional for older callers */
  body?: string;
  createdAt: string;
  lockedAt: string;
}

export async function updateProgressNoteStatus(
  noteId: string,
  status: Exclude<ProgressNoteStatus, 'Draft'>,
  /** Signing requires the clinician to have confirmed the attestation */
  opts: { attested?: boolean; lateEntryReason?: string; riskAttestation?: string } = {}
): Promise<{
  status: ProgressNoteStatus;
  /** Signed for a pre-licensed / program author: waits for the supervisor's co-signature */
  cosignRequired?: boolean;
  /** Claim drafted from the note at signing (or why not); null when no new signature was applied */
  claim?: { claimId: string | null; claimStatus: string | null; message: string } | null;
}> {
  const data = await apiJson<{
    success: true;
    status: ProgressNoteStatus;
    cosignRequired?: boolean;
    claim?: { claimId: string | null; claimStatus: string | null; message: string } | null;
  }>(
    `/api/ehr/notes/${noteId}/workflow`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        status,
        attested: opts.attested === true,
        ...(opts.lateEntryReason?.trim() ? { lateEntryReason: opts.lateEntryReason.trim() } : {}),
        ...(opts.riskAttestation?.trim() ? { riskAttestation: opts.riskAttestation.trim() } : {}),
      }),
    }
  );
  return data;
}

export async function loadLockedNotes(): Promise<LockedNoteSnapshot[]> {
  const data = await apiJson<{ success: true; notes: LockedNoteSnapshot[] }>(
    '/api/billing/locked-notes'
  );
  return data.notes;
}
