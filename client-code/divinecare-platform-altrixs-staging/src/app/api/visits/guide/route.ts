import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { loadVisitGuide } from '@/lib/visits/loader';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RESOURCE = 'visitGuide';

/**
 * GET /api/visits/guide?clientId=&appointmentId=&kind=
 * The Visit Guide for one visit: protocol steps with chart-verified status, due items, briefing,
 * requirements and a follow-up suggestion. Decision support only; the clinician verifies.
 * Gate: role (canViewVisitGuide) + chart access (org, caseload / care team, Part 2) in the loader.
 * Audit: READ with counts only (never chart text).
 */
export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  const url = new URL(req.url);
  const clientId = url.searchParams.get('clientId')?.trim() || '';
  const appointmentId = url.searchParams.get('appointmentId')?.trim() || null;
  const kind = url.searchParams.get('kind')?.trim() || null;
  if (!clientId) return NextResponse.json({ success: false, error: 'clientId is required' }, { status: 400 });

  try {
    const result = await loadVisitGuide({
      organizationId: gate.organizationId,
      userId: gate.userId,
      role: String(gate.role),
      clientId,
      appointmentId,
      kind,
      req,
    });
    if (result.ok === false) {
      await auditPhiAccess({
        req,
        gate,
        action: 'READ',
        resourceType: RESOURCE,
        resourceId: appointmentId ?? clientId,
        patientId: clientId,
        outcome: result.status === 400 ? 'FAILURE' : 'DENIED',
        metadata: { reason: result.reason },
      }).catch(() => {});
      return NextResponse.json({ success: false, error: result.error, reason: result.reason }, { status: result.status });
    }
    const g = result.guide;
    await auditPhiAccess({
      req,
      gate,
      action: 'READ',
      resourceType: RESOURCE,
      resourceId: appointmentId ?? clientId,
      patientId: clientId,
      outcome: 'SUCCESS',
      metadata: {
        kind: g.kind,
        appointment: appointmentId ? 1 : 0,
        steps: g.steps.length,
        required: g.summary.required,
        requiredDone: g.summary.requiredDone,
        due: g.due.length,
        requirements: g.requirements.length,
      },
    }).catch(() => {});
    return NextResponse.json({ success: true, data: g }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    // ids and error class only — never chart content
    console.error('[visits/guide] failed for client', clientId, err instanceof Error ? err.name : 'unknown');
    return NextResponse.json({ success: false, error: 'Could not build the visit guide. Review the chart directly.' }, { status: 500 });
  }
}
