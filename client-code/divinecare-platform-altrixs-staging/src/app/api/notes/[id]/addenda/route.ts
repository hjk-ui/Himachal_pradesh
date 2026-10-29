import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { verifiedAdminBaseRole } from '@/lib/auth/requireSession';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { prisma } from '@/lib/db/prisma';
import { canAccessClientChartNotes, canWriteClientChartNotes } from '@/lib/clients/orgScope';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import {
  addNoteAddendum,
  addendumSchema,
  findAccessibleNote,
  serializeAddendum,
} from '@/lib/clients/notes';

export const runtime = 'nodejs';

const paramsSchema = z.object({ id: z.string().min(1).max(128) });

/** List a note's addenda (oldest first). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  // Admin base role from the DB (cached), never the JWT's baseRole claim (stale after a demotion).
  const baseRole = await verifiedAdminBaseRole(gate.userId);
  const canRead =
    canAccessPath(gate.role, '/dashboard/ehr/notes') ||
    canAccessClientChartNotes(gate.role) ||
    baseRole === 'ADMIN' ||
    baseRole === 'PRACTICE_DIRECTOR';
  if (!canRead) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const { id } = paramsSchema.parse(await ctx.params);
  const found = await findAccessibleNote({
    noteId: id,
    organizationId: gate.organizationId,
    actorUserId: gate.userId,
    actorRole: gate.role,
    actorBaseRole: baseRole,
  });
  if (found.ok === false) {
    return NextResponse.json({ success: false, error: found.error }, { status: found.status });
  }

  const rows = await prisma.progressNoteAddendum.findMany({
    where: { noteId: found.note.id },
    orderBy: { createdAt: 'asc' },
    select: { id: true, reason: true, text: true, authorName: true, createdAt: true },
  });
  await auditPhiAccess({ gate, req, action: 'READ', resourceType: 'progressNoteAddendum', resourceId: found.note.id, patientId: found.note.clientId, metadata: { count: rows.length } });
  return NextResponse.json({ success: true, addenda: rows.map(serializeAddendum) });
}

/**
 * Add an addendum to a signed or locked note. The note itself is never edited.
 * Body: { reason: one of ADDENDUM_REASONS, text }
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  // Admin base role from the DB (cached), never the JWT's baseRole claim (stale after a demotion).
  const baseRole = await verifiedAdminBaseRole(gate.userId);
  const canWrite =
    canAccessPath(gate.role, '/dashboard/ehr/notes') ||
    canWriteClientChartNotes(gate.role) ||
    baseRole === 'ADMIN' ||
    baseRole === 'PRACTICE_DIRECTOR';
  if (!canWrite) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const { id } = paramsSchema.parse(await ctx.params);
  const parsed = addendumSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message || 'Invalid addendum' },
      { status: 400 }
    );
  }

  const result = await addNoteAddendum({
    noteId: id,
    organizationId: gate.organizationId,
    actorUserId: gate.userId,
    actorRole: gate.role,
    actorBaseRole: baseRole,
    reason: parsed.data.reason,
    text: parsed.data.text,
  });
  if (result.ok === false) {
    return NextResponse.json({ success: false, error: result.error }, { status: result.status });
  }

  await auditPhiAccess({
    gate,
    req,
    action: 'NOTE_ADDENDUM',
    resourceType: 'progressNote',
    resourceId: id,
    patientId: result.clientId,
    metadata: { addendumId: result.addendum.id },
  });
  return NextResponse.json({ success: true, addendum: result.addendum }, { status: 201 });
}
