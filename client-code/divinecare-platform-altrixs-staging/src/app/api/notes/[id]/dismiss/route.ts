import { NextResponse } from 'next/server';
import { invalidateInboxForOrg } from '@/lib/inbox/cacheStore';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { verifiedAdminBaseRole } from '@/lib/auth/requireSession';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { DISMISS_REASON_MAX_CHARS, DISMISS_REASONS } from '@/lib/notes/dismiss';
import { dismissProgressNote, undoDismissProgressNote } from '@/lib/notes/dismissStore';

export const runtime = 'nodejs';

const bodySchema = z.object({
  /** "Created in error", "Duplicate note", "Visit didn't happen", "Other: …" (+ details); min 5 chars */
  reason: z.string().trim().max(DISMISS_REASON_MAX_CHARS),
});

type Ctx = { params: Promise<{ id: string }> };

/** Org + caseload access to the note (same as the note view / PATCH). */
async function gateNote(ctx: Ctx) {
  const gate = await requireOrgContext();
  if (!gate.ok) return { res: NextResponse.json({ success: false, error: gate.error }, { status: gate.status }) } as const;
  if (!canAccessPath(gate.role, '/dashboard/ehr/notes')) {
    return { res: NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 }) } as const;
  }
  const { id } = await ctx.params;
  const note = await prisma.progressNote.findFirst({
    where: { id, client: clientAccessWhere({ organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role }) },
    select: { id: true, clientId: true },
  });
  if (!note) return { res: NextResponse.json({ success: false, error: 'Note not found' }, { status: 404 }) } as const;
  return { gate, note } as const;
}

/**
 * POST /api/notes/[id]/dismiss { reason } — dismiss an unsigned note (author or administrator).
 * Never deletes: the note is marked dismissed, drops out of the documentation queues and stays
 * readable for leadership / audit. Audit metadata carries the reason category only, no note text.
 */
export async function POST(req: Request, ctx: Ctx) {
  const g = await gateNote(ctx);
  if ('res' in g) return g.res;
  const { gate, note } = g;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid request' }, { status: 400 });
  }
  const result = await dismissProgressNote({
    noteId: note.id,
    organizationId: gate.organizationId,
    actorUserId: gate.userId,
    actorRole: gate.role,
    actorBaseRole: await verifiedAdminBaseRole(gate.userId),
    reason: parsed.data.reason,
  });
  if (result.ok === false) {
    await auditPhiAccess({ gate, req, action: 'NOTE_DISMISS', resourceType: 'progressNote', resourceId: note.id, patientId: note.clientId, outcome: result.status === 403 ? 'DENIED' : 'FAILURE', metadata: { status: result.status } });
    return NextResponse.json({ success: false, error: result.error }, { status: result.status });
  }
  await auditPhiAccess({
    gate,
    req,
    action: 'NOTE_DISMISS',
    resourceType: 'progressNote',
    resourceId: note.id,
    patientId: note.clientId,
    // Reason category only ("Duplicate note"): free-text details may name the client
    metadata: { reasonCategory: DISMISS_REASONS.find((c) => parsed.data.reason.startsWith(c)) ?? 'Other', appointmentReset: result.appointmentReset, claimLeftUntouched: result.claimLeftUntouched },
  });
  // The inbox "Unsigned notes" row disappears right away (section cache)
  invalidateInboxForOrg(gate.organizationId);
  return NextResponse.json({ success: true, dismissedAt: result.dismissedAt, appointmentReset: result.appointmentReset });
}

/** DELETE /api/notes/[id]/dismiss — undo a dismissal (author or administrator, within 30 days). */
export async function DELETE(req: Request, ctx: Ctx) {
  const g = await gateNote(ctx);
  if ('res' in g) return g.res;
  const { gate, note } = g;
  const result = await undoDismissProgressNote({
    noteId: note.id,
    organizationId: gate.organizationId,
    actorUserId: gate.userId,
    actorRole: gate.role,
    actorBaseRole: await verifiedAdminBaseRole(gate.userId),
  });
  if (result.ok === false) {
    await auditPhiAccess({ gate, req, action: 'NOTE_DISMISS_UNDO', resourceType: 'progressNote', resourceId: note.id, patientId: note.clientId, outcome: result.status === 403 ? 'DENIED' : 'FAILURE', metadata: { status: result.status } });
    return NextResponse.json({ success: false, error: result.error }, { status: result.status });
  }
  await auditPhiAccess({ gate, req, action: 'NOTE_DISMISS_UNDO', resourceType: 'progressNote', resourceId: note.id, patientId: note.clientId });
  invalidateInboxForOrg(gate.organizationId);
  return NextResponse.json({ success: true });
}
