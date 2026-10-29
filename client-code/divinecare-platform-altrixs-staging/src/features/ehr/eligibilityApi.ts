import { apiJson } from '@/lib/api-client';

export type EligibilityDbStatus = 'PENDING' | 'ELIGIBLE' | 'INELIGIBLE' | 'ERROR';

export type EligibilityBenefits = {
  deductible: number;
  deductibleMet: number;
  copay: number;
  oopMax: number;
  oopMet: number;
  coveredServices: string[];
};

export type EligibilityChannel = 'waystar' | 'availity';

export type EligibilityCheckRecord = {
  id: string;
  clientId: string;
  clientName: string;
  payerName: string;
  memberId: string | null;
  dos: string;
  status: EligibilityDbStatus;
  checkedAt: string;
  benefits: EligibilityBenefits;
  /** Optional so older API responses still type-check */
  channel?: EligibilityChannel | null;
  awaitingResponse?: boolean;
  statusText?: string | null;
  error?: string | null;
  details?: null | {
    sentAt: string | null;
    batchId: string | null;
    coinsurancePercent: number | null;
    planBegin: string | null;
    planEnd: string | null;
    planName: string | null;
    priorAuthRequired: boolean;
    benefitSource: string | null;
    rejections: string[];
    notes: string[];
  };
};

export type EligibilityChannels = {
  defaultChannel: EligibilityChannel;
  channels: EligibilityChannel[];
  waystar: boolean;
  availity: boolean;
  usageIndicator: 'T' | 'P';
  waystarNote: string | null;
};

export async function fetchEligibilityChecks() {
  const data = await apiJson<{ success: true; checks: EligibilityCheckRecord[] }>(
    '/api/eligibility'
  );
  return data.checks;
}

/** Checks plus which clearinghouse channels this server offers. */
export async function fetchEligibilityData() {
  const data = await apiJson<{ success: true; checks: EligibilityCheckRecord[]; channels?: EligibilityChannels }>(
    '/api/eligibility'
  );
  return { checks: data.checks, channels: data.channels ?? null };
}

export async function runEligibilityCheck(input: {
  clientId: string;
  payerName?: string | null;
  memberId?: string | null;
  dos?: string | null;
  channel?: EligibilityChannel | null;
}) {
  const data = await apiJson<{
    success: true;
    check: EligibilityCheckRecord;
    mode: 'live' | 'batch';
    channel?: EligibilityChannel;
  }>('/api/eligibility/check', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return data.check;
}
