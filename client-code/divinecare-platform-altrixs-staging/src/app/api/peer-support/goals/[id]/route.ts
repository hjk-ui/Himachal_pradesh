import { updateGoal } from '@/lib/peerSupport/manage';
import { errorResponse, ok, peerGate, updateGoalSchema } from '@/lib/peerSupport/http';
import { auditPhiAccess } from '@/lib/audit/requestMeta';

export const runtime = 'nodejs';

/** PATCH /api/peer-support/goals/[id] — status, target date, progress note; the author or leadership rewords. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await peerGate(req, 'PeerGoal', 'UPDATE');
  if (!g.ok) return g.res;
  try {
    const body = updateGoalSchema.parse(await req.json());
    const result = await updateGoal(g.actor, id, body);
    await auditPhiAccess({
      gate: g.gate,
      req,
      action: 'UPDATE',
      resourceType: 'PeerGoal',
      resourceId: id,
      patientId: result.clientId,
      metadata: { fields: Object.keys(body), status: result.goal.status },
    });
    return ok({ goal: result.goal });
  } catch (error) {
    return errorResponse(error, 'Goal could not be updated', { gate: g.gate, req, action: 'UPDATE', resourceType: 'PeerGoal', resourceId: id });
  }
}
