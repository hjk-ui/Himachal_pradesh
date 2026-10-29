export type EligibilityCheckStatus = 'PENDING' | 'ELIGIBLE' | 'INELIGIBLE' | 'ERROR';

export type EligibilityCheckInput = {
  payerName: string;
  memberId?: string | null;
  dateOfService: Date;
  clientName: string;
};

export type EligibilityBenefits = {
  deductible: number;
  deductibleMet: number;
  copay: number;
  oopMax: number;
  oopMet: number;
  coveredServices: string[];
};

export type EligibilityCheckResult = {
  status: Exclude<EligibilityCheckStatus, 'PENDING'>;
  mode: 'live';
  benefits: EligibilityBenefits;
  rawRequest: Record<string, unknown>;
  rawResponse: Record<string, unknown>;
};

export interface AvailityEligibilityProvider {
  checkEligibility(input: EligibilityCheckInput): Promise<EligibilityCheckResult>;
}
