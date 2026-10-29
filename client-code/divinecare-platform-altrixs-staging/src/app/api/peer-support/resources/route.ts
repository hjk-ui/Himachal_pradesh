import { listCommunityResources } from '@/lib/peerSupport/manage';
import { errorResponse, ok, peerGate } from '@/lib/peerSupport/http';

export const runtime = 'nodejs';

/** GET /api/peer-support/resources — active entries of the org's SDOH resource directory (no PHI). */
export async function GET(req: Request) {
  const g = await peerGate(req, 'SdohResource', 'LIST');
  if (!g.ok) return g.res;
  try {
    return ok({ resources: await listCommunityResources(g.actor.organizationId) });
  } catch (error) {
    return errorResponse(error, 'Could not load the directory', { gate: g.gate, req, action: 'LIST', resourceType: 'SdohResource' });
  }
}
