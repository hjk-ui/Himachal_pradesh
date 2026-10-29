/**
 * Payer master persistence (PayerRegistry) for Billing › Payers. Rules: src/lib/billing/payerMaster.ts.
 * Never writes WaystarPayerMapping (the page saves claim rules through waystarConfig.savePayerMapping).
 */
import { prisma } from '@/lib/db/prisma';
import { listPayerMappings } from './waystarConfig';
import {
  changedFields,
  findLinkedMapping,
  payerMasterData,
  payerMasterInputSchema,
  type PayerMasterRow,
  type ValantPayerOption,
} from './payerMaster';

export class PayerMasterError extends Error {
  constructor(message: string, public status = 400, public existingId?: string) {
    super(message);
  }
}

type RegistryRow = Awaited<ReturnType<typeof prisma.payerRegistry.findMany>>[number];

function rowOf(r: RegistryRow): Omit<PayerMasterRow, 'valant' | 'waystar'> {
  return {
    id: r.id,
    name: r.name,
    payerId: r.payerId ?? null,
    payerType: (r.payerType ?? null) as PayerMasterRow['payerType'],
    clearinghouse: r.clearinghouse,
    claimsAddressLine1: r.claimsAddressLine1 ?? null,
    claimsAddressLine2: r.claimsAddressLine2 ?? null,
    claimsCity: r.claimsCity ?? null,
    claimsState: r.claimsState ?? null,
    claimsZip: r.claimsZip ?? null,
    claimsAddress: r.claimsAddress ?? null,
    phone: r.phone ?? null,
    fax: r.fax ?? null,
    portalUrl: r.portalUrl ?? null,
    timelyFilingDays: r.timelyFilingDays ?? null,
    eraEnrollmentStatus: r.eraEnrollmentStatus,
    eftEnrollmentStatus: r.eftEnrollmentStatus,
    notes: r.notes ?? null,
    active: r.active,
    updatedAt: r.updatedAt.toISOString(),
  };
}

export async function listPayerMaster(organizationId: string): Promise<PayerMasterRow[]> {
  const [rows, mappings, valant] = await Promise.all([
    prisma.payerRegistry.findMany({ where: { organizationId }, orderBy: { name: 'asc' } }),
    listPayerMappings(organizationId).catch(() => []),
    prisma.valantPayer
      .findMany({ where: { organizationId, payerRegistryId: { not: null } }, select: { id: true, name: true, ediPayerId: true, payerRegistryId: true } })
      .catch(() => []),
  ]);
  return rows.map((r) => ({
    ...rowOf(r),
    valant: valant.filter((v) => v.payerRegistryId === r.id).map((v) => ({ id: v.id, name: v.name, ediPayerId: v.ediPayerId })),
    waystar: findLinkedMapping({ name: r.name, payerId: r.payerId }, mappings),
  }));
}

/** Valant insurance companies with their claim addresses, for "Start from Valant". Reference data. */
export async function listValantPayerOptions(organizationId: string): Promise<ValantPayerOption[]> {
  const rows = await prisma.valantPayer
    .findMany({
      where: { organizationId },
      select: {
        id: true, name: true, ediPayerId: true, payerRegistryId: true,
        addresses: {
          orderBy: { position: 'asc' },
          select: { id: true, addressLine: true, city: true, state: true, zip: true, addressRaw: true, addressStatus: true, phone: true },
        },
      },
      orderBy: { name: 'asc' },
    })
    .catch(() => []);
  return rows;
}

/** Create a payer (optionally linking the Valant insurance company it started from). Returns changed field names for the audit. */
export async function createPayer(organizationId: string, actorUserId: string, input: unknown, valantPayerId?: string | null) {
  const data = payerMasterData(payerMasterInputSchema.parse(input));
  if (data.payerId) {
    const clash = await prisma.payerRegistry.findFirst({ where: { organizationId, payerId: data.payerId }, select: { id: true, name: true } });
    if (clash) throw new PayerMasterError(`Payer ID ${data.payerId} is already used by "${clash.name}"`, 409, clash.id);
  }
  const valant = valantPayerId
    ? await prisma.valantPayer.findFirst({ where: { id: valantPayerId, organizationId }, select: { id: true, ediPayerId: true, payerRegistryId: true } })
    : null;
  if (valantPayerId && !valant) throw new PayerMasterError('Valant insurance company not found', 404);
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.payerRegistry.create({ data: { organizationId, ...data, updatedById: actorUserId } });
    // Same link as Insurance companies › create_registry (explicit staff action)
    if (valant) await tx.valantPayer.update({ where: { id: valant.id }, data: { payerRegistryId: created.id, linkedById: actorUserId, linkedAt: new Date() } });
    return created;
  });
  return {
    row,
    fields: changedFields(null, data),
    valantLinked: Boolean(valant),
    sameAsValantEdi: Boolean(valant?.ediPayerId && data.payerId && valant.ediPayerId.toUpperCase() === data.payerId),
  };
}

export async function updatePayer(organizationId: string, actorUserId: string, id: string, input: unknown) {
  const existing = await prisma.payerRegistry.findFirst({ where: { id, organizationId } });
  if (!existing) throw new PayerMasterError('Payer not found', 404);
  const data = payerMasterData(payerMasterInputSchema.parse(input));
  if (data.payerId && data.payerId !== existing.payerId) {
    const clash = await prisma.payerRegistry.findFirst({ where: { organizationId, payerId: data.payerId, id: { not: id } }, select: { id: true, name: true } });
    if (clash) throw new PayerMasterError(`Payer ID ${data.payerId} is already used by "${clash.name}"`, 409, clash.id);
  }
  const fields = changedFields(existing as unknown as Record<string, unknown>, data);
  if (!fields.length) return { row: existing, fields };
  const row = await prisma.payerRegistry.update({ where: { id }, data: { ...data, updatedById: actorUserId } });
  return { row, fields };
}
