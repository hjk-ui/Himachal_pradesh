/**
 * Access gate for the diagnosis-list API (src/app/api/clients/[id]/diagnoses/**):
 *  - org + caseload / care team + Part 2 (42 CFR Part 2) sensitive-record rule: resolveChartAccess,
 *    the same gate as the chart. A protected chart the viewer cannot open answers 403
 *    SENSITIVE_RECORD (break-the-glass), never the diagnoses.
 *  - Read: roles that see behavioral-health diagnoses on the chart (canSeeBhDiagnoses). Not HR,
 *    not Front Desk, not primary care roles (problem list only). Billing sees the codes on claims.
 *  - Write: licensed BH clinicians and leadership (canEditClientDiagnoses), the same rule as the
 *    client profile's diagnosis fields.
 * Denials are audited here; routes audit the successful read / write.
 */
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { resolveChartAccess } from '@/lib/clients/chartAccess';
import { canSeeBhDiagnoses } from '@/lib/clients/chartSectionAccess';
import { canEditClientDiagnoses } from '@/lib/clients/orgScope';
import type { DxActor } from './store';

type Gate = Extract<Awaited<ReturnType<typeof requireOrgContext>>, { ok: true }>;

export type DiagnosisRouteContext = {
  gate: Gate;
  actor: DxActor;
  clientId: string;
  canEdit: boolean;
  /** Client sex for code sex edits (warning only) */
  sex: string | null;
};

export async function gateDiagnosisRoute(
  req: Request,
  clientId: string,
  opts: { write: boolean; resourceType?: string }
): Promise<{ ok: true; ctx: DiagnosisRouteContext; response?: undefined } | { ok: false; response: NextResponse; ctx?: undefined }> {
  const resourceType = opts.resourceType ?? 'clientDiagnoses';
  const gate = await requireOrgContext();
  if (!gate.ok) return { ok: false, response: NextResponse.json({ success: false, error: gate.error }, { status: gate.status }) };
  const deny = async (status: number, error: string, reason: string, body?: Record<string, unknown>) => {
    await auditPhiAccess({ gate, req, action: opts.write ? 'UPDATE' : 'READ', resourceType, resourceId: clientId, patientId: clientId, outcome: 'DENIED', metadata: { reason } });
    return { ok: false as const, response: NextResponse.json(body ?? { success: false, error }, { status }) };
  };
  if (!canSeeBhDiagnoses(gate.role)) return deny(403, 'Your role cannot view behavioral health diagnoses', 'role_not_permitted');
  if (opts.write && !canEditClientDiagnoses(gate.role)) return deny(403, 'Only licensed clinicians and leadership can change diagnoses', 'role_cannot_edit');
  const access = await resolveChartAccess({ organizationId: gate.organizationId, userId: gate.userId, role: gate.role }, clientId, `/api/clients/${clientId}/diagnoses`);
  if (access.ok === false) {
    if (access.reason === 'sensitive_record') return deny(403, 'SENSITIVE_RECORD', 'sensitive_record', { error: 'SENSITIVE_RECORD', canRequestBreakGlass: true });
    return deny(access.status, access.status === 404 ? 'Client not found' : 'Forbidden', String(access.reason));
  }
  const [user, client] = await Promise.all([
    prisma.user.findUnique({ where: { id: gate.userId }, select: { name: true, credentials: true } }).catch(() => null),
    prisma.client.findFirst({ where: { id: access.client.id }, select: { administrativeSex: true, gender: true } }).catch(() => null),
  ]);
  const name = [user?.name?.trim(), user?.credentials?.trim()].filter(Boolean).join(', ') || null;
  return {
    ok: true,
    ctx: {
      gate,
      actor: { organizationId: gate.organizationId, userId: gate.userId, name },
      clientId: access.client.id,
      canEdit: canEditClientDiagnoses(gate.role),
      sex: client?.administrativeSex || client?.gender || null,
    },
  };
}
