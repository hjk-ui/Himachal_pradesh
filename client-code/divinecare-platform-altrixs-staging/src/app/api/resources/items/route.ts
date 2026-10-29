import { createItem, listItems } from '@/lib/resources/store';
import { auditPhiAccessResource, errorResponse, itemInputSchema, ok, resourceGate } from '../_shared';

export const runtime = 'nodejs';

/** GET ?scope=patient|staff: library items the viewer may see, with their favorites and recently used. No PHI. */
export async function GET(req: Request) {
  const g = await resourceGate();
  if (g.ok === false) return g.res;
  try {
    const scope = new URL(req.url).searchParams.get('scope') === 'staff' ? 'staff' : 'patient';
    return ok(await listItems(g.actor, scope));
  } catch (e) {
    return errorResponse(e, 'Could not load the library');
  }
}

/** POST: add a resource (created as a draft). */
export async function POST(req: Request) {
  const g = await resourceGate();
  if (g.ok === false) return g.res;
  try {
    const input = itemInputSchema.parse(await req.json());
    const item = await createItem(g.actor, input);
    await auditPhiAccessResource(g.gate, req, { action: 'RESOURCE_ITEM_CREATE', resourceType: 'resourceItem', resourceId: item.id, metadata: { audience: item.audience, kind: item.kind } });
    return ok({ item }, 201);
  } catch (e) {
    return errorResponse(e, 'Could not add the resource');
  }
}
