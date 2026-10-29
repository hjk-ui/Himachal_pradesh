import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/db/prisma';
import type { Role } from '@prisma/client';
import { canAccessPath } from '@/lib/auth/roleAccess';
import {
  LEAD_SOURCES,
  LEAD_STAGES,
  OPEN_LEAD_STAGES,
  type LeadSource,
  type LeadStage,
} from '@/lib/marketing/constants';

const LEAD_PREFIX = 'marketing-lead:';
const SETTINGS_MODULE = 'marketing-settings';

export type MarketingLead = {
  id: string;
  name: string;
  phone: string;
  email: string;
  stage: LeadStage;
  source: LeadSource;
  notes: string;
  messages: string[];
  tasks: string[];
  consentSms: boolean;
  createdAt: string;
  updatedAt: string;
  createdById: string | null;
};

export function canAccessMarketing(role: Role) {
  return canAccessPath(role, '/dashboard/marketing');
}

export function canAccessMarketingLeads(role: Role) {
  return canAccessPath(role, '/dashboard/marketing/leads');
}

function parseLead(module: string, data: unknown): MarketingLead | null {
  if (!module.startsWith(LEAD_PREFIX) || !data || typeof data !== 'object') return null;
  const row = data as Record<string, unknown>;
  const stage = String(row.stage || 'New') as LeadStage;
  const source = String(row.source || 'Other') as LeadSource;
  if (!LEAD_STAGES.includes(stage) || !LEAD_SOURCES.includes(source)) return null;
  return {
    id: module.slice(LEAD_PREFIX.length),
    name: String(row.name || ''),
    phone: String(row.phone || ''),
    email: String(row.email || ''),
    stage,
    source,
    notes: String(row.notes || ''),
    messages: Array.isArray(row.messages) ? (row.messages as string[]) : [],
    tasks: Array.isArray(row.tasks) ? (row.tasks as string[]) : [],
    consentSms: Boolean(row.consentSms),
    createdAt: String(row.createdAt || new Date().toISOString()),
    updatedAt: String(row.updatedAt || new Date().toISOString()),
    createdById: row.createdById ? String(row.createdById) : null,
  };
}

export async function listMarketingLeads(organizationId: string, opts?: { includeClosed?: boolean }) {
  const rows = await prisma.clinicModuleState.findMany({
    where: { organizationId, module: { startsWith: LEAD_PREFIX } },
    orderBy: { updatedAt: 'desc' },
  });
  const leads = rows
    .map((r) => parseLead(r.module, r.data))
    .filter((l): l is MarketingLead => Boolean(l));
  if (opts?.includeClosed) return leads;
  return leads.filter((l) => OPEN_LEAD_STAGES.includes(l.stage));
}

export async function createMarketingLead(
  organizationId: string,
  actorUserId: string,
  input: { name: string; phone?: string; email?: string; source?: LeadSource; notes?: string }
) {
  const name = input.name.trim();
  if (!name) return { ok: false as const, error: 'Name is required', status: 400 };
  const id = randomUUID();
  const now = new Date().toISOString();
  const data: MarketingLead = {
    id,
    name,
    phone: (input.phone || '').trim(),
    email: (input.email || '').trim(),
    stage: 'New',
    source: input.source && LEAD_SOURCES.includes(input.source) ? input.source : 'Other',
    notes: (input.notes || '').trim(),
    messages: [],
    tasks: [],
    consentSms: false,
    createdAt: now,
    updatedAt: now,
    createdById: actorUserId,
  };
  await prisma.clinicModuleState.create({
    data: {
      organizationId,
      module: `${LEAD_PREFIX}${id}`,
      data,
    },
  });
  return { ok: true as const, lead: data };
}

export async function updateMarketingLead(
  organizationId: string,
  leadId: string,
  patch: Partial<Pick<MarketingLead, 'stage' | 'source' | 'notes' | 'consentSms' | 'messages' | 'tasks'>>
) {
  if (patch.stage && !LEAD_STAGES.includes(patch.stage)) {
    return { ok: false as const, error: 'Invalid stage', status: 400 };
  }
  if (patch.source && !LEAD_SOURCES.includes(patch.source)) {
    return { ok: false as const, error: 'Invalid source', status: 400 };
  }
  const module = `${LEAD_PREFIX}${leadId}`;
  const existing = await prisma.clinicModuleState.findUnique({
    where: { organizationId_module: { organizationId, module } },
  });
  if (!existing) return { ok: false as const, error: 'Lead not found', status: 404 };
  const lead = parseLead(module, existing.data);
  if (!lead) return { ok: false as const, error: 'Lead corrupt', status: 500 };
  const next = { ...lead, ...patch, updatedAt: new Date().toISOString() };
  await prisma.clinicModuleState.update({
    where: { organizationId_module: { organizationId, module } },
    data: { data: next },
  });
  return { ok: true as const, lead: next };
}

/** @deprecated use updateMarketingLead */
export async function updateMarketingLeadStage(
  organizationId: string,
  leadId: string,
  stage: LeadStage
) {
  return updateMarketingLead(organizationId, leadId, { stage });
}

export type MarketingSettings = {
  postalAddress: string;
  channelsConnected: boolean;
  brandKit: string;
  leadResponseHours: string;
  templates: string;
  aiFeatures: boolean;
};

export async function getMarketingSettings(organizationId: string): Promise<MarketingSettings> {
  const row = await prisma.clinicModuleState.findUnique({
    where: { organizationId_module: { organizationId, module: SETTINGS_MODULE } },
  });
  const data = (row?.data || {}) as Record<string, unknown>;
  return {
    postalAddress: String(data.postalAddress || ''),
    channelsConnected: Boolean(data.channelsConnected),
    brandKit: String(data.brandKit || ''),
    leadResponseHours: String(data.leadResponseHours || '24'),
    templates: String(data.templates || ''),
    aiFeatures: Boolean(data.aiFeatures),
  };
}

export async function saveMarketingSettings(
  organizationId: string,
  input: Partial<MarketingSettings>
) {
  const prev = await getMarketingSettings(organizationId);
  const data: MarketingSettings = {
    postalAddress:
      input.postalAddress !== undefined ? input.postalAddress.trim() : prev.postalAddress,
    channelsConnected:
      input.channelsConnected !== undefined ? input.channelsConnected : prev.channelsConnected,
    brandKit: input.brandKit !== undefined ? input.brandKit : prev.brandKit,
    leadResponseHours:
      input.leadResponseHours !== undefined ? input.leadResponseHours : prev.leadResponseHours,
    templates: input.templates !== undefined ? input.templates : prev.templates,
    aiFeatures: input.aiFeatures !== undefined ? input.aiFeatures : prev.aiFeatures,
  };
  await prisma.clinicModuleState.upsert({
    where: { organizationId_module: { organizationId, module: SETTINGS_MODULE } },
    create: { organizationId, module: SETTINGS_MODULE, data },
    update: { data },
  });
  return data;
}
