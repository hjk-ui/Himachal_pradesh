import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { errorResponse, intensiveGate, ok } from '@/lib/intensive/http';
import { searchClients, staffOptions } from '@/lib/intensive/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/intensive/options[?q=]: team pickers, locations, groups to link (leadership); ?q= searches the viewer's clients. */
export async function GET(req: Request) {
  const g = await intensiveGate();
  if (!g.ok) return g.res;
  try {
    const q = new URL(req.url).searchParams.get('q');
    if (q !== null) {
      const clients = await searchClients(g.actor, q);
      await auditPhiAccess({ gate: g.gate, req, action: 'SEARCH', resourceType: 'client', metadata: { count: clients.length, scope: 'intensive_referral' } });
      return ok({ clients });
    }
    return ok({ options: await staffOptions(g.actor) });
  } catch (e) {
    return errorResponse(e, 'Could not load options');
  }
}
