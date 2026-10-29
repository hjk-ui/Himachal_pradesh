import { getModuleData, saveModuleData } from '@/lib/modules/manage';

export const PRIMARY_CARE_SETTINGS_MODULE = 'primary-care-settings';

/**
 * Policy windows — empty means none on file (do not invent 7/14/30 defaults into UI as confirmed).
 * Staging prompt documents practice targets; we store only when leadership sets them.
 */
export type PrimaryCareSettings = {
  /** Notify patient of results within N days — null = none on file */
  notifyPatientWithinDays: number | null;
  /** Expected lab turnaround days — null = none on file */
  labExpectedDays: number | null;
  /** Referral report expected days — null = none on file */
  referralReportDays: number | null;
  /** Suggested defaults shown as hints only (not enforced until saved) */
  suggestedNotifyDays: 7;
  suggestedLabDays: 14;
  suggestedReferralDays: 30;
  updatedAt: string | null;
};

export function emptyPrimaryCareSettings(): PrimaryCareSettings {
  return {
    notifyPatientWithinDays: null,
    labExpectedDays: null,
    referralReportDays: null,
    suggestedNotifyDays: 7,
    suggestedLabDays: 14,
    suggestedReferralDays: 30,
    updatedAt: null,
  };
}

export async function getPrimaryCareSettings(organizationId: string): Promise<PrimaryCareSettings> {
  const stored = await getModuleData<Partial<PrimaryCareSettings>>(
    organizationId,
    PRIMARY_CARE_SETTINGS_MODULE
  );
  const base = emptyPrimaryCareSettings();
  if (!stored) return base;
  return {
    ...base,
    notifyPatientWithinDays:
      typeof stored.notifyPatientWithinDays === 'number' ? stored.notifyPatientWithinDays : null,
    labExpectedDays: typeof stored.labExpectedDays === 'number' ? stored.labExpectedDays : null,
    referralReportDays:
      typeof stored.referralReportDays === 'number' ? stored.referralReportDays : null,
    updatedAt: typeof stored.updatedAt === 'string' ? stored.updatedAt : null,
  };
}

export async function savePrimaryCareSettings(
  organizationId: string,
  patch: Partial<Pick<PrimaryCareSettings, 'notifyPatientWithinDays' | 'labExpectedDays' | 'referralReportDays'>>
) {
  const current = await getPrimaryCareSettings(organizationId);
  const next: PrimaryCareSettings = {
    ...current,
    ...patch,
    suggestedNotifyDays: 7,
    suggestedLabDays: 14,
    suggestedReferralDays: 30,
    updatedAt: new Date().toISOString(),
  };
  await saveModuleData(organizationId, PRIMARY_CARE_SETTINGS_MODULE, next);
  return next;
}
