import { NextResponse } from 'next/server';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { createAmendmentRequest, createAmendmentSchema, listAmendmentRequests } from '@/lib/notes/amendments';
import { requireNotesGate } from '@/lib/notes/routeAccess';

export const runtime = 'nodejs';

/** GET /api/notes/amendment-requests?clientId=&status= — HIPAA 164.526 amendment requests (caseload scoped). */
export async function GET(req: Request) {
  const g = await requireNotesGate();
  if (g.ok === false) return NextResponse.json({ success: false, error: g.error }, { status: g.status });
  const url = new URL(req.url);
  const clientId = url.searchParams.get('clientId')?.trim() || null;
  const status = url.searchParams.get('status')?.trim().toUpperCase() || null;
  const actor = { organizationId: g.gate.organizationId, actorUserId: g.gate.userId, actorRole: g.gate.role, actorBaseRole: g.baseRole };
  const requests = await listAmendmentRequests(actor, { clientId, status: status && ['PENDING', 'ACCEPTED', 'DENIED'].includes(status) ? status : null });
  await auditPhiAccess({ gate: g.gate, req, action: 'LIST', resourceType: 'noteAmendmentRequest', patientId: clientId, metadata: { count: requests.length } });
  return NextResponse.json({ success: true, requests });
}

/** POST /api/notes/amendment-requests — log a client's request to amend their record. */
export async function POST(req: Request) {
  const g = await requireNotesGate();
  if (g.ok === false) return NextResponse.json({ success: false, error: g.error }, { status: g.status });
  const parsed = createAmendmentSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid request' }, { status: 400 });
  const actor = { organizationId: g.gate.organizationId, actorUserId: g.gate.userId, actorRole: g.gate.role, actorBaseRole: g.baseRole };
  const result = await createAmendmentRequest(actor, parsed.data);
  if (result.ok === false) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
  await auditPhiAccess({
    gate: g.gate,
    req,
    action: 'AMENDMENT_REQUEST_CREATE',
    resourceType: 'noteAmendmentRequest',
    resourceId: result.request.id,
    patientId: parsed.data.clientId,
    metadata: { noteId: parsed.data.noteId ?? null, dueOn: result.request.dueOn },
  });
  return NextResponse.json({ success: true, request: result.request });
}
