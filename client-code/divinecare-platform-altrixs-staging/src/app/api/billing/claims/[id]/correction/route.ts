import { cancelClaimCorrection, startClaimCorrection } from '@/lib/billing/claims';
import { claimsGate, errorJson, resultJson } from '../../_lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST { kind: 'replace' | 'void', payerClaimControlNumber? }: "Send corrected claim" / "Void claim".
 * The claim returns to READY with CLM05-3 = 7 / 8, REF*F8 and a new CLM01, and is then
 * sent like any READY claim. Audited in startClaimCorrection (writeAuditLog with the clientId).
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const g = await claimsGate();
  if (!g.ok) return g.response;
  try {
    const { id } = await context.params;
    return resultJson(await startClaimCorrection(g.actor, id, await request.json().catch(() => ({}))));
  } catch (error) {
    return errorJson(error, 'Could not start the correction');
  }
}

/** DELETE: cancel an unsent correction / void (restores the claim). Audited in cancelClaimCorrection. */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const g = await claimsGate();
  if (!g.ok) return g.response;
  try {
    const { id } = await context.params;
    return resultJson(await cancelClaimCorrection(g.actor, id));
  } catch (error) {
    return errorJson(error, 'Could not cancel the correction');
  }
}
