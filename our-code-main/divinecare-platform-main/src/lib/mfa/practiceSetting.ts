import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';

/** ClinicModuleState module key for practice-level security settings. */
export const PRACTICE_SECURITY_MODULE = 'practice:security';

export type PracticeSecuritySettings = {
  /** Staff must use two-factor sign-in (default on). */
  mfaRequired: boolean;
};

export const DEFAULT_PRACTICE_SECURITY: PracticeSecuritySettings = { mfaRequired: true };

export function parsePracticeSecurity(data: unknown): PracticeSecuritySettings {
  const raw = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  return {
    mfaRequired:
      typeof raw.mfaRequired === 'boolean' ? raw.mfaRequired : DEFAULT_PRACTICE_SECURITY.mfaRequired,
  };
}

export async function getPracticeSecurity(organizationId: string): Promise<PracticeSecuritySettings> {
  const row = await prisma.clinicModuleState.findUnique({
    where: { organizationId_module: { organizationId, module: PRACTICE_SECURITY_MODULE } },
    select: { data: true },
  });
  return parsePracticeSecurity(row?.data);
}

export async function setPracticeSecurity(
  organizationId: string,
  patch: Partial<PracticeSecuritySettings>
): Promise<PracticeSecuritySettings> {
  const next = { ...(await getPracticeSecurity(organizationId)), ...patch };
  const data = next as unknown as Prisma.InputJsonValue;
  await prisma.clinicModuleState.upsert({
    where: { organizationId_module: { organizationId, module: PRACTICE_SECURITY_MODULE } },
    create: { organizationId, module: PRACTICE_SECURITY_MODULE, data },
    update: { data },
  });
  return next;
}

/**
 * Master switch. Rollout is gated by env: MFA is only *required* at sign-in when
 * MFA_ENFORCE=true AND the practice has mfaRequired on. Staff who enrolled are
 * always challenged regardless.
 */
export function isMfaEnforcedByEnv(): boolean {
  return process.env.MFA_ENFORCE === 'true';
}
