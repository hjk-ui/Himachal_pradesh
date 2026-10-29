import { NextResponse } from 'next/server';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { isElevatedNoteActor } from '@/lib/clients/notes';
import { requireAccessibleNote } from '@/lib/notes/routeAccess';
import { EMPTY_PRP_DETAIL } from '@/lib/prp/progressNote';
import { getPrpNoteDetail, prpDetailSchema, savePrpNoteDetail } from '@/lib/prp/progressNoteDb';

export const runtime = 'nodejs';

/** GET /api/notes/[id]/prp-detail — PRP contact fields of a PRP progress note. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const access = await requireAccessibleNote(id);
  if (access.ok === false) return NextResponse.json({ success: false, error: access.error }, { status: access.status });
  const detail = (await getPrpNoteDetail(access.note.id)) ?? EMPTY_PRP_DETAIL;
  await auditPhiAccess({ gate: access.gate, req, action: 'READ', resourceType: 'progressNotePrpDetail', resourceId: access.note.id, patientId: access.note.clientId });
  return NextResponse.json({ success: true, detail });
}

/** PUT /api/notes/[id]/prp-detail — draft notes only; the author (or an admin / director). */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const access = await requireAccessibleNote(id);
  if (access.ok === false) return NextResponse.json({ success: false, error: access.error }, { status: access.status });
  if (access.note.clinicianId !== access.gate.userId && !isElevatedNoteActor(access.gate.role, access.baseRole)) {
    return NextResponse.json({ success: false, error: 'Only the note author or an administrator can edit this draft.' }, { status: 403 });
  }
  const parsed = prpDetailSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid request' }, { status: 400 });
  }
  let result: Awaited<ReturnType<typeof savePrpNoteDetail>>;
  try {
    result = await savePrpNoteDetail({ noteId: access.note.id, actorUserId: access.gate.userId, detail: parsed.data });
  } catch {
    return NextResponse.json({ success: false, error: 'PRP contact fields could not be saved (has the 20261027_prp_note_detail migration run?)' }, { status: 500 });
  }
  if (result.ok === false) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
  // Field names only (no values: objective labels and names are PHI)
  await auditPhiAccess({
    gate: access.gate,
    req,
    action: 'UPDATE',
    resourceType: 'progressNotePrpDetail',
    resourceId: access.note.id,
    patientId: access.note.clientId,
    metadata: { fields: Object.keys(parsed.data) },
  });
  return NextResponse.json({ success: true, detail: result.detail });
}
