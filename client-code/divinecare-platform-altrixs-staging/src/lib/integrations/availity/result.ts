import type { EligibilityBenefits, EligibilityCheckResult } from './types';
import type { NormalizedEligibility } from './normalize';

const emptyBenefits: EligibilityBenefits = {
  deductible: 0,
  deductibleMet: 0,
  copay: 0,
  oopMax: 0,
  oopMet: 0,
  coveredServices: [],
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseMoney(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[$,\s]/g, '').trim();
    if (!cleaned) return undefined;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** Walk Availity amount trees (inNetwork / outOfNetwork arrays) for the first usable number. */
function firstAmount(node: unknown, preferKeys: string[]): number | undefined {
  if (node == null) return undefined;
  const direct = parseMoney(node);
  if (direct !== undefined) return direct;

  const record = asRecord(node);
  if (record) {
    for (const key of preferKeys) {
      if (key in record) {
        const found = firstAmount(record[key], preferKeys);
        if (found !== undefined) return found;
      }
    }
    for (const nested of Object.values(record)) {
      const found = firstAmount(nested, preferKeys);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = firstAmount(item, preferKeys);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

export function benefitsFromNormalized(normalized: NormalizedEligibility): EligibilityBenefits {
  const deductible =
    firstAmount(normalized.benefits.deductible, ['total', 'amount', 'remaining', 'inNetwork']) ?? 0;
  const deductibleRemaining = firstAmount(normalized.benefits.deductible, [
    'remaining',
    'amount',
    'inNetwork',
  ]);
  const deductibleMet =
    deductibleRemaining !== undefined && deductible >= deductibleRemaining
      ? Math.max(0, deductible - deductibleRemaining)
      : 0;
  const copay = firstAmount(normalized.benefits.copay, ['amount', 'inNetwork']) ?? 0;
  const oopMax = firstAmount(normalized.benefits.outOfPocket, ['total', 'amount', 'inNetwork']) ?? 0;
  const oopRemaining = firstAmount(normalized.benefits.outOfPocket, [
    'remaining',
    'amount',
    'inNetwork',
  ]);
  const oopMet =
    oopRemaining !== undefined && oopMax >= oopRemaining ? Math.max(0, oopMax - oopRemaining) : 0;

  return {
    ...emptyBenefits,
    deductible,
    deductibleMet,
    copay,
    oopMax,
    oopMet,
  };
}

/**
 * Availity Coverages statusCode:
 * 4 = Complete, 5 = Complete (partial), 19 = request error (thrown upstream).
 * Active / inactive inferred from status text when present.
 */
export function eligibilityStatusFromNormalized(
  normalized: NormalizedEligibility
): Exclude<EligibilityCheckResult['status'], never> {
  const status = (normalized.status ?? '').toLowerCase();
  const code = (normalized.statusCode ?? '').trim();

  if (
    /inactive|terminated|not\s*eligible|ineligible|no\s*coverage|denied/.test(status) ||
    code === '15'
  ) {
    return 'INELIGIBLE';
  }

  if (code === '4' || code === '5' || status.includes('complete') || status.includes('active')) {
    return 'ELIGIBLE';
  }

  if (status.includes('error') || status.includes('reject')) {
    return 'ERROR';
  }

  // Successful normalize with payer/coverage payload — treat as eligible coverage response.
  if (normalized.payer || Object.keys(normalized.coverageDates).length) {
    return 'ELIGIBLE';
  }

  return 'ERROR';
}

export function toEligibilityCheckResult(
  normalized: NormalizedEligibility,
  rawRequest: Record<string, unknown>
): EligibilityCheckResult {
  const benefits = benefitsFromNormalized(normalized);
  return {
    status: eligibilityStatusFromNormalized(normalized),
    mode: 'live',
    benefits,
    rawRequest,
    rawResponse: {
      status: normalized.status,
      statusCode: normalized.statusCode,
      payer: normalized.payer,
      coverageDates: normalized.coverageDates,
      availityBenefits: normalized.benefits,
    },
  };
}
