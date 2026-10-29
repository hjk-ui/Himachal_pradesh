import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { enrollmentPatchSchema, errorResponse, ok, prpGate } from '@/lib/prp/http';
import { PRP_STATUS_ROLES, updateEnrollmentStatus } from '@/lib/prp/program';

export const runtime = 'nodejs';

/** PATCH /api/prp/enrollments/[id]: status (active | on_hold | transitioning | discharged), discharge type / reason / aftercare plan, transition plan, specialist. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await prpGate(PRP_STATUS_ROLES);
  if (!g.ok) return g.res;
  try {
    const { id } = await params;
    const body = enrollmentPatchSchema.parse(await req.json());
    const e = await updateEnrollmentStatus(g.actor, id, body);
    await auditPhiAccess({
      gate: g.gate,
      req,
      action: 'WRITE',
      resourceType: 'prpEnrollment',
      resourceId: e.id,
      patientId: e.clientId,
      metadata: { status: e.status, fields: Object.keys(body) },
    });
    return ok({
      enrollment: {
        id: e.id,
        status: e.status,
        statusChangedAt: e.statusChangedAt?.toISOString() ?? null,
        dischargedAt: e.dischargedAt?.toISOString() ?? null,
        dischargeReason: e.dischargeReason,
        dischargeType: e.dischargeType,
        transitionPlan: e.transitionPlan,
        aftercarePlan: e.aftercarePlan,
        specialistId: e.specialistId,
      },
    });
  } catch (e) {
    return errorResponse(e, 'Could not update the enrollment');
  }
}
