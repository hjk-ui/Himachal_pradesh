import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { recordPhiAudit } from '@/lib/audit/phiAudit';

export type HomebaseAuditAction =
  | 'HR_HOMEBASE_STATUS'
  | 'HR_HOMEBASE_SYNC'
  | 'HR_HOMEBASE_LOCATIONS'
  | 'HR_HOMEBASE_ROSTER'
  | 'HR_HOMEBASE_ROSTER_MATCH'
  | 'HR_HOMEBASE_HOURS'
  | 'HR_HOMEBASE_PAYROLL';

type Gate =
  | { ok: true; organizationId: string; userId: string; role: string; audit: (action: HomebaseAuditAction) => Promise<void> }
  | { ok: false; response: NextResponse };

/** HR admin only (HR, Admin, Director, Practice Director). Every successful call is audited. */
export async function requireHomebaseAccess(): Promise<Gate> {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return { ok: false, response: NextResponse.json({ success: false, error: gate.error }, { status: gate.status }) };
  }
  if (!canAccessPath(gate.role, '/dashboard/hr/homebase')) {
    return { ok: false, response: NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 }) };
  }
  return {
    ok: true,
    organizationId: gate.organizationId,
    userId: gate.userId,
    role: gate.role,
    audit: (action) =>
      recordPhiAudit({
        organizationId: gate.organizationId,
        actorUserId: gate.userId,
        actorRole: gate.role,
        action,
        resourceType: 'homebase',
        outcome: 'SUCCESS',
      }),
  };
}
