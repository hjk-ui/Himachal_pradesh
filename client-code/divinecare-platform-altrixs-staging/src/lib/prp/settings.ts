/**
 * PRP practice settings (server): billing model confirmation, monthly contact minimum and the IRP
 * review interval, all on PracticeSettings (same storage as the other practice policies). Leadership
 * edits them from the PRP hub; every write is audited by the route (/api/prp/settings).
 */
import { prisma } from '@/lib/db/prisma';
import { PRACTICE_POLICY_CONFIRM, prpBillingState, prpIrpIntervalLabel, prpIrpReviewDays, type PrpBillingModel, type PrpBillingState } from './standard';

/** Leadership confirms the billing model and sets PRP policy. */
export const PRP_SETTINGS_ROLES = new Set(['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR']);

export type PrpSettingsView = {
  billing: PrpBillingState & { confirmedByName: string | null };
  monthlyMinContacts: number | null;
  monthlyMinLabel: string;
  irpReviewDays: number;
  irpReviewDaysChild: number;
  irpReviewLabel: string;
  policyUpdatedAt: string | null;
  policyUpdatedByName: string | null;
};

const SELECT = {
  prpIrpReviewDays: true,
  prpBillingModel: true,
  prpBillingModelConfirmedBy: true,
  prpBillingModelConfirmedAt: true,
  prpMonthlyMinContacts: true,
  prpPolicyUpdatedBy: true,
  prpPolicyUpdatedAt: true,
} as const;

/** Raw row (null when the practice has no settings yet or the read fails: then nothing is confirmed). */
export async function loadPrpSettingsRow(organizationId: string) {
  try {
    return await prisma.practiceSettings.findUnique({ where: { organizationId }, select: SELECT });
  } catch {
    return null;
  }
}

async function userNames(organizationId: string, ids: (string | null | undefined)[]) {
  const list = [...new Set(ids.filter((v): v is string => !!v))];
  if (!list.length) return new Map<string, string>();
  const rows = await prisma.user.findMany({ where: { id: { in: list }, organizationId }, select: { id: true, name: true, email: true } });
  return new Map(rows.map((u) => [u.id, u.name || u.email]));
}

export async function loadPrpSettings(organizationId: string): Promise<PrpSettingsView> {
  const row = await loadPrpSettingsRow(organizationId);
  const names = await userNames(organizationId, [row?.prpBillingModelConfirmedBy, row?.prpPolicyUpdatedBy]).catch(() => new Map<string, string>());
  const billing = prpBillingState(row);
  const min = row?.prpMonthlyMinContacts ?? null;
  return {
    billing: { ...billing, confirmedByName: billing.confirmedBy ? names.get(billing.confirmedBy) ?? 'Former staff member' : null },
    monthlyMinContacts: min,
    monthlyMinLabel: min == null ? `Not set (${PRACTICE_POLICY_CONFIRM})` : `${min} contacts per participant per month (practice policy)`,
    irpReviewDays: prpIrpReviewDays(null, row?.prpIrpReviewDays ?? null),
    irpReviewDaysChild: prpIrpReviewDays(10, row?.prpIrpReviewDays ?? null),
    irpReviewLabel: prpIrpIntervalLabel(row?.prpIrpReviewDays ?? null),
    policyUpdatedAt: row?.prpPolicyUpdatedAt?.toISOString() ?? null,
    policyUpdatedByName: row?.prpPolicyUpdatedBy ? names.get(row.prpPolicyUpdatedBy) ?? 'Former staff member' : null,
  };
}

export type PrpSettingsPatch = {
  /** null clears the confirmation (back to "not confirmed") */
  billingModel?: PrpBillingModel | null;
  /** null = not set */
  monthlyMinContacts?: number | null;
  irpReviewDays?: number;
};

export async function savePrpSettings(organizationId: string, userId: string, patch: PrpSettingsPatch) {
  const now = new Date();
  const policyChanged = patch.monthlyMinContacts !== undefined || patch.irpReviewDays !== undefined;
  const data = {
    ...(patch.billingModel !== undefined
      ? patch.billingModel === null
        ? { prpBillingModel: null, prpBillingModelConfirmedBy: null, prpBillingModelConfirmedAt: null }
        : { prpBillingModel: patch.billingModel, prpBillingModelConfirmedBy: userId, prpBillingModelConfirmedAt: now }
      : {}),
    ...(patch.monthlyMinContacts !== undefined ? { prpMonthlyMinContacts: patch.monthlyMinContacts } : {}),
    ...(patch.irpReviewDays !== undefined ? { prpIrpReviewDays: patch.irpReviewDays } : {}),
    ...(policyChanged ? { prpPolicyUpdatedBy: userId, prpPolicyUpdatedAt: now } : {}),
  };
  await prisma.practiceSettings.upsert({ where: { organizationId }, create: { organizationId, ...data }, update: data });
  return loadPrpSettings(organizationId);
}
