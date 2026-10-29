import { NextResponse } from 'next/server';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { tmsError, tmsGate } from '@/lib/tms/http';
import { loadWorkflowView, sendToBilling } from '@/lib/tms/workflowDb';

export const runtime = 'nodejs';

/** POST — step 3: send the insurance information to billing (a To-Do for billing roles). */
export async function POST(req: Request, ctx: { params: Promise<{ courseId: string }> }) {
  const g = await tmsGate('write');
  if (g.ok === false) return g.res;
  const { courseId } = await ctx.params;
  try {
    const { clientId } = await sendToBilling(g.actor, courseId);
    await auditPhiAccess({
      gate: g.gate,
      req,
      action: 'UPDATE',
      resourceType: 'tmsCaseWorkflow',
      resourceId: courseId,
      patientId: clientId,
      metadata: { fields: ['stage', 'insuranceSentAt'], stage: 'insurance_sent' },
    });
    return NextResponse.json({ success: true, workflow: await loadWorkflowView(g.actor, courseId) });
  } catch (err) {
    return tmsError(err, 'Could not send to billing');
  }
}
