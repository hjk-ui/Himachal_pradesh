import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { DEFAULT_BUSINESS_HOURS, DEFAULT_SMALL_CELL_THRESHOLD, INTEGRATIONS, type BusinessHours } from './constants';
import { isSnsSmsConfigured } from '@/lib/sms/send';
import { isSmtpConfigured } from '@/lib/email/smtp';
import { isBedrockConfigured } from '@/lib/ai/bedrockService';

export type MarketingSettingsDTO = {
  timeZone: string;
  businessHours: BusinessHours;
  quietHoursStart: string;
  quietHoursEnd: string;
  physicalAddress: string | null;
  marketingAuthTemplateKey: string;
  testimonialAuthTemplateKey: string;
  senderIdentities: { kind: 'email' | 'sms'; label: string; address: string }[];
  brandVoice: string | null;
  autoReplyEnabled: boolean;
  autoReplyText: string | null;
  missedCallTextBack: boolean;
  missedCallText: string | null;
  speedToLeadMinutes: number;
  smallCellThreshold: number;
  aiFeatures: Record<string, boolean>;
  integrationNotes: Record<string, string>;
  publicFormsEnabled: boolean;
};

export type DeliveryStatus = {
  sms: boolean;
  email: boolean;
  ai: boolean;
  phoneEvents: boolean;
  integrations: { key: string; label: string; status: 'not_connected' | 'ready'; setup: string; note: string }[];
};

function toDTO(row: Awaited<ReturnType<typeof prisma.marketingSettings.findUnique>>): MarketingSettingsDTO {
  return {
    timeZone: row?.timeZone ?? 'America/New_York',
    businessHours: (row?.businessHours as unknown as BusinessHours | null) ?? DEFAULT_BUSINESS_HOURS,
    quietHoursStart: row?.quietHoursStart ?? '20:00',
    quietHoursEnd: row?.quietHoursEnd ?? '09:00',
    physicalAddress: row?.physicalAddress ?? null,
    marketingAuthTemplateKey: row?.marketingAuthTemplateKey ?? 'marketing-authorization',
    testimonialAuthTemplateKey: row?.testimonialAuthTemplateKey ?? 'testimonial-authorization',
    senderIdentities: Array.isArray(row?.senderIdentities) ? (row!.senderIdentities as unknown as MarketingSettingsDTO['senderIdentities']) : [],
    brandVoice: row?.brandVoice ?? null,
    autoReplyEnabled: row?.autoReplyEnabled ?? false,
    autoReplyText: row?.autoReplyText ?? null,
    missedCallTextBack: row?.missedCallTextBack ?? false,
    missedCallText: row?.missedCallText ?? null,
    speedToLeadMinutes: row?.speedToLeadMinutes ?? 15,
    smallCellThreshold: row?.smallCellThreshold ?? DEFAULT_SMALL_CELL_THRESHOLD,
    aiFeatures: (row?.aiFeatures as unknown as Record<string, boolean> | null) ?? {},
    integrationNotes: (row?.integrations as unknown as Record<string, string> | null) ?? {},
    publicFormsEnabled: row?.publicFormsEnabled ?? true,
  };
}

export async function getMarketingSettings(organizationId: string): Promise<MarketingSettingsDTO> {
  const row = await prisma.marketingSettings.findUnique({ where: { organizationId } });
  return toDTO(row);
}

export async function saveMarketingSettings(organizationId: string, userId: string, patch: Partial<MarketingSettingsDTO>) {
  const data: Prisma.MarketingSettingsUncheckedCreateInput = { organizationId, updatedById: userId };
  const d = data as Record<string, unknown>;
  const copy = ['timeZone', 'quietHoursStart', 'quietHoursEnd', 'physicalAddress', 'marketingAuthTemplateKey', 'testimonialAuthTemplateKey', 'brandVoice', 'autoReplyEnabled', 'autoReplyText', 'missedCallTextBack', 'missedCallText', 'speedToLeadMinutes', 'smallCellThreshold', 'publicFormsEnabled'] as const;
  for (const k of copy) if (patch[k] !== undefined) d[k] = patch[k];
  if (patch.businessHours !== undefined) d.businessHours = patch.businessHours as unknown as Prisma.InputJsonValue;
  if (patch.senderIdentities !== undefined) d.senderIdentities = patch.senderIdentities as unknown as Prisma.InputJsonValue;
  if (patch.aiFeatures !== undefined) d.aiFeatures = patch.aiFeatures as unknown as Prisma.InputJsonValue;
  if (patch.integrationNotes !== undefined) d.integrations = patch.integrationNotes as unknown as Prisma.InputJsonValue;
  const update = { ...data } as Record<string, unknown>;
  delete update.organizationId;
  const row = await prisma.marketingSettings.upsert({ where: { organizationId }, create: data, update: update as Prisma.MarketingSettingsUncheckedUpdateInput });
  return toDTO(row);
}

/** What is actually wired on this server. Integrations without an API connection stay not_connected. */
export function deliveryStatus(notes: Record<string, string> = {}): DeliveryStatus {
  const sms = isSnsSmsConfigured();
  const email = isSmtpConfigured();
  return {
    sms,
    email,
    ai: isBedrockConfigured(),
    phoneEvents: false,
    integrations: INTEGRATIONS.map((i) => ({
      key: i.key,
      label: i.label,
      // Only the SES sender and SMS number can be "ready" (they are real AWS services already in this codebase)
      status: ((i.key === 'email' && email) || (i.key === 'phone' && sms) ? 'ready' : 'not_connected') as 'ready' | 'not_connected',
      setup: i.setup,
      note: notes[i.key] ?? '',
    })),
  };
}

export type PracticeInfo = { name: string; phone: string | null; email: string | null };

export async function practiceInfo(organizationId: string): Promise<PracticeInfo> {
  const [sched, org] = await Promise.all([
    prisma.schedulingSettings.findUnique({ where: { organizationId }, select: { practiceName: true, contactPhone: true } }).catch(() => null),
    prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } }).catch(() => null),
  ]);
  return { name: sched?.practiceName?.trim() || org?.name?.trim() || 'Our practice', phone: sched?.contactPhone ?? null, email: null };
}

export { withinBusinessHours } from './consent';
