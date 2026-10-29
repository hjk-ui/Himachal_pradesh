import { updatePlacement } from '@/lib/peerSupport/manage';
import { errorResponse, ok, peerGate, updatePlacementSchema } from '@/lib/peerSupport/http';
import { auditPhiAccess } from '@/lib/audit/requestMeta';

export const runtime = 'nodejs';

/** PATCH /api/peer-support/placements/[id] — status, dates, hours; the author or leadership edits notes. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await peerGate(req, 'PeerPlacement', 'UPDATE');
  if (!g.ok) return g.res;
  try {
    const body = updatePlacementSchema.parse(await req.json());
    const result = await updatePlacement(g.actor, id, body);
    await auditPhiAccess({
      gate: g.gate,
      req,
      action: 'UPDATE',
      resourceType: 'PeerPlacement',
      resourceId: id,
      patientId: result.clientId,
      metadata: { fields: Object.keys(body), status: result.placement.status },
    });
    return ok({ placement: result.placement });
  } catch (error) {
    return errorResponse(error, 'Placement could not be updated', { gate: g.gate, req, action: 'UPDATE', resourceType: 'PeerPlacement', resourceId: id });
  }
}
