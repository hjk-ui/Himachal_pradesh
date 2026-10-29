import { getModuleData, saveModuleData } from '@/lib/modules/manage';

/** ClinicModuleState module holding the practice MBC options. */
export const MBC_OPTIONS_MODULE = 'practice:mbc-options';

export type MbcOptions = {
  mbcAutoSend: boolean;
  mbcVisitRule: boolean;
  mbcProgramRule: boolean;
  mbcProviderRule: boolean;
};

/** Every option is OFF until the practice turns it on. */
export const MBC_OPTION_DEFAULTS: MbcOptions = {
  mbcAutoSend: false,
  mbcVisitRule: false,
  mbcProgramRule: false,
  mbcProviderRule: false,
};

export const MBC_OPTION_KEYS = Object.keys(MBC_OPTION_DEFAULTS) as (keyof MbcOptions)[];

/** Only literal `true` turns an option on; anything else (missing, malformed) is OFF. */
export function normalizeMbcOptions(raw: unknown): MbcOptions {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    mbcAutoSend: src.mbcAutoSend === true,
    mbcVisitRule: src.mbcVisitRule === true,
    mbcProgramRule: src.mbcProgramRule === true,
    mbcProviderRule: src.mbcProviderRule === true,
  };
}

export async function getMbcOptions(organizationId: string): Promise<MbcOptions> {
  return normalizeMbcOptions(await getModuleData<unknown>(organizationId, MBC_OPTIONS_MODULE));
}

export async function saveMbcOptions(organizationId: string, patch: Partial<MbcOptions>): Promise<MbcOptions> {
  const next = normalizeMbcOptions({ ...(await getMbcOptions(organizationId)), ...patch });
  await saveModuleData(organizationId, MBC_OPTIONS_MODULE, next);
  return next;
}
