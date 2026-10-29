import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { summary } from '@/lib/sdoh/manage';
import { errorResponse, ok, sdohGate } from '@/lib/sdoh/http';

export const runtime = 'nodejs';

/** GET /api/sdoh/summary — last 12 months, counts only (no client rows). */
export async function GET(req: Request) {
  const g = await sdohGate();
  if (!g.ok) return g.res;
  try {
    const data = await summary(g.actor);
    await auditPhiAccess({ gate: g.gate, req, action: 'LIST', resourceType: 'SdohSummary', metadata: { clientsScreened: data.clientsScreened } });
    return ok({ summary: data });
  } catch (error) {
    return errorResponse(error, 'Could not load the summary');
  }
}
