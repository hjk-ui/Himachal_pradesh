import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { assertClientPhiAccess, SensitiveRecordAccessError } from '@/lib/privacy/sensitiveAccess';
import { canAccessTreatmentPlans } from '@/lib/ehr/treatmentPlans';
import { loadPlanDocument } from '@/lib/ehr/therapy/planStore';

export const runtime = 'nodejs';

const paramsSchema = z.object({ id: z.string().min(1).max(128) });

/**
 * GET /api/ehr/treatment-plans/[id]/document
 * The plan document for the print / PDF view, laid out like the practice's Valant template:
 * header (logo, patient name in Valant's format, Patient ID, provider, DOB, age, address, main
 * phone, Documentation ID, insurance 1–3, diagnosis), plan fields, Problem → Goal → Objective →
 * Intervention, and signature blocks with the Valant attestation texts. A signed plan returns the
 * document frozen at signing; a draft is built from its current values.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessTreatmentPlans(gate.role) || !canAccessPath(gate.role, '/dashboard/ehr/treatment-plans')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const parsed = paramsSchema.safeParse(await ctx.params);
  if (!parsed.success) return NextResponse.json({ success: false, error: 'Invalid id' }, { status: 400 });
  try {
    const result = await loadPlanDocument({ organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role }, parsed.data.id);
    if (result.ok === false) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    try {
      await assertClientPhiAccess({
        organizationId: gate.organizationId,
        userId: gate.userId,
        role: gate.role!,
        clientId: result.view.clientId,
        path: '/api/ehr/treatment-plans/document',
      });
    } catch (err) {
      if (err instanceof SensitiveRecordAccessError) return NextResponse.json(err.body, { status: err.status });
      throw err;
    }
    await auditPhiAccess({
      gate,
      req,
      action: 'READ',
      resourceType: 'treatmentPlan',
      resourceId: parsed.data.id,
      patientId: result.view.clientId,
      metadata: { purpose: 'treatment_plan_document', frozen: result.view.frozen, part2: Boolean(result.view.document?.part2) },
    });
    return NextResponse.json({ success: true, view: result.view }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    console.error('[treatment-plans/document GET]', err);
    return NextResponse.json({ success: false, error: 'Could not load the plan document' }, { status: 500 });
  }
}
