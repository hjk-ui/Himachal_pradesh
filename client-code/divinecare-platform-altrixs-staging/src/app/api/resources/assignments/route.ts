import { assignResource, listClientAssignments, listScopedAssignments, ResourceError } from '@/lib/resources/store';
import { assignSchema, auditPhiAccessResource, errorResponse, ok, resourceGate } from '../_shared';

export const runtime = 'nodejs';

/**
 * GET ?clientId=  one client's assignments (chart card)
 * GET ?mine=1     assignments the viewer sent; otherwise every assignment in their caseload scope
 */
export async function GET(req: Request) {
  const g = await resourceGate();
  if (g.ok === false) return g.res;
  const sp = new URL(req.url).searchParams;
  const clientId = sp.get('clientId');
  try {
    if (clientId) {
      const r = await listClientAssignments(g.actor, clientId);
      await auditPhiAccessResource(g.gate, req, { action: 'RESOURCE_ASSIGNMENT_LIST', resourceType: 'resourceAssignment', patientIds: r.patientIds, metadata: { count: r.assignments.length, view: 'chart' } });
      return ok({ assignments: r.assignments, canAssign: r.canAssign });
    }
    const r = await listScopedAssignments(g.actor, { mine: sp.get('mine') === '1' });
    await auditPhiAccessResource(g.gate, req, { action: 'RESOURCE_ASSIGNMENT_LIST', resourceType: 'resourceAssignment', metadata: { count: r.assignments.length, clients: r.patientIds.length, view: 'library' } });
    return ok({ assignments: r.assignments, hiddenProtected: r.hiddenProtected });
  } catch (e) {
    if (e instanceof ResourceError && clientId) {
      await auditPhiAccessResource(g.gate, req, { action: 'RESOURCE_ASSIGNMENT_LIST', resourceType: 'resourceAssignment', patientIds: [clientId], outcome: e.status === 403 ? 'DENIED' : 'FAILURE' });
    }
    return errorResponse(e, 'Could not load assignments');
  }
}

/** POST: send a resource to a client's portal (portal notification only; generic wording). */
export async function POST(req: Request) {
  const g = await resourceGate();
  if (g.ok === false) return g.res;
  let clientId: string | null = null;
  try {
    const input = assignSchema.parse(await req.json());
    clientId = input.clientId;
    const r = await assignResource(g.actor, input);
    await auditPhiAccessResource(g.gate, req, {
      action: 'RESOURCE_ASSIGN',
      resourceType: 'resourceAssignment',
      resourceId: r.assignment.id,
      patientIds: r.patientIds,
      metadata: { itemId: input.itemId, context: input.context ?? 'library', part2: r.part2, notification: r.assignment.notificationStatus },
    });
    return ok({ assignment: r.assignment }, 201);
  } catch (e) {
    if (e instanceof ResourceError && clientId) {
      await auditPhiAccessResource(g.gate, req, { action: 'RESOURCE_ASSIGN', resourceType: 'resourceAssignment', patientIds: [clientId], outcome: e.status === 403 ? 'DENIED' : 'FAILURE' });
    }
    return errorResponse(e, 'Could not send the resource');
  }
}
