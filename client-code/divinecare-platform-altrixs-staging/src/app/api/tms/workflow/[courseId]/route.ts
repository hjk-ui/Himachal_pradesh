import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { tmsError, tmsGate } from '@/lib/tms/http';
import { changedFields, loadWorkflowView, patchWorkflow } from '@/lib/tms/workflowDb';
import { TMS_BASELINE_INSTRUMENTS, TMS_STAGE_VALUES, TMS_PACKET_ITEMS } from '@/lib/tms/workflow';

export const runtime = 'nodejs';

const str = (max: number) => z.string().trim().max(max).nullish();
const bool = z.boolean().optional();
const text = (max: number) => z.string().max(max).optional();
const evaluationSchema = z
  .object({
    dxConfirmed: bool,
    dxCode: z.string().trim().max(20).optional(),
    symptoms: text(2000),
    functionalImpact: text(2000),
    adtReviewed: bool,
    psychHistory: text(2000),
    currentTreatment: text(2000),
    currentMedications: text(2000),
    substanceUse: text(2000),
    seizureRisk: z.enum(['none', 'present']).optional(),
    seizureDetail: text(1000),
    neuroHistory: text(2000),
    implantsMetal: z.enum(['none', 'present']).optional(),
    implantsDetail: text(1000),
    deviceScreenDone: bool,
    pregnancy: z.enum(['not_applicable', 'not_pregnant', 'pregnant', 'unknown']).optional(),
    otherMedical: text(2000),
    suicideRisk: z.enum(['none', 'low', 'moderate', 'high']).optional(),
    escalationPlan: text(2000),
    protocolExplained: bool,
    consentObtained: bool,
    consentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    criteriaDx: z.enum(['mdd_single_severe', 'mdd_recurrent_severe', 'ocd', 'other']).optional(),
    adtAdequacyConfirmed: bool,
    psychotherapyTrial: z.enum(['yes', 'no']).optional(),
    psychotherapyDates: text(300),
    baselineInstrument: z.enum(['phq-9', 'ham-d', 'madrs', 'ybocs']).optional(),
    baselineScore: z.number().int().min(0).max(60).optional(),
    activePsychosis: z.enum(['none', 'present']).optional(),
    planSessions: z.number().int().min(1).max(200).optional(),
    planTaper: text(500),
    prescriberDetermination: bool,
    treatmentPlanDocumented: bool,
    monitoringPlan: bool,
  })
  .strict()
  .refine((e) => {
    if (e.baselineInstrument === undefined || e.baselineScore === undefined) return true;
    const max = TMS_BASELINE_INSTRUMENTS.find((b) => b.value === e.baselineInstrument)?.max ?? 0;
    return e.baselineScore <= max;
  }, 'Baseline score is outside the instrument range');

const packetSchema = z.object(Object.fromEntries(TMS_PACKET_ITEMS.map((i) => [i.key, z.boolean().optional()])) as Record<string, z.ZodOptional<z.ZodBoolean>>).strict();

const patchSchema = z.object({
  stage: z.enum(TMS_STAGE_VALUES as [string, ...string[]]).optional(),
  ownerId: z.string().max(128).nullish(),
  referralSource: z.enum(['external', 'none']).nullish(),
  referringProvider: str(200),
  packet: packetSchema.optional(),
  medMgmtAppointmentId: z.string().max(128).nullish(),
  indication: z.enum(['mdd', 'ocd']).nullish(),
  deviceName: str(120),
  deviceDetail: str(500),
  deviceClearedForIndication: z.boolean().nullish(),
  orderingProviderId: z.string().max(128).nullish(),
  payerVerified: z.boolean().nullish(),
  payerVerifyNote: str(500),
  evaluation: evaluationSchema.optional(),
});

/** GET /api/tms/workflow/[courseId] — the case: stage, packet, billing, payer rule check, evaluation, start blockers. */
export async function GET(req: Request, ctx: { params: Promise<{ courseId: string }> }) {
  const g = await tmsGate('read');
  if (g.ok === false) return g.res;
  const { courseId } = await ctx.params;
  try {
    const view = await loadWorkflowView(g.actor, courseId);
    await auditPhiAccess({ gate: g.gate, req, action: 'READ', resourceType: 'tmsCaseWorkflow', resourceId: courseId, patientId: view.clientId });
    return NextResponse.json({ success: true, workflow: view });
  } catch (err) {
    return tmsError(err, 'Could not load the TMS workflow');
  }
}

/** PATCH /api/tms/workflow/[courseId] — update the case (TMS write roles). Audit: field names only. */
export async function PATCH(req: Request, ctx: { params: Promise<{ courseId: string }> }) {
  const g = await tmsGate('write');
  if (g.ok === false) return g.res;
  const { courseId } = await ctx.params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid request' }, { status: 400 });
  try {
    const { clientId } = await patchWorkflow(g.actor, courseId, parsed.data as Parameters<typeof patchWorkflow>[2]);
    await auditPhiAccess({
      gate: g.gate,
      req,
      action: 'UPDATE',
      resourceType: 'tmsCaseWorkflow',
      resourceId: courseId,
      patientId: clientId,
      metadata: {
        fields: changedFields(parsed.data),
        evaluationFields: parsed.data.evaluation ? Object.keys(parsed.data.evaluation) : undefined,
        stage: parsed.data.stage,
      },
    });
    return NextResponse.json({ success: true, workflow: await loadWorkflowView(g.actor, courseId) });
  } catch (err) {
    return tmsError(err, 'Could not save the TMS workflow');
  }
}
