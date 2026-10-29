import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessClientRoster, canEditClientProfile } from '@/lib/clients/orgScope';
import { findAccessibleClientId, type DiagnosisActorWithRole } from './list';

type Gate =
  | { ok: true; actor: DiagnosisActorWithRole }
  | { ok: false; response: NextResponse };

function deny(status: number, error: string): Gate {
  return { ok: false, response: NextResponse.json({ success: false, error }, { status }) };
}

/** Session + tenant + role + client-visibility check shared by every diagnosis route. */
export async function requireDiagnosisAccess(clientId: string, mode: 'read' | 'write'): Promise<Gate> {
  const gate = await requireOrgContext();
  if (!gate.ok) return deny(gate.status, gate.error);
  const allowed = mode === 'write' ? canEditClientProfile(gate.role) : canAccessClientRoster(gate.role);
  if (!allowed) return deny(403, 'Forbidden');
  const actor: DiagnosisActorWithRole = {
    organizationId: gate.organizationId,
    userId: gate.userId,
    userName: gate.session.user.name ?? null,
    role: gate.role,
  };
  if (!(await findAccessibleClientId(actor, clientId))) return deny(404, 'Client not found');
  return { ok: true, actor };
}
