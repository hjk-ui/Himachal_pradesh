import type { Role } from '@prisma/client';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { canReadLedger } from '@/lib/billing/ledger';
import { canAdministerCharges, canManageAutopayEnrollment } from '@/lib/patientPayments/access';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere, clientByIdWhere } from '@/lib/clients/orgScope';

/**
 * Staff gate for the AutoPay APIs: org context + AutoPay page access, then
 *   read     ledger readers;
 *   desk     card capture in the office and AutoPay on/off (front desk, office manager, billing, leadership);
 *   charges  retry / approve / void / refund (billing, leadership).
 */
export async function autopayGate(mode: 'read' | 'desk' | 'charges') {
  const gate = await requireOrgContext();
  if (!gate.ok) return { ok: false as const, status: gate.status, error: gate.error };
  const roleOk = mode === 'charges' ? canAdministerCharges(gate.role) : mode === 'desk' ? canManageAutopayEnrollment(gate.role) : canReadLedger(gate.role);
  const allowed = roleOk && canAccessPath(gate.role, '/dashboard/billing/autopay');
  if (!allowed) return { ok: false as const, status: 403, error: 'Forbidden' };
  return { ok: true as const, gate, actor: { userId: gate.userId, role: String(gate.role) } };
}

export function scopeWhere(gate: { organizationId: string; userId: string; role: Role | string }) {
  return clientAccessWhere({ organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role as Role });
}

/** The client, when it is in this staff member's scope. */
export async function scopedClientId(gate: { organizationId: string; userId: string; role: Role | string }, clientId: string) {
  const c = await prisma.client.findFirst({ where: { AND: [clientByIdWhere(clientId, gate.organizationId), scopeWhere(gate)] }, select: { id: true } });
  return c?.id ?? null;
}
