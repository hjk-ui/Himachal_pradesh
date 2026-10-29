import { prisma } from '@/lib/db/prisma';
import type { InboxDraft } from '@/lib/inbox/types';
import { isAttended, GROUP_KIND_META, isGroupKind } from './types';

/** Session page for a group session (Group Therapy or SUD Group Counseling area). */
export function groupSessionHref(kind: string, sessionId: string): string {
  const base = isGroupKind(kind) ? GROUP_KIND_META[kind].href : GROUP_KIND_META.psychotherapy.href;
  return `${base}/sessions/${encodeURIComponent(sessionId)}`;
}

const WINDOW_DAYS = 30;

/**
 * Inbox "Group notes to finish": the actor's ended sessions (facilitator or co-facilitator, last
 * 30 days, not cancelled) with no attendance taken or attendee notes not yet signed. One item per
 * session; no client names (the session page applies roster and protected-record rules).
 */
export async function groupNotesInboxDrafts(a: { organizationId: string; userId: string }, now: Date, deadlineHours = 24): Promise<InboxDraft[]> {
  const sessions = await prisma.clinicalGroupSession.findMany({
    where: {
      organizationId: a.organizationId,
      status: { not: 'cancelled' },
      endsAt: { lt: now, gt: new Date(now.getTime() - WINDOW_DAYS * 86_400_000) },
      OR: [{ facilitatorId: a.userId }, { coFacilitatorId: a.userId }],
    },
    orderBy: { startsAt: 'asc' },
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      group: { select: { name: true, kind: true, status: true } },
      attendance: { select: { status: true, progressNoteId: true } },
    },
    take: 200,
  });
  const noteIds = sessions.flatMap((s) => s.attendance.map((x) => x.progressNoteId).filter((x): x is string => Boolean(x)));
  const signed = new Set(
    (
      await prisma.progressNoteWorkflow.findMany({
        where: { noteId: { in: noteIds }, status: { in: ['SIGNED', 'LOCKED'] } },
        select: { noteId: true },
      })
    ).map((w) => w.noteId)
  );
  const out: InboxDraft[] = [];
  for (const s of sessions) {
    if (s.group.status === 'archived') continue;
    const marked = s.attendance.filter((x) => x.status !== 'unmarked');
    const attended = marked.filter((x) => isAttended(x.status));
    const unsigned = attended.filter((x) => !x.progressNoteId || !signed.has(x.progressNoteId)).length;
    const noAttendance = marked.length === 0;
    if (!noAttendance && unsigned === 0) continue;
    const late = now.getTime() - s.endsAt.getTime() > deadlineHours * 3_600_000;
    out.push({
      entityKey: `groupSession:${s.id}`,
      title: noAttendance ? `Take attendance: ${s.group.name}` : `Sign group notes: ${s.group.name}`,
      detail: noAttendance
        ? `Session ${s.startsAt.toISOString().slice(0, 10)} ended with no attendance recorded`
        : `Session ${s.startsAt.toISOString().slice(0, 10)}: ${attended.length - unsigned} of ${attended.length} attendee notes signed`,
      clientId: null,
      clientName: null,
      priority: late ? 'urgent' : 'high',
      since: s.endsAt.toISOString(),
      href: groupSessionHref(s.group.kind, s.id),
      hrefLabel: noAttendance ? 'Take attendance' : 'Open group notes',
      action: null,
    });
  }
  return out;
}

/** Group session page for notes written from a group (the plain notes page is caseload scoped). */
export async function groupNoteHrefs(noteIds: string[]): Promise<Map<string, string>> {
  if (!noteIds.length) return new Map();
  try {
    const rows = await prisma.clinicalGroupAttendance.findMany({
      where: { progressNoteId: { in: noteIds } },
      select: { progressNoteId: true, sessionId: true, session: { select: { group: { select: { kind: true } } } } },
    });
    return new Map(rows.map((r) => [r.progressNoteId!, groupSessionHref(r.session.group.kind, r.sessionId)]));
  } catch {
    return new Map();
  }
}
