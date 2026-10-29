import { prisma } from '@/lib/db/prisma';
import { clientOrgFilter } from '@/lib/clients/orgScope';

/**
 * ResidentialResident has no organizationId column, so tenant scope goes through the linked
 * client chart. A resident linked to another org's client is treated as not found, and so is an
 * UNLINKED resident (no clientId): its tenant cannot be verified, so it is hidden from every org
 * (fail closed) on every residential route (census, bed board, shift notes, ?residentId=).
 * TODO(schema): add ResidentialResident.organizationId (future migration, backfilled from the
 * linked client) so unlinked admissions can be scoped instead of hidden.
 */
export async function findResidentInOrg(id: string, organizationId: string) {
  const resident = await prisma.residentialResident.findUnique({ where: { id } });
  if (!resident) return null;
  if (!resident.clientId) return null;
  const client = await prisma.client.findFirst({
    where: { id: resident.clientId, AND: [clientOrgFilter(organizationId)] },
    select: { id: true },
  });
  return client ? resident : null;
}

/**
 * Pure: keep residents (or rows carrying a resident clientId) whose linked client is in the org.
 * Unlinked rows are dropped (no organizationId column yet; see findResidentInOrg).
 */
export function residentRowsInOrg<T>(rows: T[], inOrgClientIds: Set<string>, clientIdOf: (row: T) => string | null | undefined): T[] {
  return rows.filter((r) => {
    const id = clientIdOf(r);
    return Boolean(id) && inOrgClientIds.has(id as string);
  });
}

/** Client ids (from the given ones) that belong to the org. */
export async function orgClientIdSet(clientIds: (string | null | undefined)[], organizationId: string): Promise<Set<string>> {
  const ids = Array.from(new Set(clientIds.filter((v): v is string => Boolean(v))));
  if (!ids.length) return new Set();
  const rows = await prisma.client.findMany({
    where: { id: { in: ids }, AND: [clientOrgFilter(organizationId)] },
    select: { id: true },
  });
  return new Set(rows.map((c) => c.id));
}
