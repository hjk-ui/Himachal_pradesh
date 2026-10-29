import 'server-only';

import { getAvailityConfig } from '@/lib/integrations/availity/config';
import { runCoveragesEligibility } from '@/lib/integrations/availity/coverages';
import { AvailityEligibilityError } from '@/lib/integrations/availity/errors';
import { toEligibilityCheckResult } from '@/lib/integrations/availity/result';
import type {
  AvailityEligibilityProvider,
  EligibilityCheckInput,
  EligibilityCheckResult,
} from '@/lib/integrations/availity/types';

export type LiveEligibilityInput = EligibilityCheckInput & {
  insurancePayer: string;
  insuranceGroupNumber?: string | null;
  dateOfBirth?: Date | null;
  gender?: string | null;
  state?: string | null;
  providerNpi?: string | null;
  providerName?: string | null;
};

/**
 * Production Coverages eligibility — no stub / no mock headers unless env opts in.
 */
export async function checkLiveEligibility(input: LiveEligibilityInput): Promise<EligibilityCheckResult> {
  if (!getAvailityConfig()) {
    throw new AvailityEligibilityError(
      'Availity is not configured. Set AVAILITY_CLIENT_ID, AVAILITY_CLIENT_SECRET, AVAILITY_TOKEN_URL, AVAILITY_API_BASE_URL, and AVAILITY_SCOPE.',
      503,
      'not_configured'
    );
  }

  const insurancePayer = (input.insurancePayer || input.payerName || '').trim();
  if (!insurancePayer) {
    throw new AvailityEligibilityError('Payer is required', 400, 'missing_fields');
  }

  const normalized = await runCoveragesEligibility({
    insurancePayer,
    insuranceMemberId: input.memberId ?? null,
    insuranceGroupNumber: input.insuranceGroupNumber ?? null,
    clientName: input.clientName,
    dateOfBirth: input.dateOfBirth ?? null,
    gender: input.gender ?? null,
    state: input.state ?? null,
    providerNpi: input.providerNpi ?? null,
    providerName: input.providerName ?? null,
    asOfDate: input.dateOfService,
  });

  return toEligibilityCheckResult(normalized, {
    transaction: 'coverages',
    payerName: insurancePayer,
    memberIdPresent: Boolean(input.memberId?.trim()),
    dateOfService: input.dateOfService.toISOString().slice(0, 10),
    clientName: input.clientName,
  });
}

export const availityProvider: AvailityEligibilityProvider = {
  async checkEligibility(input) {
    return checkLiveEligibility({
      ...input,
      insurancePayer: input.payerName,
    });
  },
};
