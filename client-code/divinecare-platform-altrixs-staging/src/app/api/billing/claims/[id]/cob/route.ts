import { claimCobSource, saveClaimCob } from '@/lib/billing/claims';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { claimsGate, errorJson, resultJson } from '../../_lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET: where this secondary / tertiary claim's COB comes from (previous payer 835, or staff entry). */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const g = await claimsGate();
  if (!g.ok) return g.response;
  try {
    const { id } = await context.params;
    const result = await claimCobSource(g.actor, id);
    if (result.ok) {
      await auditPhiAccess({ gate: g.gate, req: request, action: 'claim_cob_viewed', resourceType: 'Claim', resourceId: id, patientId: result.clientId });
    }
    return resultJson(result);
  } catch (error) {
    return errorJson(error, 'Could not load COB details');
  }
}

/** PUT { rank, paidAmount, paidDate, adjustments, lines? }: staff entry of the previous payer adjudication. Audited in saveClaimCob. */
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const g = await claimsGate();
  if (!g.ok) return g.response;
  try {
    const { id } = await context.params;
    return resultJson(await saveClaimCob(g.actor, id, await request.json().catch(() => ({}))));
  } catch (error) {
    return errorJson(error, 'Could not save COB details');
  }
}
