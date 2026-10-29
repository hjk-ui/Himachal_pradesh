import { updateItem } from '@/lib/resources/store';
import { auditPhiAccessResource, errorResponse, itemUpdateSchema, ok, resourceGate } from '../../_shared';

export const runtime = 'nodejs';

/** PATCH: edit metadata, record a clinical review / link check, or change status (draft / active / retired). */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await resourceGate();
  if (g.ok === false) return g.res;
  try {
    const input = itemUpdateSchema.parse(await req.json());
    const item = await updateItem(g.actor, id, input);
    await auditPhiAccessResource(g.gate, req, {
      action: input.markReviewed ? 'RESOURCE_ITEM_REVIEW' : input.status ? 'RESOURCE_ITEM_STATUS' : 'RESOURCE_ITEM_UPDATE',
      resourceType: 'resourceItem',
      resourceId: id,
      metadata: { status: item.status, fields: Object.keys(input) },
    });
    return ok({ item });
  } catch (e) {
    return errorResponse(e, 'Could not save the resource');
  }
}
