import { createContact, listContacts, type ContactInput } from '@/lib/peerSupport/manage';
import { createContactSchema, errorResponse, ok, peerGate } from '@/lib/peerSupport/http';
import { auditPhiAccess } from '@/lib/audit/requestMeta';

export const runtime = 'nodejs';

/** GET /api/peer-support/contacts?clientId=&days= — peer contacts in scope (voided hidden). */
export async function GET(req: Request) {
  const g = await peerGate(req, 'PeerContact', 'LIST');
  if (!g.ok) return g.res;
  const params = new URL(req.url).searchParams;
  const clientId = params.get('clientId');
  try {
    const days = Number(params.get('days')) || undefined;
    const contacts = await listContacts(g.actor, { clientId, days: days && days > 0 && days <= 3650 ? days : undefined });
    await auditPhiAccess({
      gate: g.gate,
      req,
      action: 'LIST',
      resourceType: 'PeerContact',
      patientId: clientId,
      metadata: { count: contacts.length, clientIds: [...new Set(contacts.map((c) => c.clientId))].slice(0, 100) },
    });
    return ok({ contacts });
  } catch (error) {
    return errorResponse(error, 'Could not load contacts', { gate: g.gate, req, action: 'LIST', resourceType: 'PeerContact', patientId: clientId });
  }
}

/** POST /api/peer-support/contacts — log a contact (optionally closing earlier follow-ups). */
export async function POST(req: Request) {
  const g = await peerGate(req, 'PeerContact', 'CREATE');
  if (!g.ok) return g.res;
  let clientId: string | null = null;
  try {
    const body = createContactSchema.parse(await req.json());
    clientId = body.clientId;
    const result = await createContact(g.actor, body as ContactInput);
    await auditPhiAccess({
      gate: g.gate,
      req,
      action: 'CREATE',
      resourceType: 'PeerContact',
      resourceId: result.contact.id,
      patientId: result.contact.clientId,
      metadata: { mode: body.mode, followUp: Boolean(body.followUpAt), followUpsCompleted: result.followUpsCompleted },
    });
    return ok(result, 201);
  } catch (error) {
    return errorResponse(error, 'Contact could not be saved', { gate: g.gate, req, action: 'CREATE', resourceType: 'PeerContact', patientId: clientId });
  }
}
