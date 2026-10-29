import { prisma } from '@/lib/db/prisma';
import { touchUsed } from '@/lib/resources/store';
import { canSeePatientItem, canSeeStaffItem } from '@/lib/resources/access';
import { auditPhiAccessResource, errorResponse, fail, ok, resourceGate } from '../../../_shared';

export const runtime = 'nodejs';

/** POST: staff opened the link / previewed the item ("recently used"). Audited as a view (no PHI). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await resourceGate();
  if (g.ok === false) return g.res;
  try {
    const row = await prisma.resourceItem.findFirst({
      where: { id, organizationId: g.actor.organizationId },
      select: { id: true, audience: true, status: true, visibleRoles: true },
    });
    const allowed = row && (row.audience === 'staff' ? canSeeStaffItem(g.gate.role, row.visibleRoles) : canSeePatientItem(g.gate.role, row.status));
    if (!row || !allowed) return fail('Resource not found', 404);
    await touchUsed(g.actor, row.id);
    await auditPhiAccessResource(g.gate, req, { action: 'RESOURCE_ITEM_OPEN', resourceType: 'resourceItem', resourceId: row.id, metadata: { audience: row.audience } });
    return ok({});
  } catch (e) {
    return errorResponse(e, 'Could not record the view');
  }
}
