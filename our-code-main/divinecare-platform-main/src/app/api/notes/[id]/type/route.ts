import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { prisma } from '@/lib/db/prisma';
import {
  parseNoteMeta,
  encodeNoteBody,
  structuredNoteSections,
  normalizeNoteType,
  type NoteType,
} from '@/lib/ehr/noteTemplates';
import {
  CARRIED_OVER_HELP,
  carriedOverHeading,
  remapNoteSections,
} from '@/lib/notes/typeChange';
import { DISMISS_LOCKED_MESSAGE } from '@/lib/notes/dismiss';

export const runtime = 'nodejs';

const bodySchema = z.object({
  toType: z.string().min(1).max(64),
  sections: z.record(z.string(), z.string()).optional(),
});

/**
 * Mid-visit note type change — carries unmatched sections under "Carried over".
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (gate.ok === false) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/ehr/notes')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await ctx.params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Invalid payload' }, { status: 400 });
  }

  const note = await prisma.progressNote.findUnique({
    where: { id },
    include: {
      workflow: true,
      client: { select: { organizationId: true, name: true } },
    },
  });
  if (!note || note.client.organizationId !== gate.organizationId) {
    return NextResponse.json({ success: false, error: 'Note not found' }, { status: 404 });
  }
  if (note.dismissedAt) {
    return NextResponse.json({ success: false, error: DISMISS_LOCKED_MESSAGE }, { status: 400 });
  }
  if (note.workflow?.status && note.workflow.status !== 'DRAFT') {
    return NextResponse.json(
      { success: false, error: 'Only an unsigned note can change type.' },
      { status: 400 }
    );
  }

  const meta = parseNoteMeta(note.body);
  const fromType = meta.noteType || 'SOAP';
  const toType = parsed.data.toType;
  const typedFrom = normalizeNoteType(fromType) as NoteType;
  const currentSections =
    parsed.data.sections ||
    Object.fromEntries(
      structuredNoteSections(typedFrom, meta.displayBody || note.body).map((s) => [s.title, s.text])
    );

  const remapped = remapNoteSections(fromType, toType, currentSections);
  let bodyParts: string[] = [];
  for (const [k, v] of Object.entries(remapped.sections)) {
    bodyParts.push(`${k}\n${v}`);
  }
  if (Object.keys(remapped.carriedOver).length > 0) {
    bodyParts.push(`${carriedOverHeading(fromType)}\n${CARRIED_OVER_HELP}`);
    for (const [k, v] of Object.entries(remapped.carriedOver)) {
      bodyParts.push(`${k}\n${v}`);
    }
  }

  const nextBody = encodeNoteBody(bodyParts.join('\n\n'), {
    noteType: toType,
    durationMinutes: meta.durationMinutes,
    billingCode: remapped.cptCleared.some((c) => meta.billingCode === c)
      ? undefined
      : meta.billingCode || undefined,
    telehealth: meta.telehealth,
    placeOfService: meta.placeOfService,
    sudConfidential: meta.sudConfidential,
  });

  await prisma.progressNote.update({
    where: { id: note.id },
    data: { body: nextBody },
  });

  console.info('[NOTE_TYPE_CHANGE]', {
    noteId: note.id,
    fromType,
    toType,
    actorId: gate.userId,
  });

  return NextResponse.json({
    success: true,
    fromType,
    toType,
    carriedOver: remapped.carriedOver,
    cptCleared: remapped.cptCleared,
    body: nextBody,
  });
}
