import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { gateClient, type Viewer } from '@/lib/medical/primaryCareWorkflowDb';

type Gate = Extract<Awaited<ReturnType<typeof requireOrgContext>>, { ok: true }>;

/**
 * Session + role gate for the primary care workflow APIs (rooming, care gaps, referrals, tasks,
 * in-basket, MA worklist). Every denial is audited.
 */
export async function workflowGate(
  req: Request,
  opts: { action: string; resourceType: string; allow: (role: string) => boolean }
): Promise<{ ok: true; gate: Gate; viewer: Viewer } | { ok: false; response: NextResponse }> {
  const gate = await requireOrgContext();
  if (!gate.ok) return { ok: false, response: NextResponse.json({ success: false, error: gate.error }, { status: gate.status }) };
  if (!opts.allow(String(gate.role))) {
    await auditPhiAccess({ gate, req, action: opts.action, resourceType: opts.resourceType, outcome: 'DENIED', metadata: { reason: 'role_not_permitted' } });
    return { ok: false, response: NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 }) };
  }
  return { ok: true, gate, viewer: { organizationId: gate.organizationId, userId: gate.userId, role: String(gate.role) } };
}

/** Chart access for one client (org, care team, Part 2 / protected record); denial audited. */
export async function workflowClientGate(
  req: Request,
  gate: Gate,
  viewer: Viewer,
  clientId: string,
  opts: { action: string; resourceType: string }
): Promise<{ ok: true; client: { id: string; name: string; dateOfBirth: Date | null } } | { ok: false; response: NextResponse }> {
  const g = await gateClient(viewer, clientId, new URL(req.url).pathname);
  if (g.ok === false) {
    await auditPhiAccess({ gate, req, action: opts.action, resourceType: opts.resourceType, patientId: clientId, outcome: 'DENIED', metadata: { reason: g.reason } });
    if (g.reason === 'sensitive_record') {
      return { ok: false, response: NextResponse.json({ success: false, error: 'SENSITIVE_RECORD', canRequestBreakGlass: true }, { status: 403 }) };
    }
    return { ok: false, response: NextResponse.json({ success: false, error: g.status === 404 ? 'Patient not found' : 'Forbidden' }, { status: g.status }) };
  }
  return { ok: true, client: g.client };
}

export function zodMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'issues' in err) {
    const issues = (err as { issues?: { message?: string; path?: (string | number)[] }[] }).issues;
    return issues?.[0]?.message || fallback;
  }
  return fallback;
}
