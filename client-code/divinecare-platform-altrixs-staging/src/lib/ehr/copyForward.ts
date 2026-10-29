import { prisma } from '@/lib/db/prisma';
import { normalizeNoteType, stripLegacyAddenda } from '@/lib/ehr/noteTemplates';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { resolveNoteMeta } from '@/lib/clients/notes';
import type { Role } from '@prisma/client';

export type CopyForwardResult = {
  found: boolean;
  noteId: string | null;
  clientId: string | null;
  noteType: string | null;
  /** Note text to start from: no metadata comment, no addenda */
  body: string | null;
  displayBody: string | null;
  createdAt: string | null;
  clinicianName: string | null;
};

/**
 * Load the most recent ProgressNote for the same client + note type
 * (metadata column, falling back to the legacy comment). Addenda are never
 * copied: they live in their own table, and legacy addendum blocks that were
 * appended to old note bodies are stripped. 42 CFR Part 2: a SUD (Part 2) note is
 * never offered as the source for a note that is not itself Part 2. Psychotherapy
 * notes live in their own table and are never copied.
 */
export async function loadCopyForwardNote(input: {
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
  clientId: string;
  noteType: string;
  /** The note being written is a Part 2 (SUD) record; otherwise Part 2 sources are skipped */
  targetPart2?: boolean;
}): Promise<CopyForwardResult> {
  const empty: CopyForwardResult = {
    found: false,
    noteId: null,
    clientId: null,
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

  const targetType = normalizeNoteType(input.noteType).toUpperCase();
  const notes = await prisma.progressNote.findMany({
    // A dismissed draft (not needed / created in error) is never a copy-forward source
    where: { clientId: input.clientId, dismissedAt: null },
    include: {
      clinician: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 40,
  });

  const toResult = (note: (typeof notes)[number]): CopyForwardResult => {
    const meta = resolveNoteMeta(note);
    const text = stripLegacyAddenda(meta.displayBody).trim();
    return {
      found: Boolean(text),
      noteId: note.id,
      clientId: note.clientId,
      noteType: meta.noteType,
      body: text,
      displayBody: text,
      createdAt: note.createdAt.toISOString(),
      clinicianName: note.clinician?.name || null,
    };
  };

  const eligible = input.targetPart2 ? notes : notes.filter((n) => !resolveNoteMeta(n).part2);
  for (const note of eligible) {
    const type = normalizeNoteType(resolveNoteMeta(note).noteType || '').toUpperCase();
    if (type === targetType || (!type && targetType === 'PROGRESS')) {
      return toResult(note);
    }
  }

  // Fallback: most recent note of any type if exact type match missing
  const latest = eligible[0];
  if (!latest) return empty;
  return toResult(latest);
}
