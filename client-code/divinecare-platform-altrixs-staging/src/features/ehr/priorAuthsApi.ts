import { apiJson } from '@/lib/api-client';

export type PriorAuthDbStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'DENIED' | 'EXPIRED';

export type PriorAuthRecord = {
  id: string;
  clientId: string;
  clientName: string;
  payer: string;
  authNumber: string | null;
  cptCodes: string[];
  unitsApproved: number;
  unitsUsed: number;
  status: PriorAuthDbStatus;
  startDate: string | null;
  endDate: string | null;
  notes: string | null;
  /** 'valant' when imported from Valant */
  source?: string | null;
};

export async function fetchPriorAuths() {
  const data = await apiJson<{ success: true; auths: PriorAuthRecord[] }>(
    '/api/ehr/prior-auths'
  );
  return data.auths;
}

export async function createPriorAuth(input: {
  clientId: string;
  payer: string;
  authNumber?: string | null;
  cptCodes: string[];
  unitsApproved: number;
  unitsUsed?: number;
  status?: PriorAuthDbStatus;
  startDate?: string | null;
  endDate?: string | null;
  notes?: string | null;
}) {
  const data = await apiJson<{ success: true; auth: PriorAuthRecord }>(
    '/api/ehr/prior-auths',
    { method: 'POST', body: JSON.stringify(input) }
  );
  return data.auth;
}

export async function updatePriorAuth(
  id: string,
  input: Partial<{
    payer: string;
    authNumber: string | null;
    cptCodes: string[];
    unitsApproved: number;
    unitsUsed: number;
    useUnits: number;
    status: PriorAuthDbStatus;
    startDate: string | null;
    endDate: string | null;
    notes: string | null;
  }>
) {
  const data = await apiJson<{ success: true; auth: PriorAuthRecord }>(
    `/api/ehr/prior-auths/${id}`,
    { method: 'PATCH', body: JSON.stringify(input) }
  );
  return data.auth;
}
