/**
 * Dismiss / undo-dismiss an unsigned note (server). Rules: src/lib/notes/dismiss.ts. The caller
 * (POST / DELETE /api/notes/[id]/dismiss) has already checked org / caseload access and audits.
 *
 * Nothing is deleted: the note keeps its text, workflow and links. Conditional updates make a
 * race with signing safe (a note signed a moment earlier is not dismissed). A claim is never
 * created from an unsigned note; if one exists anyway it is left untouched (reported to audit).
 */
import type { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { clientOrgFilter } from '@/lib/clients/orgScope';
import { isElevatedNoteActor } from '@/lib/clients/notes';
import { dismissBlocker, dismissReasonError, undoDismissBlocker } from './dismiss';

type Actor = { organizationId: string; actorUserId: string; actorRole: Role; actorBaseRole?: Role | null };

export type DismissResult =
  | { ok: true; clientId: string; dismissedAt: string; appointmentReset: boolean; claimLeftUntouched: boolean }
  | { ok: false; status: number; error: string };

export type UndoDismissResult = { ok: true; clientId: string } | { ok: false; status: number; error: string };

const UNSIGNED = { OR: [{ workflow: { is: null } }, { workflow: { is: { status: 'DRAFT' as const } } }] };

async function loadNote(noteId: string, organizationId: string) {
  return prisma.progressNote.findFirst({
    where: { id: noteId, client: clientOrgFilter(organizationId) },
    select: {
      id: true,
      clientId: true,
      clinicianId: true,
      appointmentId: true,
      dismissedAt: true,
      workflow: { select: { status: true, cosignedAt: true } },
    },
  });
}

/**
 * The visit shows "No note" again (and counts as needing a note) once its only live note is
 * dismissed: a stored AI-draft / in-progress status goes back to NOT_STARTED. SIGNED is never touched.
 */
async function resetAppointmentNoteStatus(appointmentId: string, exceptNoteId: string): Promise<boolean> {
  const others = await prisma.progressNote.count({ where: { appointmentId, dismissedAt: null, id: { not: exceptNoteId } } });
  if (others > 0) return false;
  const res = await prisma.appointment.updateMany({
    where: { id: appointmentId, noteStatus: { in: ['AI_DRAFT', 'IN_PROGRESS'] } },
    data: { noteStatus: 'NOT_STARTED' },
  });
  return res.count > 0;
}

export async function dismissProgressNote(input: Actor & { noteId: string; reason: string }): Promise<DismissResult> {
  const reasonError = dismissReasonError(input.reason);
  if (reasonError) return { ok: false, status: 400, error: reasonError };
  const note = await loadNote(input.noteId, input.organizationId);
  if (!note) return { ok: false, status: 404, error: 'Note not found' };
  // Same rule as editing a draft: the author, or an administrator / director
  if (note.clinicianId !== input.actorUserId && !isElevatedNoteActor(input.actorRole, input.actorBaseRole)) {
    return { ok: false, status: 403, error: 'Only the note author or an administrator can dismiss this note.' };
  }
  const blocker = dismissBlocker({ status: note.workflow?.status, cosignedAt: note.workflow?.cosignedAt, dismissedAt: note.dismissedAt });
  if (blocker) return { ok: false, status: 409, error: blocker };

  const actor = await prisma.user.findUnique({ where: { id: input.actorUserId }, select: { name: true, email: true } }).catch(() => null);
  const now = new Date();
  const updated = await prisma.progressNote.updateMany({
    where: { id: note.id, dismissedAt: null, ...UNSIGNED },
    data: {
      dismissedAt: now,
      dismissedById: input.actorUserId,
      dismissedByName: actor?.name?.trim() || actor?.email || null,
      dismissReason: input.reason.trim(),
    },
  });
  if (updated.count === 0) return { ok: false, status: 409, error: 'This note was just signed or dismissed. Reload it.' };

  const appointmentReset = note.appointmentId ? await resetAppointmentNoteStatus(note.appointmentId, note.id).catch(() => false) : false;
  const claimLeftUntouched = (await prisma.claim.count({ where: { progressNoteId: note.id } }).catch(() => 0)) > 0;
  return { ok: true, clientId: note.clientId, dismissedAt: now.toISOString(), appointmentReset, claimLeftUntouched };
}

export async function undoDismissProgressNote(input: Actor & { noteId: string; now?: Date }): Promise<UndoDismissResult> {
  const note = await loadNote(input.noteId, input.organizationId);
  if (!note) return { ok: false, status: 404, error: 'Note not found' };
  const blocker = undoDismissBlocker({
    dismissedAt: note.dismissedAt,
    now: input.now ?? new Date(),
    isAuthor: note.clinicianId === input.actorUserId,
    elevated: isElevatedNoteActor(input.actorRole, input.actorBaseRole),
  });
  if (blocker) return { ok: false, status: note.dismissedAt ? 403 : 409, error: blocker };
  // The visit was documented again since: restoring this draft would give it two notes
  if (note.appointmentId) {
    const other = await prisma.progressNote.count({ where: { appointmentId: note.appointmentId, dismissedAt: null, id: { not: note.id } } });
    if (other > 0) return { ok: false, status: 409, error: 'Another note now documents this visit. Open that note instead.' };
  }
  const updated = await prisma.progressNote.updateMany({
    where: { id: note.id, dismissedAt: { not: null } },
    data: { dismissedAt: null, dismissedById: null, dismissedByName: null, dismissReason: null },
  });
  if (updated.count === 0) return { ok: false, status: 409, error: 'This note is not dismissed.' };
  return { ok: true, clientId: note.clientId };
}
