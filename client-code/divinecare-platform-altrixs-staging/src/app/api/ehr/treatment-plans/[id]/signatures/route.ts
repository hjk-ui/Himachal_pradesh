import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { canAccessTreatmentPlans } from '@/lib/ehr/treatmentPlans';
import { applyPlanSignatureAction } from '@/lib/ehr/therapy/planStore';

export const runtime = 'nodejs';

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('sign'), attested: z.boolean() }),
  z.object({ action: z.literal('cosign'), comment: z.string().max(2000).optional().nullable() }),
  z.object({ action: z.literal('send') }),
  z.object({ action: z.literal('verbal'), obtainedBy: z.string().trim().min(2).max(200) }),
  z.object({
    action: z.literal('inOffice'),
    role: z.enum(['Patient', 'Guardian', 'Guarantor', 'Other signer']),
    typedName: z.string().trim().min(2).max(120),
    relationship: z.string().trim().max(60).optional().nullable(),
    attested: z.boolean(),
  }),
  z.object({ action: z.literal('providerSign'), attested: z.boolean() }),
  z.object({ action: z.literal('reopen') }),
]);

/**
 * POST /api/ehr/treatment-plans/[id]/signatures
 * sign (clinician; sends the plan to the patient portal) · cosign (supervisor, pre-licensed
 * authors only) · send (re-send to the portal) · verbal (telehealth verbal consent) · reopen
 * (back to draft, all signatures cleared) · inOffice (patient / guardian / guarantor / other
 * signer signs in office with typed name + relationship) · providerSign (another provider signs).
 * Each signer attests with the Valant template text (planDocument.ts).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessTreatmentPlans(gate.role)) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  const { id } = await ctx.params;
  if (!id || id.length > 128) return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid signature request' }, { status: 400 });
  }
  try {
    const action =
      body.action === 'sign'
        ? { type: 'sign' as const, attested: body.attested }
        : body.action === 'cosign'
          ? { type: 'cosign' as const, comment: body.comment ?? null }
          : body.action === 'verbal'
            ? { type: 'verbal' as const, obtainedBy: body.obtainedBy }
            : body.action === 'inOffice'
              ? { type: 'inOffice' as const, role: body.role, typedName: body.typedName, relationship: body.relationship ?? null, attested: body.attested }
              : body.action === 'providerSign'
                ? { type: 'providerSign' as const, attested: body.attested }
                : { type: body.action };
    const result = await applyPlanSignatureAction(
      { organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role },
      id,
      action
    );
    await auditPhiAccess({
      gate,
      req,
      action: body.action === 'reopen' ? 'UPDATE' : 'SIGN',
      resourceType: 'treatmentPlan',
      resourceId: id,
      patientId: result.ok ? result.clientId : null,
      outcome: result.ok === false ? (result.status === 403 ? 'DENIED' : 'FAILURE') : 'SUCCESS',
      metadata: { signatureAction: body.action, ...(body.action === 'inOffice' ? { signerRole: body.role } : {}), ...(result.ok === false ? { status: result.status } : { patientStatus: result.plan.patientSignatureStatus }) },
    });
    if (result.ok === false) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    return NextResponse.json({ success: true, plan: result.plan, portalAccount: result.portalAccount });
  } catch (err) {
    console.error('[treatment-plans signatures POST]', err);
    return NextResponse.json({ success: false, error: 'Could not update the plan signature' }, { status: 500 });
  }
}
