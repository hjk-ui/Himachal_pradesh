import { apiJson } from '@/lib/api-client';

export type SupervisionSessionType = 'Individual' | 'Triadic' | 'Group';

export type SupervisionLogRecord = {
  id: string;
  supervisorId: string;
  supervisorName: string;
  superviseeId: string;
  superviseeName: string;
  sessionAt: string;
  sessionType: SupervisionSessionType;
  durationMin: number;
  hoursTowardLicensure: number;
  hoursCredited: number;
  topics: string;
  clientRefs: string[];
  signedBySupervisorAt: string | null;
  signedBySuperviseeAt: string | null;
};

export type SupervisionTrackRecord = {
  id: string;
  superviseeId: string;
  superviseeName: string;
  supervisorId: string;
  supervisorName: string;
  licenseTrack: string;
  targetLicense: string;
  requiredHours: number;
  startedAt: string;
};

export type SupervisionStaffOption = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: 'INVITED' | 'ACTIVE' | 'DEACTIVATED';
};

export async function fetchSupervisionLogs() {
  return apiJson<{
    success: true;
    logs: SupervisionLogRecord[];
    tracks: SupervisionTrackRecord[];
    staff: SupervisionStaffOption[];
    pendingSuperviseeSignatures: number;
    schemaReady?: boolean;
    actor: { userId: string; role: string };
  }>('/api/hr/supervision');
}

export async function createSupervisionLog(input: {
  superviseeId: string;
  supervisorId?: string;
  sessionAt: string;
  sessionType?: SupervisionSessionType;
  durationMin: number;
  topics: string;
  clientRefs?: string[];
}) {
  const data = await apiJson<{ success: true; log: SupervisionLogRecord }>('/api/hr/supervision', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return data.log;
}

export async function signSupervisionLog(id: string, signAs: 'supervisor' | 'supervisee') {
  const data = await apiJson<{ success: true; log: SupervisionLogRecord }>(
    `/api/hr/supervision/${id}`,
    { method: 'PATCH', body: JSON.stringify({ signAs }) }
  );
  return data.log;
}
