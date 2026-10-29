import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { verifiedAdminBaseRole } from '@/lib/auth/requireSession';
import { createClientNote, listClientNotes, noteMetaSchema } from '@/lib/clients/notes';
import { canAccessClientChartNotes, canWriteClientChartNotes } from '@/lib/clients/orgScope';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { watchProgressNote } from '@/lib/ai/riskWatch/hooks';

export const runtime = 'nodejs';

const paramsSchema = z.object({
  id: z.string().min(1).max(128),
});

const createNoteSchema = noteMetaSchema.extend({
  body: z.string().trim().min(1, 'Note is required').max(12000, 'Note is too long'),
  /** Note started from an appointment (appointment popover / telehealth "start note") */
  appointmentId: z.string().trim().min(1).max(128).nullish(),
});

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  // Admin base role from the DB (cached), never the JWT's baseRole claim.
  const baseRole = await verifiedAdminBaseRole(gate.userId);
  const canRead =
    canAccessClientChartNotes(gate.role) ||
    baseRole === 'ADMIN' ||
    baseRole === 'PRACTICE_DIRECTOR';
  if (!canRead) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const { id } = paramsSchema.parse(await ctx.params);
  const result = await listClientNotes({
    clientId: id,
    organizationId: gate.organizationId,
    actorUserId: gate.userId,
    actorRole: gate.role,
    actorBaseRole: baseRole,
  });

  if (result.ok === false) {
    return NextResponse.json(
      { success: false, error: result.error },
      { status: result.status }
    );
  }

  await auditPhiAccess({ gate, req, action: 'READ', resourceType: 'clientNote', patientId: id, metadata: { count: result.notes.length } });
  return NextResponse.json({ success: true, notes: result.notes });
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  // Admin base role from the DB (cached), never the JWT's baseRole claim.
  const baseRole = await verifiedAdminBaseRole(gate.userId);
  const canWrite =
    canWriteClientChartNotes(gate.role) ||
    baseRole === 'ADMIN' ||
    baseRole === 'PRACTICE_DIRECTOR';
  if (!canWrite) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const { id } = paramsSchema.parse(await ctx.params);
  const parsed = createNoteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message || 'Invalid note' },
      { status: 400 }
    );
  }
  const { body: noteBody, appointmentId, ...meta } = parsed.data;
  const result = await createClientNote({
    clientId: id,
    organizationId: gate.organizationId,
    actorUserId: gate.userId,
    actorRole: gate.role,
    actorBaseRole: baseRole,
    body: noteBody,
    meta,
    appointmentId: appointmentId ?? null,
  });

  if (result.ok === false) {
    return NextResponse.json(
      { success: false, error: result.error },
      { status: result.status }
    );
  }

  await auditPhiAccess({ gate, req, action: 'WRITE', resourceType: 'clientNote', resourceId: result.note.id, patientId: id });
  const riskWatch = await watchProgressNote({ noteId: result.note.id, organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role });
  return NextResponse.json({ success: true, note: result.note, riskWatch });
}
