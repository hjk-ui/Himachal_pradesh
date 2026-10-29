/**
 * Missed-visit fee guard (no-show / late-cancel fees). NO fee is posted anywhere today; this is
 * the gate any future fee logic must call before charging.
 *
 * Rule: never charge a Medicaid / Maryland PBHS patient a no-show or late-cancel fee. Medicaid
 * payment is payment in full (42 CFR 447.15) and CMS does not allow billing Medicaid beneficiaries
 * for missed appointments; Maryland Medicaid MCO and PBHS (Carelon) contracts say the same.
 * An unknown or missing payer is NOT chargeable either until staff verify coverage.
 */

const MEDICAID_PATTERNS = [
  /medicaid/i,
  /medical assistance/i,
  /\bpbhs\b/i,
  /public behavioral health/i,
  /carelon/i,
  /beacon health/i,
  /healthchoice/i,
  /priority partners/i,
  /maryland physicians care/i,
  /wellpoint maryland/i,
  /amerigroup/i,
  /carefirst community health/i,
  /aetna better health/i,
  /jai medical/i,
  /medstar family choice/i,
  /united\s*healthcare community/i,
  /\bchip\b/i,
];

export type FeePayerInfo = { insuranceType?: string | null; insurancePayer?: string | null; selfPay?: boolean | null };

export function isMedicaidCoverage(p: FeePayerInfo): boolean {
  const text = `${p.insuranceType ?? ''} ${p.insurancePayer ?? ''}`;
  return MEDICAID_PATTERNS.some((re) => re.test(text));
}

export type MissedVisitFeeDecision =
  | { allowed: true }
  | { allowed: false; reason: 'medicaid_or_pbhs' | 'payer_unknown' | 'practice_setting_off' };

export function missedVisitFeeDecision(
  p: FeePayerInfo,
  practice: { feeEnabled: boolean }
): MissedVisitFeeDecision {
  if (!practice.feeEnabled) return { allowed: false, reason: 'practice_setting_off' };
  if (isMedicaidCoverage(p)) return { allowed: false, reason: 'medicaid_or_pbhs' };
  if (!p.selfPay && !p.insuranceType?.trim() && !p.insurancePayer?.trim()) return { allowed: false, reason: 'payer_unknown' };
  return { allowed: true };
}

/** Inside the practice's cancellation window (e.g. less than 24 hours before the start)? */
export function isLateCancellation(startsAt: Date, now: Date, cancellationWindowHours: number): boolean {
  const hours = Number.isFinite(cancellationWindowHours) && cancellationWindowHours > 0 ? cancellationWindowHours : 0;
  if (!hours) return false;
  return startsAt.getTime() - now.getTime() < hours * 3_600_000;
}

/** What the patient is told after cancelling (no fee language beyond the truth: none charged). */
export function patientCancellationMessage(late: boolean, windowHours: number): string {
  if (!late) return 'Your appointment is cancelled.';
  return `Your appointment is cancelled. Because it was less than ${windowHours} hours before the visit, the office records it as a late cancellation. No fee has been charged. Please call the office if you need to reschedule.`;
}
