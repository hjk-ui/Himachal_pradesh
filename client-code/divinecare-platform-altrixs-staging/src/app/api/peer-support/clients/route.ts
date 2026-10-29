import { searchClients } from '@/lib/peerSupport/manage';
import { errorResponse, ok, peerGate } from '@/lib/peerSupport/http';
import { auditPhiAccess } from '@/lib/audit/requestMeta';

export const runtime = 'nodejs';

/** GET /api/peer-support/clients?q= — name search inside the actor's peer scope (name + status only). */
export async function GET(req: Request) {
  const g = await peerGate(req, 'peerClientSearch', 'SEARCH');
  if (!g.ok) return g.res;
  try {
    const q = new URL(req.url).searchParams.get('q') ?? '';
    const clients = await searchClients(g.actor, q.slice(0, 80));
    await auditPhiAccess({ gate: g.gate, req, action: 'SEARCH', resourceType: 'peerClientSearch', metadata: { count: clients.length } });
    return ok({ clients });
  } catch (error) {
    return errorResponse(error, 'Search failed', { gate: g.gate, req, action: 'SEARCH', resourceType: 'peerClientSearch' });
  }
}
