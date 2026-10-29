import { seedStarterContent } from '@/lib/resources/store';
import { auditPhiAccessResource, errorResponse, ok, resourceGate } from '../_shared';

export const runtime = 'nodejs';

/** POST: add the verified starter content that is missing (idempotent; src/lib/resources/seedCatalog.ts). */
export async function POST(req: Request) {
  const g = await resourceGate();
  if (g.ok === false) return g.res;
  try {
    const result = await seedStarterContent(g.actor);
    await auditPhiAccessResource(g.gate, req, { action: 'RESOURCE_SEED', resourceType: 'resourceItem', metadata: result });
    return ok(result);
  } catch (e) {
    return errorResponse(e, 'Could not add the starter content');
  }
}
