import { updateContact, voidContact } from '@/lib/peerSupport/manage';
import { errorResponse, ok, peerGate, updateContactSchema, voidContactSchema } from '@/lib/peerSupport/http';
import { auditPhiAccess } from '@/lib/audit/requestMeta';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/** PATCH /api/peer-support/contacts/[id] — close / reschedule the follow-up, or (author) edit the entry. */
export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const g = await peerGate(req, 'PeerContact', 'UPDATE');
  if (!g.ok) return g.res;
  try {
    const body = updateContactSchema.parse(await req.json());
    const result = await updateContact(g.actor, id, body);
    await auditPhiAccess({
      gate: g.gate,
      req,
      action: 'UPDATE',
      resourceType: 'PeerContact',
      resourceId: id,
      patientId: result.clientId,
      metadata: { fields: Object.keys(body), editsContent: result.editsContent },
    });
    return ok({ contact: result.contact });
  } catch (error) {
    return errorResponse(error, 'Contact could not be updated', { gate: g.gate, req, action: 'UPDATE', resourceType: 'PeerContact', resourceId: id });
  }
}

/** DELETE /api/peer-support/contacts/[id] — void (kept for the record, removed from lists and counts). */
export async function DELETE(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const g = await peerGate(req, 'PeerContact', 'DELETE');
  if (!g.ok) return g.res;
  try {
    const body = voidContactSchema.parse(await req.json());
    const result = await voidContact(g.actor, id, body.reason);
    await auditPhiAccess({ gate: g.gate, req, action: 'DELETE', resourceType: 'PeerContact', resourceId: id, patientId: result.clientId, metadata: { voided: true } });
    return ok({ contact: result.contact });
  } catch (error) {
    return errorResponse(error, 'Contact could not be voided', { gate: g.gate, req, action: 'DELETE', resourceType: 'PeerContact', resourceId: id });
  }
}
