/**
 * Medical billing KPIs from stored MedicalCharge rows only (pure, testable).
 *
 * - Non-denied claim share: charges not in Denied status / all charges. This is NOT a clean
 *   claim rate (first-pass acceptance needs clearinghouse 277CA / ERA data we do not store).
 * - Days in A/R (standard formula): outstanding A/R / average daily charges over the last
 *   `windowDays` days of service. Outstanding A/R = billed amount of charges sent to a payer
 *   (Submitted or Denied) and not Paid; partial payments are not stored, so a Submitted charge
 *   counts in full. null = not enough data (no outstanding claims or no charges in the window).
 */

export type ChargeForMetrics = {
  status: string;
  billedAmount: number;
  /** YYYY-MM-DD date of service */
  dos: string;
};

export function nonDeniedClaimShare(charges: ChargeForMetrics[]): number | null {
  if (!charges.length) return null;
  const denied = charges.filter((c) => c.status === 'Denied').length;
  return (charges.length - denied) / charges.length;
}

export function daysInAr(charges: ChargeForMetrics[], now: Date, windowDays = 90): number | null {
  const outstanding = charges
    .filter((c) => c.status === 'Submitted' || c.status === 'Denied')
    .reduce((sum, c) => sum + c.billedAmount, 0);
  const since = now.getTime() - windowDays * 86_400_000;
  const windowCharges = charges
    .filter((c) => {
      const t = new Date(`${c.dos}T12:00:00Z`).getTime();
      return Number.isFinite(t) && t >= since && t <= now.getTime();
    })
    .reduce((sum, c) => sum + c.billedAmount, 0);
  if (outstanding <= 0 || windowCharges <= 0) return null;
  return outstanding / (windowCharges / windowDays);
}
