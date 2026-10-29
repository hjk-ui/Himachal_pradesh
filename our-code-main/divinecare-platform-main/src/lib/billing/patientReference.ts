export type ClaimPatientSlice = {
  id: string;
  status: string;
  payer: string | null;
  amountCents: number | null;
  patientResponsibility: number | null;
  frequencyCode: string | null;
  primaryClaimId: string | null;
  eraProcessedAt: Date | null;
};

export function isSelfPay(payer: string | null | undefined) {
  const value = (payer || '').trim();
  return !value || /self\s*-?\s*pay/i.test(value);
}

/** Patient portion of one claim, in cents. Exclusions contribute 0. */
export function claimPatientCents(claim: ClaimPatientSlice, claims: ClaimPatientSlice[]) {
  if (claim.status === 'DRAFT') return 0;
  if (String(claim.frequencyCode || '').trim() === '8') return 0;
  const hasLiveSecondary = claims.some(
    (other) => other.id !== claim.id && other.primaryClaimId === claim.id && other.status !== 'DRAFT'
  );
  if (!claim.primaryClaimId && hasLiveSecondary) return 0;
  if (claim.patientResponsibility != null && Number.isFinite(claim.patientResponsibility)) {
    return Math.round(claim.patientResponsibility * 100);
  }
  if (isSelfPay(claim.payer) && !claim.eraProcessedAt) return claim.amountCents ?? 0;
  if (!isSelfPay(claim.payer) && !claim.eraProcessedAt) return 0;
  return 0;
}

export function claimCountsTowardPatient(claim: ClaimPatientSlice, claims: ClaimPatientSlice[]) {
  if (claim.status === 'DRAFT') return false;
  if (String(claim.frequencyCode || '').trim() === '8') return false;
  const hasLiveSecondary = claims.some(
    (other) => other.id !== claim.id && other.primaryClaimId === claim.id && other.status !== 'DRAFT'
  );
  if (!claim.primaryClaimId && hasLiveSecondary) return false;
  if (claim.patientResponsibility != null && Number.isFinite(claim.patientResponsibility)) return true;
  if (isSelfPay(claim.payer) && !claim.eraProcessedAt) return true;
  return false;
}

export type LedgerSlice = { kind: string; amountCents: number; asOf: Date };

export function sumKind(rows: LedgerSlice[], kind: string) {
  return rows.filter((row) => row.kind === kind).reduce((sum, row) => sum + row.amountCents, 0);
}

export function latestAsOf(rows: LedgerSlice[], kind: string) {
  const dates = rows.filter((row) => row.kind === kind).map((row) => row.asOf.getTime());
  if (!dates.length) return null;
  return new Date(Math.max(...dates)).toISOString();
}

export function providerTypeForRole(role: string | null | undefined) {
  const value = (role || '').toUpperCase();
  if (value === 'NP' || value === 'MEDICAL_NP') return 'NP';
  if (value === 'THERAPIST' || value === 'CLINICIAN') return 'THERAPIST';
  if (
    value === 'PSYCHIATRIST' ||
    value === 'PHYSICIAN' ||
    value === 'MEDICAL_ASSISTANT' ||
    value === 'PEER_SUPPORT' ||
    value === 'PRP_SPECIALIST' ||
    value === 'CASE_MANAGER'
  ) {
    return value;
  }
  return value;
}

export type CopayRuleSlice = {
  payerName: string;
  providerType: string;
  cptRule: string;
  amountCents: number;
  source: string;
};

export function pickCopayRule(
  rules: CopayRuleSlice[],
  payerName: string,
  providerType: string,
  cpt: string | null
) {
  if (!rules.length) {
    return { copay: null, reason: 'no-rules' as const };
  }
  const payer = payerName.trim();
  if (!payer) {
    return { copay: null, reason: 'payer-unknown' as const };
  }
  const samePayer = rules.filter((rule) => rule.payerName.trim().toLowerCase() === payer.toLowerCase());
  const cptKey = (cpt || '').trim().toUpperCase();
  const tiers: Array<{ specificity: 'cpt' | 'provider' | 'payer'; rows: CopayRuleSlice[] }> = [
    {
      specificity: 'cpt',
      rows: cptKey
        ? samePayer.filter((rule) => rule.cptRule.trim().toUpperCase() === cptKey)
        : [],
    },
    {
      specificity: 'provider',
      rows: samePayer.filter(
        (rule) => !rule.cptRule.trim() && rule.providerType.trim().toUpperCase() === providerType.toUpperCase() && providerType
      ),
    },
    {
      specificity: 'payer',
      rows: samePayer.filter((rule) => !rule.cptRule.trim() && !rule.providerType.trim()),
    },
  ];
  const winner = tiers.find((tier) => tier.rows.length > 0);
  if (!winner) return { copay: null, reason: 'no-matching-rule' as const };
  const row = winner.rows[0];
  return {
    copay: {
      amountCents: row.amountCents,
      specificity: winner.specificity,
      ambiguous: winner.rows.length > 1,
      source: row.source,
      payerName: row.payerName,
      providerType: row.providerType,
      cptRule: row.cptRule,
    },
    reason: null,
  };
}

export function noShowRate(kept: number, noShows: number) {
  const denominator = kept + noShows;
  return denominator === 0 ? null : noShows / denominator;
}

export function lateCancelRate(kept: number, noShows: number, lateCancels: number) {
  const denominator = kept + noShows + lateCancels;
  return denominator === 0 ? null : lateCancels / denominator;
}

export function isMissingSchema(err: unknown) {
  const code = typeof err === 'object' && err && 'code' in err ? String((err as { code: unknown }).code) : '';
  const message = err instanceof Error ? err.message : String(err);
  return code === 'P2021' || code === 'P2022' || /does not exist|unknown arg/i.test(message);
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function parseDay(value: string | null) {
  if (!value || !DAY.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function inclusiveDays(from: Date, to: Date) {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
}

export const PATIENT_PAYMENT_ROLES = new Set([
  'ADMIN',
  'DIRECTOR',
  'PRACTICE_DIRECTOR',
  'BILLING',
  'OFFICE_MANAGER',
  'FRONT_DESK',
]);

export const OPERATIONAL_REPORTS = [
  'prior-auth-utilization',
  'appointment-volume',
  'no-show-late-cancel',
  'waitlist',
] as const;

export const REVENUE_REPORTS = [
  'charges-payments-adjustments',
  'ar-aging',
  'days-in-ar',
  'net-collection-rate',
  'denials',
  'clean-claim-rate',
  'unbilled-encounters',
  'timely-filing',
  'era-exceptions',
  'patient-balances',
  'autopay-charges',
  'payer-mix',
  'provider-collections',
  'ar-control',
  'billing-overview',
  'outcomes',
] as const;

export function excludedCollectionCategory(category: string | null | undefined) {
  const value = (category || '').trim().toLowerCase();
  return value === 'charge' || value === 'charges' || value === 'fee' || value === 'fees';
}
