import { createPlacement, listPlacements } from '@/lib/peerSupport/manage';
import { createPlacementSchema, errorResponse, ok, peerGate } from '@/lib/peerSupport/http';
import { auditPhiAccess } from '@/lib/audit/requestMeta';

export const runtime = 'nodejs';

/** GET /api/peer-support/placements?clientId=&includeClosed=1 — community placements in scope. */
export async function GET(req: Request) {
  const g = await peerGate(req, 'PeerPlacement', 'LIST');
  if (!g.ok) return g.res;
  const params = new URL(req.url).searchParams;
  const clientId = params.get('clientId');
  try {
    const placements = await listPlacements(g.actor, { clientId, includeClosed: params.get('includeClosed') === '1' });
    await auditPhiAccess({
      gate: g.gate,
      req,
      action: 'LIST',
      resourceType: 'PeerPlacement',
      patientId: clientId,
      metadata: { count: placements.length, clientIds: [...new Set(placements.map((x) => x.clientId))].slice(0, 100) },
    });
    return ok({ placements });
  } catch (error) {
    return errorResponse(error, 'Could not load placements', { gate: g.gate, req, action: 'LIST', resourceType: 'PeerPlacement', patientId: clientId });
  }
}

/** POST /api/peer-support/placements — record a community placement. */
export async function POST(req: Request) {
  const g = await peerGate(req, 'PeerPlacement', 'CREATE');
  if (!g.ok) return g.res;
  let clientId: string | null = null;
  try {
    const body = createPlacementSchema.parse(await req.json());
    clientId = body.clientId;
    const placement = await createPlacement(g.actor, body);
    await auditPhiAccess({
      gate: g.gate,
      req,
      action: 'CREATE',
      resourceType: 'PeerPlacement',
      resourceId: placement.id,
      patientId: placement.clientId,
      metadata: { placementType: placement.placementType, status: placement.status, resourceId: placement.resourceId },
    });
    return ok({ placement }, 201);
  } catch (error) {
    return errorResponse(error, 'Placement could not be saved', { gate: g.gate, req, action: 'CREATE', resourceType: 'PeerPlacement', patientId: clientId });
  }
}
