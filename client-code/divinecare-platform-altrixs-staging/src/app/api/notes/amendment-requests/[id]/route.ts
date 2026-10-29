import { NextResponse } from 'next/server';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { decideAmendmentRequest, decideAmendmentSchema } from '@/lib/notes/amendments';
import { requireNotesGate } from '@/lib/notes/routeAccess';

export const runtime = 'nodejs';

/**
 * PATCH /api/notes/amendment-requests/[id] — accept (amendment added to the signed note as an
 * addendum), deny (basis required), extend once by 30 days, or record the client's statement of
 * disagreement after a denial. 45 CFR 164.526.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireNotesGate();
  if (g.ok === false) return NextResponse.json({ success: false, error: g.error }, { status: g.status });
  const { id } = await ctx.params;
  const parsed = decideAmendmentSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid request' }, { status: 400 });
  const actor = { organizationId: g.gate.organizationId, actorUserId: g.gate.userId, actorRole: g.gate.role, actorBaseRole: g.baseRole };
  const result = await decideAmendmentRequest(actor, id, parsed.data);
  if (result.ok === false) {
    await auditPhiAccess({ gate: g.gate, req, action: 'AMENDMENT_REQUEST_DECIDE', resourceType: 'noteAmendmentRequest', resourceId: id, outcome: result.status === 403 ? 'DENIED' : 'FAILURE', metadata: { action: parsed.data.action } });
    return NextResponse.json({ success: false, error: result.error }, { status: result.status });
  }
  await auditPhiAccess({
    gate: g.gate,
    req,
    action: 'AMENDMENT_REQUEST_DECIDE',
    resourceType: 'noteAmendmentRequest',
    resourceId: id,
    patientId: result.clientId,
    metadata: { action: parsed.data.action, status: result.request.status, addendumId: result.request.addendumId },
  });
  return NextResponse.json({ success: true, request: result.request });
}
