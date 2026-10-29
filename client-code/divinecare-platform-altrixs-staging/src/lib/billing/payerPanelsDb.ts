/** Insurance panels persistence (PayerPanel). Rules: src/lib/billing/payerPanels.ts. */
import type { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { getModuleData } from '@/lib/modules/manage';
import { changedFields } from './payerMaster';
import { legacyPanelToInput, panelInputSchema, type PanelRow, type PanelStatus } from './payerPanels';

export class PanelError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

const PROVIDER_ROLES: Role[] = ['THERAPIST', 'PSYCHIATRIST', 'NP', 'CLINICIAN', 'PHYSICIAN', 'MEDICAL_NP'];
export const LEGACY_PANEL_MODULE = 'payer-panels';

const toDate = (v: string | null | undefined) => (v ? new Date(`${v}T00:00:00Z`) : null);
const fromDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** Org staff who can be on a panel: clinicians, plus anyone with an NPI. */
export async function listPanelStaff(organizationId: string) {
  const staff = await prisma.user.findMany({
    where: { organizationId, status: 'ACTIVE', OR: [{ role: { in: PROVIDER_ROLES } }, { npi: { not: null } }] },
    select: { id: true, name: true, npi: true, credentials: true, role: true },
    orderBy: { name: 'asc' },
    take: 500,
  });
  return staff.map((s) => ({ id: s.id, name: s.name || s.id, npi: s.npi, credentials: s.credentials, role: s.role }));
}

type DbPanel = Awaited<ReturnType<typeof prisma.payerPanel.findMany>>[number];

function panelData(input: ReturnType<typeof panelInputSchema.parse>, payerName: string) {
  return {
    payerRegistryId: input.payerRegistryId ?? null,
    payerName,
    providerUserIds: Array.from(new Set(input.providerUserIds)),
    status: input.status,
    submittedDate: toDate(input.submittedDate),
    effectiveDate: toDate(input.effectiveDate),
    recredentialingDueDate: toDate(input.recredentialingDueDate),
    providerPin: input.providerPin ?? null,
    openToNewClients: input.openToNewClients,
    contactName: input.contactName ?? null,
    contactPhone: input.contactPhone ?? null,
    contactEmail: input.contactEmail ?? null,
    notes: input.notes ?? null,
  };
}

/** Validates input against this org's payer master and staff; returns the row data. */
async function resolve(organizationId: string, raw: unknown) {
  const input = panelInputSchema.parse(raw);
  let payerName = input.payerName ?? '';
  if (input.payerRegistryId) {
    const reg = await prisma.payerRegistry.findFirst({ where: { id: input.payerRegistryId, organizationId }, select: { name: true } });
    if (!reg) throw new PanelError('That payer is not in the payer list', 404);
    payerName = reg.name;
  }
  if (input.providerUserIds.length) {
    const ok = await prisma.user.count({ where: { organizationId, id: { in: input.providerUserIds } } });
    if (ok !== new Set(input.providerUserIds).size) throw new PanelError('One of the providers is not on this practice\'s staff');
  }
  return panelData(input, payerName);
}

export async function listPanels(organizationId: string): Promise<PanelRow[]> {
  const [rows, staff, registry] = await Promise.all([
    prisma.payerPanel.findMany({ where: { organizationId }, orderBy: [{ payerName: 'asc' }, { createdAt: 'asc' }] }),
    prisma.user.findMany({ where: { organizationId }, select: { id: true, name: true, npi: true } }),
    prisma.payerRegistry.findMany({ where: { organizationId }, select: { id: true, payerId: true } }),
  ]);
  const byId = new Map(staff.map((s) => [s.id, s]));
  const regId = new Map(registry.map((r) => [r.id, r.payerId]));
  return rows.map((p: DbPanel) => ({
    id: p.id,
    payerRegistryId: p.payerRegistryId,
    payerName: p.payerName,
    registryPayerId: p.payerRegistryId ? regId.get(p.payerRegistryId) ?? null : null,
    providerUserIds: p.providerUserIds,
    providers: p.providerUserIds.map((id) => {
      const s = byId.get(id);
      return { id, name: s?.name || 'Former staff member', npi: s?.npi ?? null };
    }),
    status: p.status as PanelStatus,
    submittedDate: fromDate(p.submittedDate),
    effectiveDate: fromDate(p.effectiveDate),
    recredentialingDueDate: fromDate(p.recredentialingDueDate),
    providerPin: p.providerPin,
    openToNewClients: p.openToNewClients,
    contactName: p.contactName,
    contactPhone: p.contactPhone,
    contactEmail: p.contactEmail,
    notes: p.notes,
    updatedAt: p.updatedAt.toISOString(),
  }));
}

export async function createPanel(organizationId: string, actorUserId: string, raw: unknown) {
  const data = await resolve(organizationId, raw);
  const row = await prisma.payerPanel.create({ data: { organizationId, ...data, createdById: actorUserId, updatedById: actorUserId } });
  return { row, fields: changedFields(null, { ...data, providerUserIds: data.providerUserIds.length ? data.providerUserIds : null, openToNewClients: data.openToNewClients || null }) };
}

export async function updatePanel(organizationId: string, actorUserId: string, id: string, raw: unknown) {
  const existing = await prisma.payerPanel.findFirst({ where: { id, organizationId } });
  if (!existing) throw new PanelError('Panel not found', 404);
  const data = await resolve(organizationId, raw);
  const fields = changedFields(existing as unknown as Record<string, unknown>, data);
  if (!fields.length) return { row: existing, fields };
  const row = await prisma.payerPanel.update({ where: { id }, data: { ...data, updatedById: actorUserId } });
  return { row, fields };
}

/** Old 'payer-panels' module records not imported yet. */
export async function pendingLegacyPanels(organizationId: string) {
  const data = await getModuleData<unknown[]>(organizationId, LEGACY_PANEL_MODULE).catch(() => null);
  const items = (Array.isArray(data) ? data : [])
    .map((x) => (x && typeof x === 'object' ? legacyPanelToInput(x as Record<string, unknown>) : null))
    .filter((x): x is NonNullable<typeof x> => Boolean(x));
  if (!items.length) return [];
  const done = await prisma.payerPanel.findMany({
    where: { organizationId, legacyId: { in: items.map((i) => i.legacyId) } },
    select: { legacyId: true },
  });
  const seen = new Set(done.map((d) => d.legacyId));
  return items.filter((i) => !seen.has(i.legacyId));
}

/** Imports the old module-list panels (idempotent by legacyId). The module list itself is left as is. */
export async function importLegacyPanels(organizationId: string, actorUserId: string) {
  const pending = await pendingLegacyPanels(organizationId);
  let imported = 0;
  for (const p of pending) {
    const data = await resolve(organizationId, p.input);
    await prisma.payerPanel.create({ data: { organizationId, ...data, legacyId: p.legacyId, createdById: actorUserId, updatedById: actorUserId } });
    imported++;
  }
  return imported;
}
