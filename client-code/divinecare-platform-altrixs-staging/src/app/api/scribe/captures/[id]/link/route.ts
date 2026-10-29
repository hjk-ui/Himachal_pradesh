import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { findCapture } from '@/lib/scribe/store';
import { afterCaptureLinked } from '@/lib/scribe/noteLink';
import { captureView, jsonError, scribeGate } from '../../../_lib/gate';

export const runtime = 'nodejs';

const bodySchema = z.object({ noteId: z.string().min(1).max(128) });

/**
 * POST /api/scribe/captures/[id]/link — the docked AI Scribe filled the draft into the note open in
 * the editor ("Start session"); link the capture to that note so delete-on-sign and the retention
 * job follow it. The note must be the clinician's own UNSIGNED note for the same client (and the
 * capture's appointment when it has one). Linking once only; the capture can no longer be dismissed.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await scribeGate({ entitlement: true });
  if (g.ok === false) return g.response;
  const { actor, gate } = g;
  const { id } = await ctx.params;
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return jsonError(400, 'noteId is required');
  }
  const cap = await findCapture(actor, id);
  if (!cap) return jsonError(404, 'Capture not found');
  if (cap.clinicianId !== actor.userId) return jsonError(403, 'Only the capturing clinician can link the note');
  if (cap.status === 'discarded' || cap.consentWithdrawnAt) return jsonError(409, 'This capture was closed.');
  if (cap.progressNoteId) {
    if (cap.progressNoteId === body.noteId) return NextResponse.json({ success: true, capture: captureView(cap), existing: true });
    return jsonError(409, 'This capture already belongs to another note.');
  }
  const note = await prisma.progressNote.findFirst({
    where: { id: body.noteId, clientId: cap.clientId, client: { organizationId: actor.organizationId } },
    select: { id: true, clinicianId: true, appointmentId: true, workflow: { select: { status: true } } },
  });
  if (!note) return jsonError(404, 'Note not found for this client');
  if (note.clinicianId !== actor.userId) return jsonError(403, 'Only your own note can be linked');
  if (note.workflow && note.workflow.status !== 'DRAFT') return jsonError(409, 'The note is already signed.');
  if (cap.appointmentId && note.appointmentId && cap.appointmentId !== note.appointmentId) return jsonError(409, 'The note belongs to a different visit.');
  const linked = await prisma.scribeCapture.updateMany({ where: { id: cap.id, progressNoteId: null }, data: { progressNoteId: note.id, status: 'note_created' } });
  if (!linked.count) return jsonError(409, 'This capture was linked to another note.');
  await auditPhiAccess({ gate, req, action: 'WRITE', resourceType: 'clientNote', resourceId: note.id, patientId: cap.clientId, metadata: { source: 'ai_scribe_docked', captureId: cap.id } });
  // Transcript risk on the capture (gates signing) and the capture clock as the note's start / end time
  const { clock } = await afterCaptureLinked(cap, note.id, actor.userId);
  const updated = await prisma.scribeCapture.findUnique({ where: { id: cap.id } });
  return NextResponse.json({ success: true, capture: updated ? captureView(updated) : null, sessionClock: clock });
}
