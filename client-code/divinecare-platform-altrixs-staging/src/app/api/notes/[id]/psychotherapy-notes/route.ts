import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { requireAccessibleNote } from '@/lib/notes/routeAccess';
import { canUsePsychotherapyNote } from '@/lib/notes/psychotherapyAccess';

export const runtime = 'nodejs';

/**
 * HIPAA psychotherapy notes (45 CFR 164.501 / 164.508(a)(2)): the author's private process notes,
 * kept apart from the clinical record. Only the note's author can read or write them. They are
 * never part of the note body, print / PDF, export, release of information, copy-forward,
 * claims or AI. Every read and write is audited.
 */
const bodySchema = z.object({ text: z.string().max(20000, 'Too long') });

const AUTHOR_ONLY = 'Psychotherapy notes are private to the clinician who wrote the session note.';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const access = await requireAccessibleNote(id);
  if (access.ok === false) return NextResponse.json({ success: false, error: access.error }, { status: access.status });
  // Fail closed: a lookup error must not fall through to "no stored note"
  const row = await prisma.progressNotePsychotherapyNote.findUnique({ where: { noteId: access.note.id } });
  // Author-only: the note's clinician AND the stored row's author (even if the clinician changed)
  if (!canUsePsychotherapyNote({ callerId: access.gate.userId, noteClinicianId: access.note.clinicianId, storedAuthorId: row?.authorId })) {
    await auditPhiAccess({ gate: access.gate, req, action: 'PSYCHOTHERAPY_NOTE_READ', resourceType: 'psychotherapyNote', resourceId: access.note.id, patientId: access.note.clientId, outcome: 'DENIED' });
    return NextResponse.json({ success: false, error: AUTHOR_ONLY }, { status: 403 });
  }
  await auditPhiAccess({ gate: access.gate, req, action: 'PSYCHOTHERAPY_NOTE_READ', resourceType: 'psychotherapyNote', resourceId: access.note.id, patientId: access.note.clientId, metadata: { exists: Boolean(row) } });
  return NextResponse.json({ success: true, text: row?.text ?? '', updatedAt: row?.updatedAt?.toISOString() ?? null });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const access = await requireAccessibleNote(id);
  if (access.ok === false) return NextResponse.json({ success: false, error: access.error }, { status: access.status });
  const stored = await prisma.progressNotePsychotherapyNote.findUnique({ where: { noteId: access.note.id }, select: { authorId: true } });
  if (!canUsePsychotherapyNote({ callerId: access.gate.userId, noteClinicianId: access.note.clinicianId, storedAuthorId: stored?.authorId })) {
    await auditPhiAccess({ gate: access.gate, req, action: 'PSYCHOTHERAPY_NOTE_UPDATE', resourceType: 'psychotherapyNote', resourceId: access.note.id, patientId: access.note.clientId, outcome: 'DENIED' });
    return NextResponse.json({ success: false, error: AUTHOR_ONLY }, { status: 403 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid request' }, { status: 400 });
  const text = parsed.data.text.trim();
  let updatedAt: string | null = null;
  if (!text) {
    await prisma.progressNotePsychotherapyNote.deleteMany({ where: { noteId: access.note.id, authorId: access.gate.userId } });
  } else {
    const org = access.gate.organizationId;
    // New row: author is the caller. Existing row: only its author reaches here (checked above).
    const row = stored
      ? await prisma.progressNotePsychotherapyNote.update({
          where: { noteId: access.note.id, authorId: access.gate.userId },
          data: { text },
        })
      : await prisma.progressNotePsychotherapyNote.create({
          data: { noteId: access.note.id, organizationId: org, clientId: access.note.clientId, authorId: access.gate.userId, text },
        });
    updatedAt = row.updatedAt.toISOString();
  }
  await auditPhiAccess({
    gate: access.gate,
    req,
    action: 'PSYCHOTHERAPY_NOTE_UPDATE',
    resourceType: 'psychotherapyNote',
    resourceId: access.note.id,
    patientId: access.note.clientId,
    metadata: { cleared: !text, length: text.length },
  });
  return NextResponse.json({ success: true, text, updatedAt });
}
