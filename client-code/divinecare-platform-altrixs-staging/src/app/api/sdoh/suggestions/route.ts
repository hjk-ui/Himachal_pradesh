import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { suggestionsForClient } from '@/lib/sdoh/manage';
import { errorResponse, fail, ok, sdohGate } from '@/lib/sdoh/http';

export const runtime = 'nodejs';

/** GET /api/sdoh/suggestions?clientId= — community resources matching the client's positive SDOH domains. */
export async function GET(req: Request) {
  const g = await sdohGate();
  if (!g.ok) return g.res;
  const clientId = new URL(req.url).searchParams.get('clientId');
  if (!clientId || clientId.length > 64) return fail('clientId is required', 400);
  try {
    const data = await suggestionsForClient(g.actor, clientId);
    await auditPhiAccess({
      gate: g.gate,
      req,
      action: 'READ',
      resourceType: 'SdohSuggestion',
      patientId: clientId,
      metadata: { domains: data.suggestions.map((s) => s.domain), matches: data.suggestions.reduce((t, s) => t + s.resources.length, 0) },
    });
    return ok(data);
  } catch (error) {
    return errorResponse(error, 'Could not load suggestions');
  }
}
