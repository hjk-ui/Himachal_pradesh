import { apiJson } from '@/lib/api-client';

export type StaffCredentialType =
  | 'LICENSE'
  | 'CEU'
  | 'MALPRACTICE'
  | 'DEA'
  | 'CERTIFICATION'
  | 'BACKGROUND_CHECK'
  | 'SUPERVISION';

export type StaffCredentialStatus =
  | 'ACTIVE'
  | 'EXPIRING_SOON'
  | 'EXPIRED'
  | 'PENDING_RENEWAL';

export type DerivedCredentialStatus = 'active' | 'expiring_soon' | 'expired';

export type StaffCredentialRecord = {
  id: string;
  userId: string;
  staffName: string;
  staffEmail: string;
  staffStatus: 'INVITED' | 'ACTIVE' | 'DEACTIVATED';
  credentialType: StaffCredentialType;
  title: string;
  licenseNumber: string;
  issuer: string;
  issuedAt: string | null;
  expiresAt: string;
  ceuRequired: number;
  ceuCompleted: number;
  documentUrl: string | null;
  documentName: string | null;
  status: StaffCredentialStatus;
  derivedStatus: DerivedCredentialStatus;
  daysUntilExpiry: number;
};

export type CredentialStaffOption = {
  id: string;
  name: string;
  email: string;
  status: 'INVITED' | 'ACTIVE' | 'DEACTIVATED';
};

export type CredentialPayload = {
  userId?: string;
  credentialType?: StaffCredentialType;
  title?: string;
  licenseNumber?: string;
  issuer?: string;
  issuedAt?: string | null;
  expiresAt?: string;
  ceuRequired?: number;
  ceuCompleted?: number;
  documentUrl?: string | null;
  documentName?: string | null;
  status?: StaffCredentialStatus;
};

export async function fetchStaffCredentials() {
  const data = await apiJson<{
    success: true;
    credentials: StaffCredentialRecord[];
    staff: CredentialStaffOption[];
    schemaReady?: boolean;
  }>('/api/hr/credentials');
  return data;
}

export async function createStaffCredential(input: CredentialPayload) {
  const data = await apiJson<{ success: true; credential: StaffCredentialRecord }>(
    '/api/hr/credentials',
    { method: 'POST', body: JSON.stringify(input) }
  );
  return data.credential;
}

export async function updateStaffCredential(id: string, input: CredentialPayload) {
  const data = await apiJson<{ success: true; credential: StaffCredentialRecord }>(
    `/api/hr/credentials/${id}`,
    { method: 'PATCH', body: JSON.stringify(input) }
  );
  return data.credential;
}

export async function renewStaffCredential(id: string, expiresAt?: string) {
  const data = await apiJson<{ success: true; credential: StaffCredentialRecord }>(
    `/api/hr/credentials/${id}/renew`,
    { method: 'POST', body: JSON.stringify({ expiresAt: expiresAt || null }) }
  );
  return data.credential;
}

export async function uploadCredentialDocument(id: string, file: File) {
  const form = new FormData();
  form.append('file', file);
  const data = await apiJson<{ success: true; credential: StaffCredentialRecord }>(
    `/api/hr/credentials/${id}/document`,
    { method: 'POST', body: form }
  );
  return data.credential;
}
