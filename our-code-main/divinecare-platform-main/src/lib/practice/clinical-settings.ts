import { getModuleData, saveModuleData } from '@/lib/modules/manage';
import { addCalendarDays, clinicDate } from '@/lib/workflows/dates';

export const CLINICAL_SETTINGS_MODULE = 'practice-clinical-settings';

/** Maryland BH go-live default — Oct 21 staging / Nov 1 go-live */
export const DEFAULT_GO_LIVE_DATE = '2026-11-01';

/** Allow signing without active TP until go-live + 30 days */
export const GO_LIVE_TRANSITION_DAYS = 30;

export const TREATMENT_PLAN_PENDING_LABEL = 'Treatment plan pending (go-live transition)';

export type PracticeClinicalSettings = {
  goLiveDate: string;
};

export async function getPracticeClinicalSettings(
  organizationId: string
): Promise<PracticeClinicalSettings> {
  const stored = await getModuleData<Partial<PracticeClinicalSettings>>(
    organizationId,
    CLINICAL_SETTINGS_MODULE
  );
  return {
    goLiveDate:
      typeof stored?.goLiveDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(stored.goLiveDate)
        ? stored.goLiveDate
        : DEFAULT_GO_LIVE_DATE,
  };
}

export async function savePracticeClinicalSettings(
  organizationId: string,
  settings: PracticeClinicalSettings
) {
  await saveModuleData(organizationId, CLINICAL_SETTINGS_MODULE, settings);
}

export function goLiveTransitionEnd(goLiveDate: string): string {
  return addCalendarDays(goLiveDate, GO_LIVE_TRANSITION_DAYS);
}

export function isWithinGoLiveTransition(goLiveDate: string, now = new Date()): boolean {
  const today = clinicDate(now);
  return today <= goLiveTransitionEnd(goLiveDate);
}

/** Adult ITP review ≤180; under 18 ≤90 (Practice Settings / COMAR-aligned) */
export function treatmentPlanReviewMaxDays(minor: boolean): number {
  return minor ? 90 : 180;
}
