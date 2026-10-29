import { z } from 'zod';
import { withdrawAssignment } from '@/lib/resources/store';
import { auditPhiAccessResource, errorResponse, ok, resourceGate } from '../../_shared';

export const runtime = 'nodejs';

/** PATCH { action: 'withdraw' }: remove a resource from the client's portal (kept in the record). */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await resourceGate();
  if (g.ok === false) return g.res;
  try {
    z.object({ action: z.literal('withdraw') }).parse(await req.json());
    const r = await withdrawAssignment(g.actor, id);
    await auditPhiAccessResource(g.gate, req, { action: 'RESOURCE_ASSIGNMENT_WITHDRAW', resourceType: 'resourceAssignment', resourceId: id, patientIds: r.patientIds, metadata: { part2: r.part2 } });
    return ok({ assignment: r.assignment });
  } catch (e) {
    return errorResponse(e, 'Could not withdraw the resource');
  }
}
