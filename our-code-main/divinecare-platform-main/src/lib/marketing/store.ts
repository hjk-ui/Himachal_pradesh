import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/db/prisma';
import { PARTNER_TYPES } from '@/lib/marketing/constants';

export type MarketingKind =
  | 'form'
  | 'workflow'
  | 'review'
  | 'testimonial'
  | 'campaign'
  | 'social'
  | 'press'
  | 'partner'
  | 'event'
  | 'spend';

export type CampaignStatus = 'draft' | 'review' | 'approved' | 'sent' | 'send_back';
export type SocialStatus = 'draft' | 'review' | 'approved' | 'scheduled' | 'exported' | 'posted';

const prefix = (kind: MarketingKind) => `marketing:${kind}:`;

function asRecord(data: unknown): Record<string, unknown> {
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
}

export async function listMarketingItems<T extends Record<string, unknown>>(
  organizationId: string,
  kind: MarketingKind
): Promise<T[]> {
  const rows = await prisma.clinicModuleState.findMany({
    where: { organizationId, module: { startsWith: prefix(kind) } },
    orderBy: { updatedAt: 'desc' },
  });
  return rows.map((r) => {
    const data = asRecord(r.data);
    return { id: r.module.slice(prefix(kind).length), ...data } as unknown as T;
  });
}

export async function createMarketingItem(
  organizationId: string,
  kind: MarketingKind,
  data: Record<string, unknown>
) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const payload = { ...data, createdAt: now, updatedAt: now };
  await prisma.clinicModuleState.create({
    data: {
      organizationId,
      module: `${prefix(kind)}${id}`,
      data: payload,
    },
  });
  return { id, ...payload };
}

export async function updateMarketingItem(
  organizationId: string,
  kind: MarketingKind,
  id: string,
  patch: Record<string, unknown>
) {
  const module = `${prefix(kind)}${id}`;
  const existing = await prisma.clinicModuleState.findUnique({
    where: { organizationId_module: { organizationId, module } },
  });
  if (!existing) return { ok: false as const, error: 'Not found', status: 404 };
  const next = {
    ...asRecord(existing.data),
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await prisma.clinicModuleState.update({
    where: { organizationId_module: { organizationId, module } },
    data: { data: next },
  });
  return { ok: true as const, item: { id, ...next } };
}

export async function deleteMarketingItem(
  organizationId: string,
  kind: MarketingKind,
  id: string
) {
  const module = `${prefix(kind)}${id}`;
  try {
    await prisma.clinicModuleState.delete({
      where: { organizationId_module: { organizationId, module } },
    });
    return { ok: true as const };
  } catch {
    return { ok: false as const, error: 'Not found', status: 404 };
  }
}

export const CAMPAIGN_TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  draft: ['review'],
  review: ['approved', 'send_back'],
  send_back: ['review', 'draft'],
  approved: ['sent'],
  sent: [],
};

export function assertPartnerType(value: string) {
  return (PARTNER_TYPES as readonly string[]).includes(value) ? value : 'Other';
}
