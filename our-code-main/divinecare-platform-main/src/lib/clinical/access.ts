import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { clientAccessWhere } from '@/lib/clients/orgScope';

export async function requireClinicalContext(path = '/dashboard/ehr/evaluations') {
  const gate = await requireOrgContext();
  if (gate.ok !== true) return { ok: false as const, status: gate.status ?? 401, error: gate.error ?? 'Unauthorized' };
  if (!canAccessPath(gate.role, path)) return { ok: false as const, error: 'Forbidden', status: 403 };
  return { ...gate, clientWhere: clientAccessWhere({ organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role }) };
}
