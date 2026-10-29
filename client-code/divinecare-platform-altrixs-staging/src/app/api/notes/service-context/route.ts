import { NextResponse } from 'next/server';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { loadServiceContext } from '@/lib/notes/serviceDetail';
import { requireNotesGate } from '@/lib/notes/routeAccess';

export const runtime = 'nodejs';

/**
 * GET /api/notes/service-context?clientId=&appointmentId= — what the note editor's Service details
 * offer: the client's chart diagnoses (to link) and defaults from the linked appointment.
 */
export async function GET(req: Request) {
  const g = await requireNotesGate();
  if (g.ok === false) return NextResponse.json({ success: false, error: g.error }, { status: g.status });
  const url = new URL(req.url);
  const clientId = url.searchParams.get('clientId')?.trim();
  const appointmentId = url.searchParams.get('appointmentId')?.trim() || null;
  if (!clientId) return NextResponse.json({ success: false, error: 'clientId required' }, { status: 400 });
  const context = await loadServiceContext({
    organizationId: g.gate.organizationId,
    actorUserId: g.gate.userId,
    actorRole: g.gate.role,
    clientId,
    appointmentId,
  });
  if (!context) return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });
  await auditPhiAccess({ gate: g.gate, req, action: 'READ', resourceType: 'clientDiagnoses', patientId: clientId, metadata: { purpose: 'note_service_details', appointmentId } });
  return NextResponse.json({ success: true, ...context });
}
