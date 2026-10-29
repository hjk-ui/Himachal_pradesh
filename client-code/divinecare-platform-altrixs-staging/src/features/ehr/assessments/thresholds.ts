// Matches the clinician-dashboard branch's configured MBC rules.
export const MBC_THRESHOLDS: Record<string, number> = { 'phq-9': 20, 'gad-7': 15, 'c-ssrs-brief': 3, 'pcl-5': 60, rms: 5 };
export function isMbcAlert(record: { instrumentId: string; totalScore: number | null; safetyFlagged: boolean }) {
  const threshold = MBC_THRESHOLDS[record.instrumentId];
  return record.safetyFlagged || (threshold !== undefined && record.totalScore !== null && record.totalScore >= threshold);
}
