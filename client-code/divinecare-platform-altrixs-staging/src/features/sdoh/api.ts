import { apiJson } from '@/lib/api-client';
import type { AhcAnswers, AhcDomain } from '@/lib/sdoh/ahcHrsn';
import type { CloseReason, ReferralStatus, ReferralType, ResourceDomain } from '@/lib/sdoh/workflow';
import type { SdohReferralDto, SdohScreeningDto } from '@/lib/sdoh/manage';

export type { SdohReferralDto, SdohScreeningDto };

export interface ClientSdoh {
  client: { id: string; name: string };
  screenings: SdohScreeningDto[];
  referrals: SdohReferralDto[];
  rescreen: { dueAt: string; state: 'current' | 'due_soon' | 'overdue' } | null;
  canConfirmZCodes: boolean;
}

export interface SdohResourceDto {
  id: string;
  name: string;
  domains: ResourceDomain[];
  address: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  phone: string | null;
  website: string | null;
  hours: string | null;
  languages: string[];
  cost: string | null;
  eligibilityNotes: string | null;
  active: boolean;
  source: 'manual' | 'legacy' | 'seed' | 'csv';
  lastVerifiedAt: string | null;
  updatedAt: string;
  /** Service area keys (src/lib/resources/community.ts COUNTIES) */
  counties: string[];
  email: string | null;
  verificationSource: string | null;
}

export type ResourceForm = Omit<SdohResourceDto, 'id' | 'source' | 'lastVerifiedAt' | 'updatedAt' | 'counties' | 'email' | 'verificationSource'> & {
  verified?: boolean;
  counties?: string[];
  email?: string | null;
  verificationSource?: string | null;
};

export interface Worklist {
  referrals: SdohReferralDto[];
  rescreen: { clientId: string; clientName: string; lastScreenedAt: string; dueAt: string; state: 'due_soon' | 'overdue' }[];
  owners: { id: string; name: string }[];
}

export interface SdohSummary {
  since: string;
  screenings: number;
  clientsScreened: number;
  activeClients: number;
  coveragePercent: number | null;
  anyPositive: number;
  byDomain: { domain: AhcDomain; positive: number; screened: number; percent: number | null }[];
  referrals: {
    total: number;
    open: number;
    connected: number;
    closed: number;
    needMet: number;
    closurePercent: number | null;
    needMetPercent: number | null;
  };
}

const json = (body: unknown) => ({ body: JSON.stringify(body) });

export const sdohApi = {
  clientSdoh: (clientId: string) => apiJson<ClientSdoh>(`/api/sdoh/screenings?clientId=${encodeURIComponent(clientId)}`),
  submitScreening: (body: {
    submissionId: string;
    clientId: string;
    answers: AhcAnswers;
    includeSupplemental: boolean;
    respondent: 'self' | 'caregiver';
    notes?: string | null;
  }) =>
    apiJson<{ screening: SdohScreeningDto; riskAlertCreated: boolean; safetyItemEndorsed: boolean }>('/api/sdoh/screenings', {
      method: 'POST',
      ...json(body),
    }),
  confirmCodes: (screeningId: string, codes: string[]) =>
    apiJson<{ screening: SdohScreeningDto; addedToDiagnoses: string[] }>(`/api/sdoh/screenings/${encodeURIComponent(screeningId)}/codes`, {
      method: 'POST',
      ...json({ codes }),
    }),
  worklist: (includeClosed = false) => apiJson<Worklist>(`/api/sdoh/referrals${includeClosed ? '?includeClosed=1' : ''}`),
  createReferral: (body: {
    clientId: string; domain: AhcDomain; screeningId?: string | null; resourceId?: string | null; ownerId?: string | null; notes?: string | null;
    referralType?: ReferralType; followUpDate?: string | null; libraryItemId?: string | null;
  }) =>
    apiJson<{ referral: SdohReferralDto }>('/api/sdoh/referrals', { method: 'POST', ...json(body) }),
  updateReferral: (
    id: string,
    body: {
      status?: ReferralStatus; closeReason?: CloseReason | null; notes?: string | null; ownerId?: string | null; resourceId?: string | null;
      referralType?: ReferralType; followUpDate?: string | null; followUpCompleted?: boolean;
    }
  ) => apiJson<{ referral: SdohReferralDto }>(`/api/sdoh/referrals/${encodeURIComponent(id)}`, { method: 'PATCH', ...json(body) }),
  resources: () => apiJson<{ resources: SdohResourceDto[]; legacyAvailable: number }>('/api/sdoh/resources'),
  createResource: (body: ResourceForm) => apiJson<{ resource: SdohResourceDto }>('/api/sdoh/resources', { method: 'POST', ...json(body) }),
  updateResource: (id: string, body: Partial<ResourceForm>) =>
    apiJson<{ resource: SdohResourceDto }>(`/api/sdoh/resources/${encodeURIComponent(id)}`, { method: 'PATCH', ...json(body) }),
  importCsv: (csv: string) => apiJson<{ created: number; errors: { line: number; error: string }[] }>('/api/sdoh/resources/import', { method: 'POST', ...json({ csv }) }),
  importLegacy: () => apiJson<{ found: number; created: number; skipped: number }>('/api/sdoh/resources/import-legacy', { method: 'POST' }),
  summary: () => apiJson<{ summary: SdohSummary }>('/api/sdoh/summary'),
};
