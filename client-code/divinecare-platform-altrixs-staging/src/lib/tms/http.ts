/**
 * Route gates for the TMS workflow APIs. Clinical workflow: the TMS page roles (read / write as
 * src/lib/ehr/tmsSpravato.ts). Billing hand-off: the Authorizations page roles, which see only the
 * hand-off fields (client, payer, stage, packet completeness).
 */
import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { prisma } from '@/lib/db/prisma';
import { canReadTmsSpravato, canWriteTmsSpravato, TMS_SPRAVATO_PATH } from '@/lib/ehr/tmsSpravato';
import { TmsWorkflowError, type TmsActor } from '@/lib/tms/workflowDb';

export const TMS_BILLING_PATH = '/dashboard/billing/authorizations';

type Gate = Extract<Awaited<ReturnType<typeof requireOrgContext>>, { ok: true }>;
export type TmsGate = { ok: true; gate: Gate; actor: TmsActor } | { ok: false; res: NextResponse };

export async function tmsGate(mode: 'read' | 'write' | 'billing' | 'rules'): Promise<TmsGate> {
  const gate = await requireOrgContext();
  if (!gate.ok) return { ok: false, res: NextResponse.json({ success: false, error: gate.error }, { status: gate.status }) };
  const tmsPage = canAccessPath(gate.role, TMS_SPRAVATO_PATH);
  const billing = canAccessPath(gate.role, TMS_BILLING_PATH);
  const allowed =
    mode === 'read'
      ? tmsPage && canReadTmsSpravato(gate.role)
      : mode === 'write'
        ? tmsPage && canWriteTmsSpravato(gate.role)
        : mode === 'billing'
          ? billing
          : (tmsPage && canWriteTmsSpravato(gate.role)) || billing;
  if (!allowed) return { ok: false, res: NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 }) };
  const user = await prisma.user.findUnique({ where: { id: gate.userId }, select: { name: true, email: true, roles: true } }).catch(() => null);
  // All of the user's roles (User.role + User.roles): TMS prescriber checks use every role
  return { ok: true, gate, actor: { organizationId: gate.organizationId, userId: gate.userId, role: gate.role, roles: user?.roles ?? [], name: user?.name?.trim() || user?.email || null } };
}

export function tmsError(err: unknown, fallback: string) {
  if (err instanceof TmsWorkflowError) return NextResponse.json({ success: false, error: err.message }, { status: err.status });
  console.error('[tms/workflow]', err instanceof Error ? err.name : 'unknown');
  return NextResponse.json({ success: false, error: `${fallback} (has the 20261027_tms_workflow migration run?)` }, { status: 500 });
}
