import { prisma } from '@/lib/db/prisma';

export const DISMISS_REASONS = [
  'Created in error',
  'Duplicate note',
  "Visit didn't happen",
  'Wrong client',
  'Other…',
] as const;

export type DismissReason = (typeof DISMISS_REASONS)[number];

export const DISMISS_UNDO_DAYS = 30;

export const DISMISS_BLOCKED_MESSAGE =
  'Only an unsigned note can be dismissed. Signed notes are corrected with an addendum.';

export const DISMISS_LOCKED_MESSAGE =
  'This note was dismissed. Undo the dismissal before editing or signing.';

export function dismissConfirmBody(clientName?: string | null) {
  const who = clientName?.trim() ? ` for ${clientName.trim()}` : '';
  return `Dismiss this unsigned note${who}? It leaves your drafts, the visit shows "No note" again and nothing is billed. The note is kept read-only for the record; you can undo within 30 days.`;
}

export async function dismissProgressNote(input: {
  noteId: string;
  actorId: string;
  actorName: string | null;
  organizationId: string;
  reason: string;
  details?: string | null;
  elevated?: boolean;
}) {
  const note = await prisma.progressNote.findUnique({
    where: { id: input.noteId },
    include: { workflow: true, client: { select: { name: true, organizationId: true } } },
  });
  if (!note || note.client.organizationId !== input.organizationId) {
    return { ok: false as const, error: 'Note not found', status: 404 };
  }
  if (note.dismissedAt) {
    return { ok: false as const, error: 'Note already dismissed', status: 400 };
  }
  if (note.workflow?.status && note.workflow.status !== 'DRAFT') {
    return { ok: false as const, error: DISMISS_BLOCKED_MESSAGE, status: 400 };
  }
  if (!input.elevated && note.clinicianId && note.clinicianId !== input.actorId) {
    return { ok: false as const, error: 'Forbidden', status: 403 };
  }
  if (!DISMISS_REASONS.includes(input.reason as DismissReason)) {
    return { ok: false as const, error: 'Invalid dismiss reason', status: 400 };
  }
  const details = (input.details || '').trim();
  if (input.reason === 'Other…' && details.length < 5) {
    return { ok: false as const, error: 'Details required (min 5 characters)', status: 400 };
  }
  if (details.length > 300) {
    return { ok: false as const, error: 'Details max 300 characters', status: 400 };
  }

  const reasonStored =
    input.reason === 'Other…' ? `Other: ${details}` : details ? `${input.reason} — ${details}` : input.reason;

  await prisma.progressNote.update({
    where: { id: note.id },
    data: {
      dismissedAt: new Date(),
      dismissedById: input.actorId,
      dismissedByName: input.actorName,
      dismissReason: reasonStored,
    },
  });

  console.info('[NOTE_DISMISS]', {
    noteId: note.id,
    actorId: input.actorId,
    reason: input.reason,
  });

  return { ok: true as const, clientName: note.client.name };
}

export async function undoDismissProgressNote(input: {
  noteId: string;
  actorId: string;
  organizationId: string;
  elevated?: boolean;
}) {
  const note = await prisma.progressNote.findUnique({
    where: { id: input.noteId },
    include: { client: { select: { organizationId: true } } },
  });
  if (!note || note.client.organizationId !== input.organizationId) {
    return { ok: false as const, error: 'Note not found', status: 404 };
  }
  if (!note.dismissedAt) {
    return { ok: false as const, error: 'Note is not dismissed', status: 400 };
  }
  const ageMs = Date.now() - note.dismissedAt.getTime();
  if (ageMs > DISMISS_UNDO_DAYS * 24 * 60 * 60 * 1000) {
    return { ok: false as const, error: 'Undo window expired (30 days)', status: 400 };
  }
  if (!input.elevated && note.clinicianId && note.clinicianId !== input.actorId) {
    return { ok: false as const, error: 'Forbidden', status: 403 };
  }

  await prisma.progressNote.update({
    where: { id: note.id },
    data: {
      dismissedAt: null,
      dismissedById: null,
      dismissedByName: null,
      dismissReason: null,
    },
  });

  console.info('[NOTE_DISMISS_UNDO]', { noteId: note.id, actorId: input.actorId });
  return { ok: true as const };
}

export const NOT_DISMISSED = { dismissedAt: null } as const;
