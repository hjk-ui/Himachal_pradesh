export const DIAGNOSIS_STATUSES = [
  'ACTIVE',
  'PROVISIONAL',
  'RULED_OUT',
  'RESOLVED',
  'ENTERED_IN_ERROR',
] as const;

export type DiagnosisStatus = (typeof DIAGNOSIS_STATUSES)[number];

/** Statuses that count as "on the current list". */
export const CURRENT_DIAGNOSIS_STATUSES: readonly DiagnosisStatus[] = ['ACTIVE', 'PROVISIONAL'];

export function isCurrentStatus(status: string): boolean {
  return (CURRENT_DIAGNOSIS_STATUSES as readonly string[]).includes(status);
}

export type DiagnosisDto = {
  id: string;
  clientId: string;
  code: string;
  description: string;
  dsm5Name: string | null;
  status: DiagnosisStatus;
  isPrimary: boolean;
  rank: number;
  onsetDate: string | null;
  resolvedDate: string | null;
  needsCoding: boolean;
  createdAt: string;
  updatedAt: string;
};

export type DiagnosisHistoryDto = {
  id: string;
  diagnosisId: string | null;
  action: string;
  code: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  detail: unknown;
  actorName: string | null;
  createdAt: string;
};

export type DiagnosisSuggestion = {
  id: string;
  code: string;
  description: string;
  /** Where the suggestion came from, e.g. "ai-scribe", "coding-agent". */
  source: string;
  status: 'PENDING' | 'ACCEPTED' | 'DISMISSED';
  createdAt: string;
};

export type DiagnosisActor = {
  organizationId: string;
  userId: string;
  userName?: string | null;
};
