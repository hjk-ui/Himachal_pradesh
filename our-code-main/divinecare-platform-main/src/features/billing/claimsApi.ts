import { apiJson } from '@/lib/api-client';

export type ClaimDbStatus = 'DRAFT' | 'READY' | 'SUBMITTED' | 'ACCEPTED' | 'DENIED' | 'PAID';

export type ClaimRecord = {
  availityClaimId?: string | null;
  clearinghouseClaimId?: string | null;
  clearinghouseProvider?: string | null;
  submissionInProgress?: boolean;
  submissionError?: string | null;
  clearinghouseDemo?: boolean;
  submissionData?: { payerId: string; diagnosisCodes: string[]; placeOfService: string; claimFilingCode: 'MC' | 'MB' | 'BL' | 'CI' } | null;

  id: string;
  displayId: string;
  clientId: string;
  clientName: string;
  clinicianName: string | null;
  appointmentId: string | null;
  progressNoteId: string | null;
  cptCode: string;
  cptDescription: string;
  units: number;
  amountCents: number | null;
  payer: string | null;
  status: ClaimDbStatus;
  uiStatus: 'approved' | 'pending' | 'denied';
  denialReason: string | null;
  serviceDate: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function fetchClaims(opts?: { status?: ClaimDbStatus; q?: string }) {
  const params = new URLSearchParams();
  if (opts?.status) params.set('status', opts.status);
  if (opts?.q?.trim()) params.set('q', opts.q.trim());
  const qs = params.toString();
  const data = await apiJson<{ success: true; claims: ClaimRecord[] }>(
    `/api/billing/claims${qs ? `?${qs}` : ''}`
  );
  return data.claims;
}

export async function generateClaimFromNote(
  noteId: string,
  opts?: { cptCode?: string; markReady?: boolean }
) {
  const data = await apiJson<{ success: true; claim: ClaimRecord; alreadyExisted?: boolean }>(
    '/api/billing/claims/from-note',
    {
      method: 'POST',
      body: JSON.stringify({
        noteId,
        cptCode: opts?.cptCode,
        markReady: opts?.markReady,
      }),
    }
  );
  return data.claim;
}

export async function generateClaimFromAppointment(appointmentId: string) {
  const data = await apiJson<{ success: true; claim: ClaimRecord; alreadyExisted?: boolean }>(
    '/api/billing/claims/from-note',
    { method: 'POST', body: JSON.stringify({ appointmentId }) }
  );
  return data.claim;
}

export async function createManualClaim(input: {
  clientId: string;
  cptCode: string;
  diagnosisCodes: string[];
  placeOfService?: string;
  units?: number;
  modifiers?: string[];
  telehealth?: boolean;
  payer?: string | null;
  memberId?: string | null;
  serviceDate?: string | null;
  clinicianLabel?: string | null;
  markReady?: boolean;
}) {
  const data = await apiJson<{ success: true; claim: ClaimRecord }>('/api/billing/claims', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return data.claim;
}

export async function patchClaimStatus(id: string, status: ClaimDbStatus, denialReason?: string | null) {
  const data = await apiJson<{ success: true; claim: ClaimRecord }>(`/api/billing/claims/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status, denialReason }),
  });
  return data.claim;
}
