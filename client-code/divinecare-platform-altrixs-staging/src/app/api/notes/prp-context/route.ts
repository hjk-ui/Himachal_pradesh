import { NextResponse } from 'next/server';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { requireNotesGate } from '@/lib/notes/routeAccess';
import { loadPrpNoteContext } from '@/lib/prp/progressNoteDb';

export const runtime = 'nodejs';

/**
 * GET /api/notes/prp-context?clientId=&noteId=&appointmentId= — what the PRP progress note offers:
 * the IRP objectives (with IRP status / review warnings), the previous PRP note's objectives as a
 * suggestion, the next booked appointment, and visit defaults. Caseload scoped.
 */
export async function GET(req: Request) {
  const g = await requireNotesGate();
  if (g.ok === false) return NextResponse.json({ success: false, error: g.error }, { status: g.status });
  const url = new URL(req.url);
  const clientId = url.searchParams.get('clientId')?.trim();
  if (!clientId) return NextResponse.json({ success: false, error: 'clientId required' }, { status: 400 });
  const noteId = url.searchParams.get('noteId')?.trim() || null;
  const appointmentId = url.searchParams.get('appointmentId')?.trim() || null;
  const context = await loadPrpNoteContext({
    organizationId: g.gate.organizationId,
    actorUserId: g.gate.userId,
    actorRole: g.gate.role,
    clientId,
    noteId,
    appointmentId,
  }).catch(() => null);
  if (!context) return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });
  await auditPhiAccess({
    gate: g.gate,
    req,
    action: 'READ',
    resourceType: 'prpIrp',
    patientId: clientId,
    metadata: { purpose: 'prp_note_context', objectiveCount: context.irp.objectives.length, noteId, appointmentId },
  });
  return NextResponse.json({ success: true, ...context });
}
