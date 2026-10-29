import { NextResponse } from 'next/server';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { requireAccessibleNote } from '@/lib/notes/routeAccess';
import { loadNoteSignReadiness } from '@/lib/notes/worklist';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/notes/[id]/sign-readiness — may this note be signed inline (inbox / Today "Sign")?
 * Same blockers as the "Awaiting my signature" queue; returns only the first blocker message,
 * whether a late-entry reason is needed, and where to finish the note. No note text.
 * Signing itself stays PATCH /api/notes/[id] (attestation, blanks, plan gate, late entry).
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const access = await requireAccessibleNote(id);
  if (access.ok === false) return NextResponse.json({ success: false, error: access.error }, { status: access.status });
  try {
    const readiness = await loadNoteSignReadiness({ organizationId: access.gate.organizationId, actorUserId: access.gate.userId, noteId: access.note.id });
    if (!readiness) return NextResponse.json({ success: false, error: 'Note not found' }, { status: 404 });
    await auditPhiAccess({
      gate: access.gate,
      req,
      action: 'READ',
      resourceType: 'progressNote',
      resourceId: readiness.noteId,
      patientId: readiness.clientId,
      metadata: { view: 'signReadiness', ready: readiness.ready },
    });
    return NextResponse.json({ success: true, readiness }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[api/notes/[id]/sign-readiness GET]', err instanceof Error ? err.name : 'unknown');
    return NextResponse.json({ success: false, error: 'Could not check the note' }, { status: 500 });
  }
}
