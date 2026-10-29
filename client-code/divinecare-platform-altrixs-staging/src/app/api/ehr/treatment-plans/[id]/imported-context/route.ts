import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { canAccessTreatmentPlans } from '@/lib/ehr/treatmentPlans';
import { loadImportedPlanContext } from '@/lib/ehr/therapy/planStore';

export const runtime = 'nodejs';

const paramsSchema = z.object({ id: z.string().min(1).max(128) });

/**
 * GET /api/ehr/treatment-plans/[id]/imported-context
 * For a plan imported from Valant: the client's diagnoses from the chart (labeled as chart data,
 * Valant's plan grid has none), treatment plan documents filed through Smart Doc Intake (the
 * Valant plan PDF with the real goals), and any Altrixs rewrite already started.
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
    const result = await loadImportedPlanContext({ organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role }, parsed.data.id);
    if (result.ok === false) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    await auditPhiAccess({
      gate,
      req,
      action: 'READ',
      resourceType: 'treatmentPlan',
      resourceId: parsed.data.id,
      patientId: result.clientId,
      metadata: {
        purpose: 'imported_plan_context',
        chartDiagnoses: result.context.chartDiagnoses.length,
        planDocuments: result.context.documents.length,
      },
    });
    return NextResponse.json({ success: true, context: result.context }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    console.error('[treatment-plans/imported-context GET]', err);
    return NextResponse.json({ success: false, error: 'Could not load the imported plan' }, { status: 500 });
  }
}
