import type { Prisma, Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere, canAccessClientMessages } from '@/lib/clients/orgScope';
import { resolveSensitiveAccessMap } from '@/lib/privacy/sensitiveAccess';
import { countsTowardNotes, isNoNoteVisit, selectPrimaryAction, TODAY_ACTION_LABELS } from './actions';
import { practiceDayRange } from './day';
import {
  TODAY_VISIT_CAP,
  type TodayNoteStatus,
  type TodayResponse,
  type TodayVisit,
  type TodayVisitStatus,
} from './types';

const OPEN_STATUSES: TodayVisitStatus[] = ['SCHEDULED', 'CHECKED_IN', 'IN_SESSION'];

export type LoadTodayInput = {
  organizationId: string;
  userId: string;
  role: Role;
  now?: Date;
};

function isGroupAppointment(a: { type: string; createdVia: string | null }): boolean {
  return a.createdVia === 'group' || /group/i.test(a.type);
}

/**
 * Today cockpit data for the viewer.
 * Scope: viewer as clinician · current practice day · caseload via clientAccessWhere · not CANCELLED · cap 60.
 * Part 2 locked records expose no clientId, only the protected alias, and no note actions.
 */
export async function loadToday(input: LoadTodayInput): Promise<TodayResponse> {
  const now = input.now ?? new Date();
  const { day, start, end } = practiceDayRange(now);
  const clientScope = clientAccessWhere({
    organizationId: input.organizationId,
    actorUserId: input.userId,
    actorRole: input.role,
  });

  const rows = await prisma.appointment.findMany({
    where: {
      clinicianId: input.userId,
      status: { not: 'CANCELLED' },
      startsAt: { gte: start, lt: end },
      AND: [
        { OR: [{ organizationId: input.organizationId }, { organizationId: null }] },
        { client: clientScope },
      ],
    },
    orderBy: { startsAt: 'asc' },
    take: TODAY_VISIT_CAP,
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
      createdVia: true,
      client: { select: { name: true } },
    },
  });

  const clientIds = [...new Set(rows.map((r) => r.clientId))];

  const sensitive = clientIds.length
    ? await resolveSensitiveAccessMap({
        organizationId: input.organizationId,
        userId: input.userId,
        role: input.role,
        clientIds,
      })
    : new Map();
  const isLocked = (clientId: string) => {
    const s = sensitive.get(clientId);
    return Boolean(s && !s.canAccessSensitive);
  };

  const signedOpenIds = rows
    .filter((r) => r.noteStatus === 'SIGNED' && !isNoNoteVisit(r.status) && !isLocked(r.clientId))
    .map((r) => ({ id: r.id, clientId: r.clientId, endsAt: r.endsAt }));

  const followUps = await loadFollowUps(input.organizationId, signedOpenIds);
  const awaitingCosign = await loadAwaitingCosign({
    organizationId: input.organizationId,
    userId: input.userId,
    clientIds: [...new Set(signedOpenIds.map((v) => v.clientId))],
    since: start,
  });

  const visits: TodayVisit[] = rows.map((r) => {
    const locked = isLocked(r.clientId);
    const isGroup = isGroupAppointment(r);
    const clientId = locked ? null : r.clientId;
    const followUpBooked = signedOpenIds.some(
      (v) => v.id === r.id && followUps.has(`${r.clientId}:${r.id}`)
    );
    const primaryAction = selectPrimaryAction({
      appointmentId: r.id,
      clientId,
      status: r.status,
      noteStatus: r.noteStatus as TodayNoteStatus,
      dos: day,
      isVirtual: r.isVirtual,
      isGroup: locked ? false : isGroup,
      protectedLocked: locked,
      followUpBooked,
      awaitingCosign: awaitingCosign.has(r.clientId),
    });
    return {
      id: r.id,
      clientId,
      clientName: locked
        ? sensitive.get(r.clientId)?.alias?.trim() || TODAY_ACTION_LABELS.protected
        : r.clientName?.trim() || r.client.name,
      type: locked ? null : r.type,
      startsAt: r.startsAt.toISOString(),
      endsAt: r.endsAt.toISOString(),
      status: r.status,
      noteStatus: r.noteStatus as TodayNoteStatus,
      isVirtual: r.isVirtual,
      isGroup: locked ? false : isGroup,
      isProtected: locked,
      primaryAction,
    };
  });

  const nowMs = now.getTime();
  const next = visits.find(
    (v) => OPEN_STATUSES.includes(v.status) && new Date(v.endsAt).getTime() >= nowMs
  );

  const counted = visits.filter((v) => countsTowardNotes(v.status));
  const notes = {
    total: counted.length,
    done: counted.filter((v) => v.noteStatus === 'SIGNED').length,
  };

  return {
    success: true,
    day,
    visits,
    nextVisitId: next?.id ?? null,
    notes,
    inbox: await loadInbox(input, clientScope),
  };
}

/** Keys `${clientId}:${appointmentId}` for signed visits that have a later live visit. */
async function loadFollowUps(
  organizationId: string,
  signed: { id: string; clientId: string; endsAt: Date }[]
): Promise<Set<string>> {
  const out = new Set<string>();
  if (!signed.length) return out;
  const earliestEnd = new Date(Math.min(...signed.map((v) => v.endsAt.getTime())));
  const later = await prisma.appointment.findMany({
    where: {
      clientId: { in: [...new Set(signed.map((v) => v.clientId))] },
      status: { in: OPEN_STATUSES },
      startsAt: { gt: earliestEnd },
      OR: [{ organizationId }, { organizationId: null }],
    },
    select: { id: true, clientId: true, startsAt: true },
    take: 500,
  });
  for (const v of signed) {
    if (later.some((a) => a.clientId === v.clientId && a.id !== v.id && a.startsAt > v.endsAt)) {
      out.add(`${v.clientId}:${v.id}`);
    }
  }
  return out;
}

/**
 * Client ids whose latest note by the viewer is signed but not co-signed, when the viewer is a
 * supervisee (same SupervisionTrack + `note-cosign:{noteId}` state the notes API uses).
 */
async function loadAwaitingCosign(input: {
  organizationId: string;
  userId: string;
  clientIds: string[];
  since: Date;
}): Promise<Set<string>> {
  const out = new Set<string>();
  if (!input.clientIds.length) return out;
  const track = await prisma.supervisionTrack.findUnique({
    where: {
      organizationId_superviseeId: { organizationId: input.organizationId, superviseeId: input.userId },
    },
    select: { id: true },
  });
  if (!track) return out;

  const notes = await prisma.progressNote.findMany({
    where: {
      clinicianId: input.userId,
      clientId: { in: input.clientIds },
      dismissedAt: null,
      createdAt: { gte: input.since },
      workflow: { is: { status: { in: ['SIGNED', 'LOCKED'] } } },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, clientId: true },
    take: 200,
  });
  if (!notes.length) return out;

  const cosigned = await prisma.clinicModuleState.findMany({
    where: {
      organizationId: input.organizationId,
      module: { in: notes.map((n) => `note-cosign:${n.id}`) },
    },
    select: { module: true },
  });
  const cosignedModules = new Set(cosigned.map((c) => c.module));
  const seen = new Set<string>();
  for (const n of notes) {
    if (seen.has(n.clientId)) continue; // latest note per client only
    seen.add(n.clientId);
    if (!cosignedModules.has(`note-cosign:${n.id}`)) out.add(n.clientId);
  }
  return out;
}

async function loadInbox(
  input: LoadTodayInput,
  clientScope: Prisma.ClientWhereInput
): Promise<{ unread: number } | null> {
  if (!canAccessClientMessages(input.role)) return null;
  try {
    const unread = await prisma.message.count({
      where: {
        sender: 'CLIENT',
        readAt: null,
        // Protected (Part 2) clients never feed the cockpit count.
        client: { AND: [clientScope, { sensitiveRecord: { is: null } }] },
      },
    });
    return { unread };
  } catch (err) {
    console.error('[today inbox]', err);
    return null;
  }
}
