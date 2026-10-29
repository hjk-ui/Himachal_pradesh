/**
 * Who must complete the Carelon non-overlap attestation: every client with active Maryland
 * Medicaid coverage. Carelon Behavioral Health is the ASO for Maryland's Public Behavioral Health
 * System, so every Maryland Medicaid member's behavioral health services (any HealthChoice MCO)
 * go through Carelon. Pure module: the ONE place this rule lives (tests/carelon-attestation.test.ts).
 *
 * A client counts as Maryland Medicaid when ANY of these is true:
 *   1. an active insurance coverage (or the client's primary payer) has claim filing code MC
 *      (SBR09 Medicaid), unless the payer is clearly another state's Medicaid;
 *   2. an active coverage / the primary payer is named as Maryland Medicaid, a HealthChoice MCO,
 *      or the PBHS ASO (Carelon / Beacon / Optum Maryland), see MD_MEDICAID_PAYER_PATTERNS;
 *   3. the client's primary insurance type (Valant Ins1) is Medicaid, unless it names another state;
 *   4. a Maryland Medical Assistance (MA) number is on file (Client.medicaidId).
 * Inactive coverages and a primary payer whose coverage end date has passed do not count
 * (rule 4 still applies: an MA number on file means Medicaid until staff remove it).
 */

export type CoverageInput = {
  payerName: string | null;
  memberId: string | null;
  claimFilingCode: string | null;
  active: boolean;
  /** P / S / T */
  rank?: string | null;
};

export type MedicaidClientInput = {
  medicaidId: string | null;
  insuranceType: string | null;
  insurancePayer: string | null;
  insuranceMemberId?: string | null;
  insuranceEffectiveTo?: Date | null;
  coverages: CoverageInput[];
};

export type MedicaidSource = 'coverage' | 'primary_payer' | 'insurance_type' | 'medicaid_id';

export type MedicaidDetection = {
  medicaid: boolean;
  /** Plain-language reasons (shown to staff); empty when not Medicaid */
  reasons: string[];
  sources: MedicaidSource[];
  /** Member ID of the matching Medicaid coverage / primary payer (Participant ID fallback) */
  coverageMemberId: string | null;
  /** Payer name that matched, for display */
  payerName: string | null;
};

/** Named Maryland Medicaid / HealthChoice MCO / PBHS ASO payers (case-insensitive). */
export const MD_MEDICAID_PAYER_PATTERNS: { label: string; re: RegExp }[] = [
  { label: 'Maryland Medicaid / Medical Assistance', re: /maryland medicaid|\bmd medicaid|medical assistance|\bmdh\b|\bdhmh\b|health ?choice/i },
  { label: 'Carelon Behavioral Health (PBHS ASO)', re: /carelon|beacon health options/i },
  { label: 'Maryland Public Behavioral Health System', re: /\bpbhs\b|public behavioral health/i },
  { label: 'Optum Maryland (former PBHS ASO)', re: /optum maryland|maryland optum|optum.*\b(pbhs|md)\b/i },
  { label: 'Priority Partners', re: /priority partners/i },
  { label: 'Wellpoint Maryland (formerly Amerigroup)', re: /wellpoint|amerigroup/i },
  { label: 'CareFirst Community Health Plan Maryland', re: /carefirst community|chpmd|community health plan maryland/i },
  { label: 'Maryland Physicians Care', re: /maryland physicians care/i },
  { label: 'MedStar Family Choice', re: /medstar family choice/i },
  { label: 'UnitedHealthcare Community Plan', re: /united ?health ?care community|\buhc community/i },
  { label: 'Aetna Better Health of Maryland', re: /aetna better health/i },
  { label: 'Jai Medical Systems', re: /jai medical/i },
  { label: 'Kaiser Permanente HealthChoice', re: /kaiser.*(health ?choice|medicaid)/i },
  { label: 'AmeriHealth Caritas Maryland', re: /amerihealth caritas.*(maryland|\bmd\b)/i },
  { label: 'Medicaid', re: /\bmedicaid\b/i },
];

/** Maryland markers win over other-state markers (e.g. "MedStar Family Choice (MD/DC Medicaid)"). */
const MD_MARKER = /maryland|\bmd\b|\bmdh\b|\bdhmh\b|\bpbhs\b|carelon/i;
const OTHER_STATE_MARKER =
  /district of columbia|\bd\.?c\.? medicaid|\bdhcf\b|virginia|\bdmas\b|healthkeepers|pennsylvania|new york|florida|texas|ohio|georgia|south carolina|indiana|california|trusted health plan|\((?:[^)]*\b)?(dc|va|pa|ny|fl|tx|oh|ga|sc|in|ca)\b[^)]*\)/i;

export function isOtherStatePayer(name: string | null | undefined): boolean {
  const n = (name || '').trim();
  if (!n) return false;
  return OTHER_STATE_MARKER.test(n) && !MD_MARKER.test(n);
}

/** Label of the Maryland Medicaid / MCO / ASO pattern a payer name matches, or null. */
export function marylandMedicaidPayerLabel(name: string | null | undefined): string | null {
  const n = (name || '').trim();
  if (!n || isOtherStatePayer(n)) return null;
  return MD_MEDICAID_PAYER_PATTERNS.find((p) => p.re.test(n))?.label ?? null;
}

const isMcCode = (code: string | null | undefined) => (code || '').trim().toUpperCase() === 'MC';

/**
 * A claim's payer is Maryland Medicaid / the Public Behavioral Health System (Carelon, the PBHS
 * ASO; HealthChoice MCO members' BH services go through it): a payer name matching
 * MD_MEDICAID_PAYER_PATTERNS, or claim filing code MC (SBR09 Medicaid), never another state's
 * Medicaid. Used by the claim scrubber's BH primary-diagnosis rule.
 */
export function isMarylandPbhsClaimPayer(input: { payer: string | null | undefined; claimFilingCode?: string | null }): boolean {
  if (marylandMedicaidPayerLabel(input.payer)) return true;
  return isMcCode(input.claimFilingCode) && !isOtherStatePayer(input.payer);
}

export function detectMarylandMedicaid(
  c: MedicaidClientInput,
  opts: { now?: Date; filingCodeForPayer?: (payerName: string) => string | null } = {}
): MedicaidDetection {
  const now = opts.now ?? new Date();
  const reasons: string[] = [];
  const sources = new Set<MedicaidSource>();
  let coverageMemberId: string | null = null;
  let payerName: string | null = null;
  const take = (member: string | null | undefined, payer: string | null | undefined) => {
    if (!coverageMemberId && member?.trim()) coverageMemberId = member.trim();
    if (!payerName && payer?.trim()) payerName = payer.trim();
  };

  for (const cov of c.coverages) {
    if (!cov.active) continue;
    const name = cov.payerName?.trim() || '';
    const label = marylandMedicaidPayerLabel(name);
    if (isMcCode(cov.claimFilingCode) && !isOtherStatePayer(name)) {
      reasons.push(`Active coverage${name ? ` (${name})` : ''} has claim filing code MC (Medicaid)`);
      sources.add('coverage');
      take(cov.memberId, name);
    } else if (label) {
      reasons.push(`Active coverage ${name} is ${label}`);
      sources.add('coverage');
      take(cov.memberId, name);
    }
  }

  const primary = c.insurancePayer?.trim() || '';
  const primaryEnded = c.insuranceEffectiveTo ? c.insuranceEffectiveTo.getTime() < now.getTime() - 86_400_000 : false;
  if (primary && !primaryEnded) {
    const label = marylandMedicaidPayerLabel(primary);
    const code = opts.filingCodeForPayer?.(primary) ?? null;
    if (label) {
      reasons.push(`Primary payer ${primary} is ${label}`);
      sources.add('primary_payer');
      take(c.insuranceMemberId, primary);
    } else if (isMcCode(code) && !isOtherStatePayer(primary)) {
      reasons.push(`Primary payer ${primary} is mapped to claim filing code MC (Medicaid)`);
      sources.add('primary_payer');
      take(c.insuranceMemberId, primary);
    }
  }

  if (/medicaid/i.test(c.insuranceType || '') && !isOtherStatePayer(primary) && !primaryEnded) {
    reasons.push('Primary insurance type is Medicaid');
    sources.add('insurance_type');
    take(c.insuranceMemberId, primary || null);
  }

  if (c.medicaidId?.trim()) {
    reasons.push('Maryland Medical Assistance (MA) number on file');
    sources.add('medicaid_id');
  }

  return { medicaid: sources.size > 0, reasons, sources: [...sources], coverageMemberId, payerName };
}

/** Admin-visible explanation of the rule (Carelon attestation page, report definitions). */
export const MEDICAID_RULE_EXPLANATION: readonly string[] = [
  'Every active client with Maryland Medicaid needs one completed Carelon non-overlap attestation on file. Carelon Behavioral Health is the ASO for the Maryland Public Behavioral Health System, so this applies to every HealthChoice MCO.',
  'A client counts as Maryland Medicaid when any of these is true: an active insurance coverage has claim filing code MC (Medicaid); an active coverage or the primary payer is Maryland Medicaid, a HealthChoice MCO (Priority Partners, Wellpoint/Amerigroup, CareFirst Community Health Plan, Maryland Physicians Care, MedStar Family Choice, UnitedHealthcare Community Plan, Aetna Better Health of Maryland, Jai Medical Systems, Kaiser Permanente HealthChoice, AmeriHealth Caritas Maryland), or the PBHS ASO (Carelon, Beacon, Optum Maryland); the primary insurance type is Medicaid; or a Maryland Medical Assistance (MA) number is on file.',
  "Another state's Medicaid (for example DC or Virginia) does not count. Inactive coverages and a primary payer whose end date has passed do not count; an MA number on file always counts until it is removed from the client.",
];
