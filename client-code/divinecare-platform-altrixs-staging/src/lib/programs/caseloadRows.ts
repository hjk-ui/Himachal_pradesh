import type { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere } from '@/lib/clients/orgScope';

/**
 * Program boards (Mobile Crisis, Residential, AOT) list every row in the org for the roles that
 * run them: leadership, Office Manager, licensed clinicians / prescribers, crisis responders.
 * Support roles without a licensed treatment function (Peer Support, Case Manager, PRP
 * Specialist) see only rows linked to a client on their own caseload / care team; rows not
 * linked to any client are hidden from them (minimum necessary).
 */
export const PROGRAM_CASELOAD_ROLES = new Set(['PEER_SUPPORT', 'CASE_MANAGER', 'PRP_SPECIALIST']);

export function programRowsNeedCaseload(role: string | null | undefined): boolean {
  return PROGRAM_CASELOAD_ROLES.has(String(role ?? '').toUpperCase());
}

/** null = no row filter for this role; otherwise the client ids the actor may see. */
export async function programCaseloadClientIds(actor: {
  organizationId: string;
  userId: string;
  role: string;
}): Promise<Set<string> | null> {
  if (!programRowsNeedCaseload(actor.role)) return null;
  const rows = await prisma.client.findMany({
    where: clientAccessWhere({ organizationId: actor.organizationId, actorUserId: actor.userId, actorRole: actor.role as Role }),
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}

/** Keep rows whose clientId is in the caseload set (no set = keep all). */
export function filterRowsToCaseload<T extends { clientId?: string | null }>(rows: T[], allowed: Set<string> | null): T[] {
  if (!allowed) return rows;
  return rows.filter((r) => Boolean(r.clientId) && allowed.has(r.clientId as string));
}
