/**
 * Vitals calculations shared by the Visits and Vitals pages. Pure, no data.
 * (Moved out of the old data.ts, which also held in-memory sample caches.)
 */

export function calculateBMI(weightLbs: number, heightInches: number): number {
  if (!weightLbs || !heightInches || heightInches <= 0) return 0;
  const bmi = (weightLbs / (heightInches * heightInches)) * 703;
  return Math.round(bmi * 10) / 10;
}

export function getBPStaging(systolic: number | null | undefined, diastolic: number | null | undefined): {
  stage: string;
  badgeClass: string;
  color: string;
} {
  if (systolic == null || diastolic == null) {
    return { stage: 'BP not recorded', badgeClass: 'bg-slate-50 text-slate-500 ring-slate-200', color: '#94A3B8' };
  }
  if (systolic < 120 && diastolic < 80) {
    return { stage: 'Normal (<120/80)', badgeClass: 'bg-emerald-50 text-emerald-700 ring-emerald-200', color: '#10B981' };
  }
  if (systolic >= 120 && systolic <= 129 && diastolic < 80) {
    return { stage: 'Elevated (120-129/<80)', badgeClass: 'bg-yellow-50 text-yellow-800 ring-yellow-200', color: '#EAB308' };
  }
  if ((systolic >= 130 && systolic <= 139) || (diastolic >= 80 && diastolic <= 89)) {
    return { stage: 'Stage 1 HTN (130-139/80-89)', badgeClass: 'bg-amber-50 text-amber-700 ring-amber-200', color: '#F59E0B' };
  }
  return { stage: 'Stage 2 HTN (>=140 or >=90)', badgeClass: 'bg-rose-50 text-rose-700 ring-rose-200', color: '#EF4444' };
}
