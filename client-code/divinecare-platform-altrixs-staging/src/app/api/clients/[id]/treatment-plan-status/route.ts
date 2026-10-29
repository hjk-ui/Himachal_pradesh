import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { assertClientPhiAccess, SensitiveRecordAccessError } from '@/lib/privacy/sensitiveAccess';
import { loadClientPlanStatus } from '@/lib/ehr/therapy/planStore';

export const runtime = 'nodejs';

/**
 * GET /api/clients/[id]/treatment-plan-status?noteType=&cptCode=
 * The client's treatment plans with signature status, the active plan's goals (for the
 * Therapy Progress note) and whether a note of this type / code could be signed now.
 * Org + caseload scoped. Supervisors and admins see the same block reason the clinician sees.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessPath(gate.role, '/dashboard/ehr/notes') && !canAccessPath(gate.role, '/dashboard/ehr/treatment-plans')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const { id } = await ctx.params;
  if (!id || id.length > 128) return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
  const url = new URL(req.url);
  const noteType = url.searchParams.get('noteType')?.trim().slice(0, 60) || null;
  const cptCode = url.searchParams.get('cptCode')?.trim().slice(0, 20) || null;

  try {
    await assertClientPhiAccess({
      organizationId: gate.organizationId,
      userId: gate.userId,
      role: gate.role,
      clientId: id,
      path: `/api/clients/${id}/treatment-plan-status`,
    });
  } catch (err) {
    if (err instanceof SensitiveRecordAccessError) return NextResponse.json(err.body, { status: err.status });
    throw err;
  }

  try {
    const result = await loadClientPlanStatus(
      { organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role },
      id,
      { noteType, cptCode }
    );
    if (result.ok === false) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    await auditPhiAccess({
      gate,
      req,
      action: 'READ',
      resourceType: 'treatmentPlan',
      patientId: id,
      metadata: { purpose: 'treatment_plan_status', planCount: result.plans.length, gateOk: result.gate.ok },
    });
    return NextResponse.json(
      { success: true, settings: result.settings, gate: result.gate, active: result.active, plans: result.plans },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (err) {
    console.error('[treatment-plan-status GET]', err);
    return NextResponse.json({ success: false, error: 'Could not load treatment plans' }, { status: 500 });
  }
}
