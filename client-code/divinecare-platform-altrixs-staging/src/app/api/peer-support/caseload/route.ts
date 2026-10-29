import { getCaseload } from '@/lib/peerSupport/manage';
import { errorResponse, ok, peerGate } from '@/lib/peerSupport/http';
import { auditPhiAccess } from '@/lib/audit/requestMeta';

export const runtime = 'nodejs';

/** GET /api/peer-support/caseload — the actor's peer caseload, open follow-ups and summary counts. */
export async function GET(req: Request) {
  const g = await peerGate(req, 'peerCaseload', 'LIST');
  if (!g.ok) return g.res;
  try {
    const caseload = await getCaseload(g.actor);
    await auditPhiAccess({
      gate: g.gate,
      req,
      action: 'LIST',
      resourceType: 'peerCaseload',
      metadata: { count: caseload.clients.length, followUps: caseload.followUps.length },
    });
    return ok(caseload);
  } catch (error) {
    return errorResponse(error, 'Could not load your caseload', { gate: g.gate, req, action: 'LIST', resourceType: 'peerCaseload' });
  }
}
