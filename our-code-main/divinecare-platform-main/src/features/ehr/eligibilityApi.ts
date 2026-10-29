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
};

export async function fetchEligibilityChecks() {
  const data = await apiJson<{ success: true; checks: EligibilityCheckRecord[] }>(
    '/api/eligibility'
  );
  return data.checks;
}

export async function runEligibilityCheck(input: {
  clientId: string;
  payerName?: string | null;
  memberId?: string | null;
  dos?: string | null;
}) {
  const data = await apiJson<{
    success: true;
    check: EligibilityCheckRecord;
    mode: 'live';
  }>('/api/eligibility/check', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return data.check;
}
