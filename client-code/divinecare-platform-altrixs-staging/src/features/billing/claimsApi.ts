import { apiJson } from '@/lib/api-client';

/** What a Waystar SFTP send stored on the claim (Claim.submissionData.waystarSftp). */
export type WaystarSftpClaimInfo = {
  batchId: string;
  fileName: string;
  s3Key: string;
  transferId: string;
  controlNumber: string;
  stControlNumber: string;
  sentAt: string;
  usageIndicator: 'T' | 'P';
  delivery: 'completed' | 'unconfirmed';
  deliveryNote?: string;
  responses?: Array<{ file: string; type: '999' | '277CA'; accepted: boolean | null; reason: string; at: string }>;
};

export type ClaimDbStatus = 'DRAFT' | 'READY' | 'SUBMITTED' | 'ACCEPTED' | 'DENIED' | 'PAID';

export type ClaimRecord = {
  availityClaimId?: string | null;
  clearinghouseClaimId?: string | null;
  clearinghouseProvider?: string | null;
  submissionInProgress?: boolean;
  submissionError?: string | null;
  clearinghouseDemo?: boolean;
  submissionData?: {
    payerId: string;
    diagnosisCodes: string[];
    placeOfService: string;
    claimFilingCode: 'MC' | 'MB' | 'BL' | 'CI';
    waystarSftp?: WaystarSftpClaimInfo;
    department?: string;
    correction?: { kind: 'replace' | 'void'; at: string; previousStatus: ClaimDbStatus };
  } | null;

  /** CLM01 sent to Waystar (<= 20 chars) */
  claimControlNumber?: string | null;
  /** 1 original, 7 corrected (replacement), 8 void */
  frequencyCode?: string;
  /** P primary, S secondary, T tertiary */
  payerResponsibility?: string;
  /** Payer ICN / DCN (from the 277CA or 835), sent as REF*F8 on corrected / void claims */
  payerClaimControlNumber?: string | null;
  primaryClaimId?: string | null;
  priorAuthNumber?: string | null;
  placeOfService?: string | null;
  billingNpi?: string | null;
  /** Waystar payer mapping for the claim's payer (null = unmapped) */
  waystarPayer?: { payerId: string; claimFilingCode: string; verified: boolean; payerName: string } | null;

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
  /** Staff user picked as rendering provider (server checks org + 10-digit NPI) */
  renderingUserId?: string | null;
  groupNumber?: string | null;
  markReady?: boolean;
  /** Every service line (line 1 mirrors cptCode/units/modifiers). */
  lines?: Array<{
    cptCode: string;
    modifiers?: string[];
    units: number;
    /** Total line charge in dollars */
    charge?: number | null;
    serviceDate?: string | null;
    diagnosisPointers?: number[];
  }>;
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

export type ClientInsurance = {
  payer: string | null;
  memberId: string | null;
  groupNumber: string | null;
  insuranceType: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
};

export async function fetchClientInsurance(clientId: string) {
  const data = await apiJson<{ success: true; insurance: ClientInsurance }>(
    `/api/billing/client-insurance?clientId=${encodeURIComponent(clientId)}`
  );
  return data.insurance;
}

export type RenderingProvider = { id: string; name: string; npi: string; title: string };

export async function fetchRenderingProviders() {
  const data = await apiJson<{ success: true; providers: RenderingProvider[] }>(
    '/api/billing/rendering-providers'
  );
  return Array.isArray(data.providers) ? data.providers : [];
}

// ─── Waystar outbound: corrections, secondary claims, COB, coverages ──────────

export async function startClaimCorrection(id: string, kind: 'replace' | 'void', payerClaimControlNumber?: string | null) {
  const data = await apiJson<{ success: true; claim: ClaimRecord }>(`/api/billing/claims/${id}/correction`, {
    method: 'POST',
    body: JSON.stringify({ kind, payerClaimControlNumber: payerClaimControlNumber || null }),
  });
  return data.claim;
}

export async function cancelClaimCorrection(id: string) {
  const data = await apiJson<{ success: true; claim: ClaimRecord }>(`/api/billing/claims/${id}/correction`, { method: 'DELETE' });
  return data.claim;
}

export async function createSecondaryClaim(id: string) {
  const data = await apiJson<{ success: true; claim: ClaimRecord }>(`/api/billing/claims/${id}/secondary`, { method: 'POST' });
  return data.claim;
}

export type CasAdjustmentInput = { group: 'CO' | 'CR' | 'OA' | 'PI' | 'PR'; reason: string; amount: number };

export type CobInput = {
  rank: 'P' | 'S';
  paidAmount: number;
  paidDate: string;
  adjustments: CasAdjustmentInput[];
  payerId?: string | null;
};

export type CobSource = {
  required: boolean;
  previousClaimId?: string | null;
  previousPayer?: string | null;
  previousStatus?: string | null;
  era?: { paidAmount: number; paidDate: string; adjustments: Array<{ group: string; reason: string; amount: number }>; lines?: unknown[] } | null;
  staff?: Record<string, { paidAmount: number; paidDate: string; adjustments: CasAdjustmentInput[]; payerId?: string | null }> | null;
};

export async function fetchClaimCob(id: string) {
  return apiJson<{ success: true } & CobSource>(`/api/billing/claims/${id}/cob`);
}

export async function saveClaimCob(id: string, input: CobInput) {
  const data = await apiJson<{ success: true; claim: ClaimRecord }>(`/api/billing/claims/${id}/cob`, { method: 'PUT', body: JSON.stringify(input) });
  return data.claim;
}

export type CoverageRecordUi = {
  rank: 'P' | 'S' | 'T';
  payerName: string | null;
  memberId: string | null;
  groupNumber: string | null;
  claimFilingCode: string | null;
  subscriberRelationship: string;
  subscriberFirstName: string | null;
  subscriberLastName: string | null;
  subscriberMiddleInitial: string | null;
  subscriberDob: string | null;
  subscriberGender: string | null;
  active: boolean;
};

export type ClaimCoverages = {
  primaryOnClient: { payerName: string | null; memberId: string | null; groupNumber: string | null; insuranceType: string | null };
  coverages: CoverageRecordUi[];
};

export async function fetchClaimCoverages(claimId: string) {
  return apiJson<{ success: true } & ClaimCoverages>(`/api/billing/claims/${claimId}/coverage`);
}

export async function saveClaimCoverage(claimId: string, input: Partial<CoverageRecordUi> & { rank: 'P' | 'S' | 'T' }) {
  return apiJson<{ success: true } & ClaimCoverages>(`/api/billing/claims/${claimId}/coverage`, { method: 'PUT', body: JSON.stringify(input) });
}
