import { importLegacyEntry, legacyOverview, listPeerStaff } from '@/lib/peerSupport/manage';
import { errorResponse, legacyImportSchema, ok, peerGate } from '@/lib/peerSupport/http';
import { auditPhiAccess } from '@/lib/audit/requestMeta';

export const runtime = 'nodejs';

/**
 * GET /api/peer-support/legacy — old peer module-list entries not yet filed to a client.
 * Leadership gets the entries; other roles get counts only.
 */
export async function GET(req: Request) {
  const g = await peerGate(req, 'peerLegacyEntries', 'LIST');
  if (!g.ok) return g.res;
  try {
    const overview = await legacyOverview(g.actor);
    const peers = overview.canImport ? await listPeerStaff(g.actor.organizationId) : [];
    await auditPhiAccess({
      gate: g.gate,
      req,
      action: 'LIST',
      resourceType: 'peerLegacyEntries',
      metadata: { entries: overview.entries.length, canImport: overview.canImport },
    });
    return ok({ ...overview, peers });
  } catch (error) {
    return errorResponse(error, 'Could not read the old lists', { gate: g.gate, req, action: 'LIST', resourceType: 'peerLegacyEntries' });
  }
}

/** POST /api/peer-support/legacy — file one old entry to a client the user picked (never auto-matched). */
export async function POST(req: Request) {
  const g = await peerGate(req, 'peerLegacyEntries', 'CREATE');
  if (!g.ok) return g.res;
  let clientId: string | null = null;
  try {
    const body = legacyImportSchema.parse(await req.json());
    clientId = body.clientId;
    const result = await importLegacyEntry(g.actor, body);
    await auditPhiAccess({
      gate: g.gate,
      req,
      action: 'CREATE',
      resourceType: body.kind === 'contact' ? 'PeerContact' : body.kind === 'goal' ? 'PeerGoal' : 'PeerPlacement',
      resourceId: result.id,
      patientId: result.clientId,
      metadata: { importType: 'legacy-module', legacyId: body.legacyId, peerUserId: body.peerUserId },
    });
    return ok(result, 201);
  } catch (error) {
    return errorResponse(error, 'Entry could not be filed', { gate: g.gate, req, action: 'CREATE', resourceType: 'peerLegacyEntries', patientId: clientId });
  }
}
