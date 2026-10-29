import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { clientPhiBlock } from '@/lib/privacy/lockedRows';

/**
 * Clinical module gate: page role rule + caseload scope (clientWhere). With opts.clientId (a
 * one-client read) the 42 CFR Part 2 / VIP lock is also enforced (assertClientPhiAccess): a locked
 * client returns 403 SENSITIVE_RECORD with the break-glass path. List feeds drop locked clients
 * with withoutLockedClients (src/lib/privacy/lockedRows.ts).
 */
export async function requireClinicalContext(path = '/dashboard/ehr/evaluations', opts: { clientId?: string | null } = {}) {
  const gate = await requireOrgContext();
  if (gate.ok !== true) return { ok: false as const, status: gate.status ?? 401, error: gate.error ?? 'Unauthorized' };
  if (!canAccessPath(gate.role, path, gate.capabilities)) return { ok: false as const, error: 'Forbidden', status: 403 };
  if (opts.clientId) {
    const blocked = await clientPhiBlock(gate, opts.clientId, path);
    if (blocked) return { ok: false as const, status: blocked.status, error: blocked.body.error, canRequestBreakGlass: true as const };
  }
  return { ...gate, clientWhere: clientAccessWhere({ organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role }) };
}
