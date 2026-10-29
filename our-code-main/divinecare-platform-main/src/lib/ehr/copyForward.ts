import { prisma } from '@/lib/db/prisma';
import { parseNoteMeta } from '@/lib/ehr/noteTemplates';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import type { Role } from '@prisma/client';

export type CopyForwardResult = {
  found: boolean;
  noteId: string | null;
  noteType: string | null;
  body: string | null;
  displayBody: string | null;
  createdAt: string | null;
  clinicianName: string | null;
};

/**
 * Load the most recent ProgressNote for the same client + note type (from encoded meta).
 */
export async function loadCopyForwardNote(input: {
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
  clientId: string;
  noteType: string;
}): Promise<CopyForwardResult> {
  const empty: CopyForwardResult = {
    found: false,
    noteId: null,
    noteType: null,
    body: null,
    displayBody: null,
    createdAt: null,
    clinicianName: null,
  };

  const client = await prisma.client.findFirst({
    where: {
      id: input.clientId,
      ...clientAccessWhere({
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
      }),
    },
    select: { id: true },
  });
  if (!client) return empty;

  const targetType = input.noteType.trim().toUpperCase();
  const notes = await prisma.progressNote.findMany({
    where: { clientId: input.clientId },
    include: {
      clinician: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 40,
  });

  for (const note of notes) {
    const meta = parseNoteMeta(note.body);
    const noteType = (meta.noteType || '').toUpperCase();
    if (noteType === targetType || (!noteType && targetType === 'PROGRESS')) {
      return {
        found: true,
        noteId: note.id,
        noteType: meta.noteType,
        body: note.body,
        displayBody: meta.displayBody,
        createdAt: note.createdAt.toISOString(),
        clinicianName: note.clinician?.name || null,
      };
    }
  }

  // Fallback: most recent note of any type if exact type match missing
  const latest = notes[0];
  if (!latest) return empty;
  const meta = parseNoteMeta(latest.body);
  return {
    found: true,
    noteId: latest.id,
    noteType: meta.noteType,
    body: latest.body,
    displayBody: meta.displayBody,
    createdAt: latest.createdAt.toISOString(),
    clinicianName: latest.clinician?.name || null,
  };
}
