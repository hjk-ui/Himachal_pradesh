import 'server-only';
/**
 * GET /api/dashboard/today loader: the clinician's own visits today with their documentation light,
 * one primary action each, notes-done progress and the inbox to-do count, in one read.
 * Caseload scope: todayAppointmentWhere (clientAccessWhere). Protected records (42 CFR Part 2 /
 * sensitive access) show the alias only, with no chart link and no note actions.
 */
import { prisma } from '@/lib/db/prisma';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { lockedSensitiveClientIds } from '@/lib/privacy/sensitiveAccess';
import { loadAppointmentNoteSummaries } from '@/lib/analytics/visitDocumentationServer';
import { deriveDocLight, EMPTY_NOTE_SUMMARY } from '@/lib/appointments/docLight';
import { practiceNoteSignDeadlineHours } from '@/lib/practice/consumers';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { toPracticeWallTime } from '@/lib/time/practiceTime';
import { loadNoteSignReadiness } from '@/lib/notes/worklist';
import { INBOX_DEPS, loadAllSections } from '@/lib/inbox/service';
import { summarizeInbox } from '@/lib/inbox/core';
import { practiceTodayBounds } from './practiceDay';
import { DB_TO_SCHEDULE_STATUS, PROTECTED_CLIENT_DISPLAY } from './todaySchedule';
import { todayAppointmentWhere, type TodayViewer } from './todayScope';
import { nextTodayVisitId, todayNotesProgress, type TodayPanelData, type TodayVisit } from './today';

const MAX_VISITS = 60;

async function inboxToDo(viewer: TodayViewer, now: Date): Promise<TodayPanelData['inbox']> {
  if (!canAccessPath(viewer.role, '/dashboard/inbox')) return null;
  try {
    // Same cached sections as the inbox badge (45 s per viewer); a slow section times out on its own
    const summary = summarizeInbox(await loadAllSections({ ...viewer, role: String(viewer.role) }, INBOX_DEPS, now), now);
    return { toDo: summary.total, urgent: summary.urgent };
  } catch {
    return null;
  }
}

export async function loadTodayPanel(viewer: TodayViewer, now = new Date()): Promise<TodayPanelData> {
  const timeZone = await getPracticeTimeZone(viewer.organizationId);
  const { ymd, start, end } = practiceTodayBounds(timeZone, now);
  const inboxP = inboxToDo(viewer, now);
  const appts = await prisma.appointment.findMany({
    where: todayAppointmentWhere(viewer, { start, end }),
    orderBy: { startsAt: 'asc' },
    take: MAX_VISITS,
    select: {
      id: true,
      clientId: true,
      clientName: true,
      type: true,
      startsAt: true,
      endsAt: true,
      status: true,
      noteStatus: true,
      isVirtual: true,
      groupSessionId: true,
      client: { select: { name: true, sensitiveRecord: { select: { alias: true } } } },
    },
  });
  const ids = appts.map((a) => a.id);
  const clientIds = [...new Set(appts.map((a) => a.clientId))];
  const sensitiveIds = [...new Set(appts.filter((a) => a.client.sensitiveRecord).map((a) => a.clientId))];
  const [locked, summaries, deadlineHours, future] = await Promise.all([
    sensitiveIds.length
      ? lockedSensitiveClientIds({ organizationId: viewer.organizationId, userId: viewer.userId, role: viewer.role, clientIds: sensitiveIds }).catch(() => new Set(sensitiveIds))
      : Promise.resolve(new Set<string>()),
    loadAppointmentNoteSummaries(ids),
    practiceNoteSignDeadlineHours(viewer.organizationId),
    clientIds.length
      ? prisma.appointment.findMany({
          where: { clientId: { in: clientIds }, startsAt: { gte: end }, status: { in: ['SCHEDULED', 'CHECKED_IN'] } },
          select: { clientId: true },
          distinct: ['clientId'],
        })
      : Promise.resolve([] as { clientId: string }[]),
  ]);
  const booked = new Set(future.map((f) => f.clientId));

  // Inline "Sign" only when the newest draft has nothing blocking it (one check per draft, today only)
  const draftIds = appts
    .filter((a) => !locked.has(a.clientId))
    .map((a) => summaries.get(a.id)?.draftNoteIds[0])
    .filter((x): x is string => Boolean(x));
  const readiness = new Map(
    (
      await Promise.all(
        draftIds.map((noteId) => loadNoteSignReadiness({ organizationId: viewer.organizationId, actorUserId: viewer.userId, noteId, now }).catch(() => null))
      )
    )
      .filter((r): r is NonNullable<typeof r> => Boolean(r))
      .map((r) => [r.noteId, r])
  );

  const visits: TodayVisit[] = [];
  for (const a of appts) {
    const status = DB_TO_SCHEDULE_STATUS[a.status];
    if (!status) continue;
    const isLocked = locked.has(a.clientId);
    const isSensitive = Boolean(a.client.sensitiveRecord);
    const sum = summaries.get(a.id);
    const storedAiDraft = a.noteStatus === 'AI_DRAFT';
    const noteStatus: TodayVisit['noteStatus'] =
      sum?.status === 'SIGNED' ? 'signed' : storedAiDraft ? 'ai-draft' : sum?.status === 'IN_PROGRESS' ? 'in-progress' : 'not-started';
    const date = toPracticeWallTime(a.startsAt, timeZone).date;
    const endTime = toPracticeWallTime(a.endsAt, timeZone).time;
    const docLight = deriveDocLight({
      status,
      date,
      endTime,
      endsAt: a.endsAt,
      notes: { ...(sum?.summary ?? EMPTY_NOTE_SUMMARY), hasNote: Boolean(sum?.summary.hasNote) || storedAiDraft },
      now,
      deadlineHours,
      timeZone,
    });
    const draftNoteId = isLocked ? null : sum?.draftNoteIds[0] ?? null;
    const r = draftNoteId ? readiness.get(draftNoteId) : undefined;
    visits.push({
      id: a.id,
      clientId: isLocked ? null : a.clientId,
      clientName: isSensitive ? a.client.sensitiveRecord?.alias?.trim() || PROTECTED_CLIENT_DISPLAY : a.clientName?.trim() || a.client.name,
      protected: isSensitive,
      type: isLocked ? 'Protected appointment' : a.type,
      startTime: toPracticeWallTime(a.startsAt, timeZone).time,
      endTime,
      startsAt: a.startsAt.toISOString(),
      endsAt: a.endsAt.toISOString(),
      status,
      noteStatus,
      isVirtual: a.isVirtual,
      groupSessionId: a.groupSessionId ?? null,
      docLight,
      draftNoteId,
      draftReady: Boolean(r?.ready),
      lateEntryRequired: Boolean(r?.lateEntryRequired),
      hasFollowUp: booked.has(a.clientId),
    });
  }

  return {
    date: ymd,
    timeZone,
    generatedAt: now.toISOString(),
    visits,
    nextVisitId: nextTodayVisitId(visits, now),
    notes: todayNotesProgress(visits),
    inbox: await inboxP,
  };
}
