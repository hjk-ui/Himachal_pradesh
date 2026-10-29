import { NextResponse } from 'next/server';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { isElevatedNoteActor } from '@/lib/clients/notes';
import { EMPTY_SERVICE_DETAIL, getServiceDetail, saveServiceDetail, serviceDetailSchema } from '@/lib/notes/serviceDetail';
import { requireAccessibleNote } from '@/lib/notes/routeAccess';

export const runtime = 'nodejs';

/** GET /api/notes/[id]/service-detail — start / end time, telehealth modality, linked diagnoses. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const access = await requireAccessibleNote(id);
  if (access.ok === false) return NextResponse.json({ success: false, error: access.error }, { status: access.status });
  const detail = (await getServiceDetail(access.note.id)) ?? EMPTY_SERVICE_DETAIL;
  await auditPhiAccess({ gate: access.gate, req, action: 'READ', resourceType: 'progressNoteServiceDetail', resourceId: access.note.id, patientId: access.note.clientId });
  return NextResponse.json({ success: true, detail });
}

/** PUT /api/notes/[id]/service-detail — draft notes only; the author (or an admin / director). */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const access = await requireAccessibleNote(id);
  if (access.ok === false) return NextResponse.json({ success: false, error: access.error }, { status: access.status });
  if (access.note.clinicianId !== access.gate.userId && !isElevatedNoteActor(access.gate.role, access.baseRole)) {
    return NextResponse.json({ success: false, error: 'Only the note author or an administrator can edit this draft.' }, { status: 403 });
  }
  const parsed = serviceDetailSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid request' }, { status: 400 });
  }
  const result = await saveServiceDetail({ noteId: access.note.id, actorUserId: access.gate.userId, detail: parsed.data });
  if (result.ok === false) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
  await auditPhiAccess({
    gate: access.gate,
    req,
    action: 'UPDATE',
    resourceType: 'progressNoteServiceDetail',
    resourceId: access.note.id,
    patientId: access.note.clientId,
    metadata: { fields: Object.keys(parsed.data), diagnosisCount: result.detail.diagnosisCodes.length },
  });
  return NextResponse.json({ success: true, detail: result.detail });
}
