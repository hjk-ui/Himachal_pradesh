import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { assertClientPhiAccess, SensitiveRecordAccessError } from '@/lib/privacy/sensitiveAccess';
import { canAccessTreatmentPlans } from '@/lib/ehr/treatmentPlans';
import { loadPlanEditorContext, saveTemplatePlanDraft } from '@/lib/ehr/therapy/planStore';

export const runtime = 'nodejs';

const id = z.string().trim().min(1).max(128);

async function phiGate(gate: { organizationId: string; userId: string; role: Parameters<typeof canAccessTreatmentPlans>[0] }, clientId: string) {
  try {
    await assertClientPhiAccess({
      organizationId: gate.organizationId,
      userId: gate.userId,
      role: gate.role!,
      clientId,
      path: '/api/ehr/treatment-plans/template',
    });
    return null;
  } catch (err) {
    if (err instanceof SensitiveRecordAccessError) return NextResponse.json(err.body, { status: err.status });
    throw err;
  }
}

/**
 * GET /api/ehr/treatment-plans/template?clientId=&planId=&kind=Initial|Review&fromNoteId=&rewriteOf=
 * Treatment Plan template editor context: client, default review date, and the draft or
 * starting values (pre-filled from the signed intake, or from the active plan for a review).
 * rewriteOf = a plan imported from Valant: the new plan supersedes it and starts from the
 * intake and the chart's diagnoses, with the Valant plan's metadata and filed plan documents.
 */
export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessTreatmentPlans(gate.role)) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  const url = new URL(req.url);
  const parsed = z
    .object({
      clientId: id,
      planId: id.optional(),
      kind: z.enum(['Initial', 'Review']).optional(),
      fromNoteId: id.optional(),
      rewriteOf: id.optional(),
    })
    .safeParse({
      clientId: url.searchParams.get('clientId') ?? '',
      planId: url.searchParams.get('planId') || undefined,
      kind: url.searchParams.get('kind') || undefined,
      fromNoteId: url.searchParams.get('fromNoteId') || undefined,
      rewriteOf: url.searchParams.get('rewriteOf') || undefined,
    });
  if (!parsed.success) return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
  const blocked = await phiGate(gate, parsed.data.clientId);
  if (blocked) return blocked;
  try {
    const result = await loadPlanEditorContext({ organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role }, parsed.data);
    if (result.ok === false) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    await auditPhiAccess({
      gate,
      req,
      action: 'READ',
      resourceType: 'treatmentPlan',
      resourceId: result.context.plan.id,
      patientId: parsed.data.clientId,
      metadata: {
        purpose: 'treatment_plan_template',
        kind: parsed.data.kind ?? null,
        prefilledFromIntake: Boolean(result.context.intake),
        rewriteOfImportedPlan: result.context.rewrite?.importedPlanId ?? null,
      },
    });
    return NextResponse.json({ success: true, context: result.context }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    console.error('[treatment-plans/template GET]', err);
    return NextResponse.json({ success: false, error: 'Could not load the treatment plan' }, { status: 500 });
  }
}

const saveSchema = z.object({
  clientId: id,
  planId: id.optional().nullable(),
  supersedesId: id.optional().nullable(),
  sourceNoteId: id.optional().nullable(),
  values: z.record(z.string(), z.unknown()),
});

/** POST: create or update a template plan draft (signed plans are never changed here). */
export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessTreatmentPlans(gate.role)) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  const raw = await req.text();
  if (raw.length > 200_000) return NextResponse.json({ success: false, error: 'Plan is too large' }, { status: 413 });
  let body: z.infer<typeof saveSchema>;
  try {
    body = saveSchema.parse(JSON.parse(raw));
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid treatment plan' }, { status: 400 });
  }
  const blocked = await phiGate(gate, body.clientId);
  if (blocked) return blocked;
  try {
    const result = await saveTemplatePlanDraft({ organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role }, body);
    await auditPhiAccess({
      gate,
      req,
      action: body.planId ? 'UPDATE' : 'CREATE',
      resourceType: 'treatmentPlan',
      resourceId: result.ok ? result.planId : body.planId ?? null,
      patientId: body.clientId,
      outcome: result.ok ? 'SUCCESS' : 'FAILURE',
      metadata: { template: 'therapy-treatment-plan', review: Boolean(body.supersedesId), ...(result.ok === false ? { status: result.status } : {}) },
    });
    if (result.ok === false) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    return NextResponse.json({ success: true, planId: result.planId }, { status: body.planId ? 200 : 201 });
  } catch (err) {
    console.error('[treatment-plans/template POST]', err);
    return NextResponse.json({ success: false, error: 'Could not save the treatment plan' }, { status: 500 });
  }
}
