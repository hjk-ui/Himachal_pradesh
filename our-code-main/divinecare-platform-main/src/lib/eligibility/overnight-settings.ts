import { getModuleData, saveModuleData } from '@/lib/modules/manage';

export const OVERNIGHT_ELIGIBILITY_MODULE = 'overnight-eligibility-settings';

export type OvernightEligibilitySettings = {
  /** Automatic overnight eligibility checks — default OFF */
  enabled: boolean;
  /** Allow on test clearinghouse — default off */
  allowTestClearinghouse: boolean;
  updatedAt: string | null;
  updatedById: string | null;
};

export function defaultOvernightEligibilitySettings(): OvernightEligibilitySettings {
  return {
    enabled: false,
    allowTestClearinghouse: false,
    updatedAt: null,
    updatedById: null,
  };
}

export async function getOvernightEligibilitySettings(
  organizationId: string
): Promise<OvernightEligibilitySettings> {
  const stored = await getModuleData<Partial<OvernightEligibilitySettings>>(
    organizationId,
    OVERNIGHT_ELIGIBILITY_MODULE
  );
  const base = defaultOvernightEligibilitySettings();
  if (!stored) return base;
  return {
    enabled: stored.enabled === true,
    allowTestClearinghouse: stored.allowTestClearinghouse === true,
    updatedAt: typeof stored.updatedAt === 'string' ? stored.updatedAt : null,
    updatedById: typeof stored.updatedById === 'string' ? stored.updatedById : null,
  };
}

export async function saveOvernightEligibilitySettings(
  organizationId: string,
  patch: Partial<Pick<OvernightEligibilitySettings, 'enabled' | 'allowTestClearinghouse'>>,
  actorUserId: string
) {
  const current = await getOvernightEligibilitySettings(organizationId);
  const next: OvernightEligibilitySettings = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
    updatedById: actorUserId,
  };
  await saveModuleData(organizationId, OVERNIGHT_ELIGIBILITY_MODULE, next);
  return next;
}
