import type { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { loadWorkflowStatuses } from '@/lib/notes/workflow-store';
import { clientOrgFilter } from '@/lib/clients/orgScope';
import { isCaseloadRole } from '@/types/roles';

/**
 * Documentation productivity rows: note timing metadata only (no note body, no addenda).
 * The productivity page (Leadership + Office Manager) used the full /api/ehr/notes feed, which
 * Office Manager may not read (and does not need: timeliness is counted, notes are not read).
 */
export type ProductivityNoteRow = {
  id: string;
  createdAt: string;
  workflowStatus: 'Draft' | 'Signed' | 'Locked';
  signedAt: string | null;
  lockedAt: string | null;
  clinicianName: string | null;
  clinicianEmail: string | null;
  noteType: string | null;
  /** Client name for the overdue-note list; masked for 42 CFR Part 2 notes. */
  clientName: string;
};

/** Window the page charts (6 weekly buckets) plus a margin for overdue drafts. */
export const PRODUCTIVITY_WINDOW_DAYS = 56;
export const PRODUCTIVITY_MAX_ROWS = 2000;

export async function listNoteProductivityRows(input: {
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
}): Promise<ProductivityNoteRow[]> {
  const orgClientWhere = clientOrgFilter(input.organizationId);
  const clientWhere = isCaseloadRole(input.actorRole)
    ? { AND: [orgClientWhere, { assignedToId: input.actorUserId }] }
    : orgClientWhere;
  const since = new Date(Date.now() - PRODUCTIVITY_WINDOW_DAYS * 86_400_000);

  const notes = await prisma.progressNote.findMany({
    // Dismissed drafts are not documentation work (src/lib/notes/dismiss.ts)
    where: { client: clientWhere, createdAt: { gte: since }, dismissedAt: null },
    orderBy: { createdAt: 'desc' },
    take: PRODUCTIVITY_MAX_ROWS,
    select: {
      id: true,
      createdAt: true,
      noteType: true,
      part2: true,
      client: { select: { name: true } },
      clinician: { select: { name: true, email: true } },
    },
  });
  const workflow = await loadWorkflowStatuses(notes.map((n) => n.id));

  return notes.map((note) => {
    const wf = workflow.get(note.id);
    return {
      id: note.id,
      createdAt: note.createdAt.toISOString(),
      workflowStatus: wf?.status ?? 'Draft',
      signedAt: wf?.signedAt ?? null,
      lockedAt: wf?.lockedAt ?? null,
      clinicianName: wf?.clinicianName || note.clinician?.name || null,
      clinicianEmail: note.clinician?.email ?? null,
      noteType: note.noteType ?? null,
      clientName: note.part2 ? 'Protected record' : note.client.name || 'Client',
    };
  });
}
