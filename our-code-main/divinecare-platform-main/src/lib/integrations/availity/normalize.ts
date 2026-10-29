const PHI_KEYS = new Set([
  'ssn',
  'memberId',
  'medicaidId',
  'memberIdentificationNumber',
  'familyUnitNumber',
  'healthInsuranceClaimNumber',
  'patientAccountNumber',
  'firstName',
  'lastName',
  'middleName',
  'suffix',
  'birthDate',
  'address',
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

function pickStrings(source: Record<string, unknown> | null, keys: string[]): Record<string, string> {
  if (!source) return {};
  const out: Record<string, string> = {};
  for (const key of keys) {
    const value = asString(source[key]);
    if (value) out[key] = value;
  }
  return out;
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  const record = asRecord(value);
  if (!record) return value;
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(record)) {
    if (PHI_KEYS.has(key)) continue;
    out[key] = redact(nested);
  }
  return out;
}

const COVERAGE_DATE_KEYS = [
  'eligibilityStartDate',
  'eligibilityEndDate',
  'coverageStartDate',
  'coverageEndDate',
  'policyEffectiveDate',
  'policyExpirationDate',
  'planStartDate',
  'planEndDate',
] as const;

function coverageDatesFrom(plan: Record<string, unknown> | null): Record<string, string> {
  return pickStrings(plan, [...COVERAGE_DATE_KEYS]);
}

function amountsFromBenefit(benefit: Record<string, unknown>): {
  copay?: unknown;
  deductible?: unknown;
  outOfPocket?: unknown;
  coinsurance?: unknown;
} {
  const amounts = asRecord(benefit.amounts) ?? asRecord(asRecord(benefit.benefitDetail)?.amounts);
  if (!amounts) return {};
  const out: {
    copay?: unknown;
    deductible?: unknown;
    outOfPocket?: unknown;
    coinsurance?: unknown;
  } = {};
  if (amounts.coPayment !== undefined) out.copay = redact(amounts.coPayment);
  if (amounts.deductibles !== undefined) out.deductible = redact(amounts.deductibles);
  if (amounts.outOfPocket !== undefined) out.outOfPocket = redact(amounts.outOfPocket);
  if (amounts.coInsurance !== undefined) out.coinsurance = redact(amounts.coInsurance);
  return out;
}

export type NormalizedEligibility = {
  success: true;
  status?: string;
  statusCode?: string;
  payer?: Record<string, string>;
  coverageDates: Record<string, string>;
  benefits: {
    copay?: unknown;
    deductible?: unknown;
    outOfPocket?: unknown;
    coinsurance?: unknown;
  };
};

export function extractCoverageRecord(payload: unknown): Record<string, unknown> | null {
  const root = asRecord(payload);
  if (!root) return null;
  if (Array.isArray(root.coverages) && root.coverages[0]) {
    return asRecord(root.coverages[0]);
  }
  if (asString(root.id) || asString(root.statusCode) || asString(root.status)) {
    return root;
  }
  return null;
}

export function normalizeCoverageResponse(payload: unknown): NormalizedEligibility {
  const coverage = extractCoverageRecord(payload);
  const payer = asRecord(coverage?.payer);
  const plans = Array.isArray(coverage?.plans)
    ? coverage.plans.map((item) => asRecord(item)).filter((item): item is Record<string, unknown> => Boolean(item))
    : [];
  const plan = plans[0] ?? null;

  let benefits: NormalizedEligibility['benefits'] = {};
  if (plan && Array.isArray(plan.benefits)) {
    for (const raw of plan.benefits) {
      const benefit = asRecord(raw);
      if (!benefit) continue;
      const mapped = amountsFromBenefit(benefit);
      if (Object.keys(mapped).length) {
        benefits = mapped;
        break;
      }
    }
  }

  const payerFields = pickStrings(payer, ['payerId', 'name', 'responsePayerId', 'responseName']);

  return {
    success: true,
    ...pickStrings(coverage, ['status', 'statusCode']),
    ...(Object.keys(payerFields).length ? { payer: payerFields } : {}),
    coverageDates: coverageDatesFrom(plan),
    benefits,
  };
}
