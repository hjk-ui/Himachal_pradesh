import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { getAppBaseUrl } from '@/lib/app/baseUrl';
import { sendEmail } from '@/lib/mail/sendEmail';
import { formatWhen } from '@/lib/telehealth/email';
import { createChimeAttendee, createChimeGroupMeeting, deleteChimeAttendee, deleteChimeMeeting } from '@/lib/telehealth/chime';
import { consentOnFile } from '@/lib/consents/onFile';
import { lockedSensitiveClientIds } from '@/lib/privacy/sensitiveAccess';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { toPracticeWallTime } from '@/lib/time/practiceTime';
import { PROTECTED_MEMBER_LABEL } from './access';
import { isPart2Group } from './rules';
import type { GroupActor } from './store';
import {
  applyHeartbeat,
  applyJoin,
  applyLeave,
  canRunGroupVideo,
  defaultNameDisplay,
  disambiguateLabels,
  groupInviteMessage,
  isConnectedNow,
  isNameDisplayMode,
  linkChannels,
  memberDisplayName,
  memberMayEnter,
  minutesInRoom,
  roomCapacity,
  staffDisplayName,
  type NameDisplayMode,
  type Presence,
  type PresenceEvent,
} from './video';
import { createGroupJoinToken, groupTokenExpiry, readGroupJoinToken } from './videoToken';

/**
 * Group telehealth data access (see src/lib/groups/video.ts for the rules). Staff functions take the
 * signed-in actor and require canRunGroupVideo (session facilitators or leadership). Member
 * functions take the member's personal join token only. Routes write the audit rows.
 */

type Fail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });

type RoomRow = Prisma.ClinicalGroupVideoRoomGetPayload<object>;
type PartRow = Prisma.ClinicalGroupVideoParticipantGetPayload<object>;

const dateOnly = (s: string) => new Date(`${s}T00:00:00.000Z`);

function presenceOf(p: PartRow): Presence {
  return {
    connected: p.connected,
    lastSeenAt: p.lastSeenAt,
    firstJoinedAt: p.firstJoinedAt,
    lastJoinedAt: p.lastJoinedAt,
    totalSeconds: p.totalSeconds,
    joinCount: p.joinCount,
    events: Array.isArray(p.events) ? (p.events as unknown as PresenceEvent[]) : [],
  };
}

function presenceData(p: Presence) {
  return {
    connected: p.connected,
    lastSeenAt: p.lastSeenAt,
    firstJoinedAt: p.firstJoinedAt,
    lastJoinedAt: p.lastJoinedAt,
    totalSeconds: p.totalSeconds,
    joinCount: p.joinCount,
    events: p.events as unknown as Prisma.InputJsonValue,
  };
}

async function loadSessionCtx(organizationId: string, sessionId: string) {
  const s = await prisma.clinicalGroupSession.findFirst({ where: { id: sessionId, organizationId }, include: { group: true } });
  if (!s) return null;
  const room = await prisma.clinicalGroupVideoRoom.findUnique({ where: { sessionId } });
  return { s, room };
}

type SessionCtx = NonNullable<Awaited<ReturnType<typeof loadSessionCtx>>>;

async function sessionWall(s: SessionCtx['s']) {
  const tz = await getPracticeTimeZone(s.organizationId);
  return { tz, ...toPracticeWallTime(s.startsAt, tz) };
}

/** Active members on the session date (same window as the attendance roster). */
async function activeRoster(s: SessionCtx['s'], sessionDate: string) {
  return prisma.clinicalGroupMember.findMany({
    where: {
      groupId: s.groupId,
      status: 'active',
      joinedOn: { lte: dateOnly(sessionDate) },
      OR: [{ leftOn: null }, { leftOn: { gte: dateOnly(sessionDate) } }],
    },
    select: { id: true, clientId: true },
  });
}

/** Create a participant row (and so a personal link) for each active member who has none yet. */
async function syncMembers(room: RoomRow, s: SessionCtx['s'], sessionDate: string) {
  const roster = await activeRoster(s, sessionDate);
  const existing = await prisma.clinicalGroupVideoParticipant.findMany({ where: { roomId: room.id, kind: 'member' }, select: { clientId: true } });
  const have = new Set(existing.map((e) => e.clientId));
  const missing = roster.filter((m) => !have.has(m.clientId));
  if (missing.length) {
    await prisma.clinicalGroupVideoParticipant.createMany({
      data: missing.map((m) => ({ organizationId: room.organizationId, roomId: room.id, sessionId: s.id, kind: 'member', clientId: m.clientId, memberId: m.id, state: 'invited' })),
      skipDuplicates: true,
    });
  }
  return roster;
}

function staffRole(userId: string, s: SessionCtx['s']): 'facilitator' | 'co-facilitator' | 'staff' {
  if (userId === (s.facilitatorId ?? s.group.facilitatorId)) return 'facilitator';
  if (userId === (s.coFacilitatorId ?? s.group.coFacilitatorId)) return 'co-facilitator';
  return 'staff';
}

/** externalUserId → tile label (what everyone in the room sees). Opaque ids only in Chime. */
async function roomLabels(room: RoomRow, s: SessionCtx['s'], parts?: PartRow[]) {
  const rows = parts ?? (await prisma.clinicalGroupVideoParticipant.findMany({ where: { roomId: room.id } }));
  const clientIds = rows.map((p) => p.clientId).filter((x): x is string => Boolean(x));
  const userIds = rows.map((p) => p.userId).filter((x): x is string => Boolean(x));
  const [clients, users] = await Promise.all([
    clientIds.length
      ? prisma.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, name: true, preferredName: true, legalFirstName: true, legalLastName: true } })
      : Promise.resolve([]),
    userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }) : Promise.resolve([]),
  ]);
  const cMap = new Map(clients.map((c) => [c.id, c]));
  const uMap = new Map(users.map((u) => [u.id, u]));
  const mode: NameDisplayMode = isNameDisplayMode(room.nameDisplay) ? room.nameDisplay : 'first_only';
  const labelled = disambiguateLabels(
    rows.map((p) => ({
      participantId: p.id,
      externalUserId: p.externalUserId ?? (p.kind === 'staff' ? `s-${p.id}` : `m-${p.id}`),
      label:
        p.kind === 'staff'
          ? staffDisplayName(uMap.get(p.userId ?? '')?.name || 'Staff', staffRole(p.userId ?? '', s))
          : memberDisplayName(cMap.get(p.clientId ?? '') ?? {}, mode),
    }))
  );
  const byExternal: Record<string, string> = {};
  const byParticipant = new Map<string, string>();
  for (const l of labelled) {
    byExternal[l.externalUserId] = l.label;
    byParticipant.set(l.participantId, l.label);
  }
  return { byExternal, byParticipant };
}

/** Attendee on the room's meeting; a Chime meeting that ended on its own (idle) is recreated once. */
async function attendeeFor(room: RoomRow, externalUserId: string): Promise<{ room: RoomRow; attendee: Record<string, unknown>; demoMode: boolean }> {
  if (room.chimeMeetingId) {
    try {
      const a = await createChimeAttendee({ meetingId: room.chimeMeetingId, externalUserId });
      return { room, attendee: a.attendee, demoMode: a.demoMode };
    } catch (err) {
      console.warn('[group-video] attendee on stored meeting failed, recreating', err instanceof Error ? err.name : err);
    }
  }
  const m = await createChimeGroupMeeting({ sessionId: room.sessionId, maxAttendees: room.maxAttendees });
  const updated = await prisma.clinicalGroupVideoRoom.update({
    where: { id: room.id },
    data: { chimeMeetingId: m.meetingId, chimeMeeting: m.meeting as Prisma.InputJsonValue, demoMode: m.demoMode },
  });
  const a = await createChimeAttendee({ meetingId: m.meetingId, externalUserId });
  return { room: updated, attendee: a.attendee, demoMode: a.demoMode };
}

function joinUrlFor(participantId: string, exp: number) {
  return `${getAppBaseUrl()}/telehealth/join/g/${encodeURIComponent(createGroupJoinToken({ participantId, exp }))}`;
}

async function connectedCount(roomId: string, now: Date) {
  const rows = await prisma.clinicalGroupVideoParticipant.findMany({ where: { roomId, connected: true }, select: { connected: true, lastSeenAt: true } });
  return rows.filter((r) => isConnectedNow(r, now)).length;
}

// ─── Staff ───────────────────────────────────────────────────────────────────

async function staffCtx(actor: GroupActor, sessionId: string) {
  const ctx = await loadSessionCtx(actor.organizationId, sessionId);
  if (!ctx) return fail(404, 'Session not found');
  if (!canRunGroupVideo({ role: actor.role, userId: actor.userId, session: ctx.s, group: ctx.s.group })) {
    return fail(403, 'Only this session’s facilitators or leadership can run the video room.');
  }
  return { ok: true as const, ...ctx };
}

export type VideoRosterRow = {
  participantId: string;
  kind: 'member' | 'staff';
  clientId: string | null;
  /** Staff-facing name (full name, or "Protected record") */
  displayName: string;
  /** What others in the room see */
  videoLabel: string;
  state: string;
  connected: boolean;
  minutes: number;
  joinCount: number;
  firstJoinedAt: string | null;
  checkedInAt: string | null;
  locationType: 'home' | 'other' | null;
  linkSent: boolean;
  muteRequested: boolean;
};

export async function getVideoState(actor: GroupActor, sessionId: string) {
  const c = await staffCtx(actor, sessionId);
  if (c.ok === false) return c;
  const { s, room } = c;
  const part2 = s.part2 || isPart2Group(s.group.kind);
  if (!room) {
    return {
      ok: true as const,
      room: null,
      roster: [] as VideoRosterRow[],
      defaultNameDisplay: defaultNameDisplay({ kind: s.group.kind, part2 }),
      part2,
      telehealth: s.telehealth,
      patientIds: [] as string[],
    };
  }
  const wall = await sessionWall(s);
  if (room.status === 'open') await syncMembers(room, s, wall.date);
  const parts = await prisma.clinicalGroupVideoParticipant.findMany({ where: { roomId: room.id }, orderBy: { createdAt: 'asc' } });
  const labels = await roomLabels(room, s, parts);
  const clientIds = parts.map((p) => p.clientId).filter((x): x is string => Boolean(x));
  const [clients, locked] = await Promise.all([
    prisma.client.findMany({ where: { id: { in: clientIds }, organizationId: actor.organizationId }, select: { id: true, name: true } }),
    lockedSensitiveClientIds({ organizationId: actor.organizationId, userId: actor.userId, role: actor.role, clientIds }),
  ]);
  const names = new Map(clients.map((x) => [x.id, x.name]));
  const now = new Date();
  const roster: VideoRosterRow[] = parts.map((p) => {
    const videoLabel = labels.byParticipant.get(p.id) ?? 'Participant';
    const hidden = p.clientId ? locked.has(p.clientId) : false;
    return {
      participantId: p.id,
      kind: p.kind === 'staff' ? 'staff' : 'member',
      clientId: hidden ? null : p.clientId,
      displayName: p.kind === 'staff' ? videoLabel : hidden ? PROTECTED_MEMBER_LABEL : names.get(p.clientId ?? '') ?? videoLabel,
      videoLabel,
      state: p.state,
      connected: isConnectedNow(p, now),
      minutes: minutesInRoom(p.totalSeconds),
      joinCount: p.joinCount,
      firstJoinedAt: p.firstJoinedAt?.toISOString() ?? null,
      checkedInAt: p.checkedInAt?.toISOString() ?? null,
      locationType: p.locationType === 'home' || p.locationType === 'other' ? p.locationType : null,
      linkSent: Boolean(p.linkEmailedAt || p.linkPortalAt),
      muteRequested: Boolean(p.muteRequestedAt && (!p.muteAckAt || p.muteAckAt < p.muteRequestedAt)),
    };
  });
  return {
    ok: true as const,
    room: {
      id: room.id,
      status: room.status,
      nameDisplay: room.nameDisplay,
      maxAttendees: room.maxAttendees,
      demoMode: room.demoMode,
      startedAt: room.startedAt.toISOString(),
      endedAt: room.endedAt?.toISOString() ?? null,
    },
    roster,
    defaultNameDisplay: defaultNameDisplay({ kind: s.group.kind, part2 }),
    part2,
    telehealth: s.telehealth,
    patientIds: roster.map((r) => r.clientId).filter((x): x is string => Boolean(x)),
  };
}

export async function startRoom(actor: GroupActor, sessionId: string) {
  const c = await staffCtx(actor, sessionId);
  if (c.ok === false) return c;
  const { s } = c;
  if (s.status === 'cancelled' || s.status === 'completed') return fail(409, 'This session is closed.');
  if (!s.telehealth) return fail(409, 'This session is not a telehealth session.');
  const wall = await sessionWall(s);
  const roster = await activeRoster(s, wall.date);
  const cap = roomCapacity(roster.length, 2);
  const part2 = s.part2 || isPart2Group(s.group.kind);
  if (c.room && c.room.status === 'open') return { ok: true as const, roomId: c.room.id, reused: true, memberCount: roster.length };
  const m = await createChimeGroupMeeting({ sessionId: s.id, maxAttendees: cap });
  const data = {
    chimeMeetingId: m.meetingId,
    chimeMeeting: m.meeting as Prisma.InputJsonValue,
    demoMode: m.demoMode,
    status: 'open',
    maxAttendees: cap,
    startedById: actor.userId,
    startedAt: new Date(),
    endedAt: null,
    endedById: null,
  };
  const room = c.room
    ? await prisma.clinicalGroupVideoRoom.update({ where: { id: c.room.id }, data })
    : await prisma.clinicalGroupVideoRoom.create({
        data: { organizationId: actor.organizationId, sessionId: s.id, groupId: s.groupId, nameDisplay: defaultNameDisplay({ kind: s.group.kind, part2 }), ...data },
      });
  if (c.room) {
    // Reopened: everyone goes back through the waiting room (removed stays removed)
    await prisma.clinicalGroupVideoParticipant.updateMany({ where: { roomId: room.id, state: { not: 'removed' }, kind: 'member' }, data: { state: 'invited', connected: false, chimeAttendeeId: null } });
  }
  await syncMembers(room, s, wall.date);
  if (s.status === 'scheduled') await prisma.clinicalGroupSession.update({ where: { id: s.id }, data: { status: 'in_progress' } });
  return { ok: true as const, roomId: room.id, reused: false, memberCount: roster.length };
}

async function openRoomCtx(actor: GroupActor, sessionId: string) {
  const c = await staffCtx(actor, sessionId);
  if (c.ok === false) return c;
  if (!c.room || c.room.status !== 'open') return fail(409, 'Start the video room first.');
  return { ...c, room: c.room };
}

/** Facilitator / co-facilitator joins as host. */
export async function hostJoin(actor: GroupActor, sessionId: string) {
  const c = await openRoomCtx(actor, sessionId);
  if (c.ok === false) return c;
  const now = new Date();
  let part = await prisma.clinicalGroupVideoParticipant.findFirst({ where: { roomId: c.room.id, userId: actor.userId } });
  if (!part) {
    part = await prisma.clinicalGroupVideoParticipant.create({
      data: { organizationId: actor.organizationId, roomId: c.room.id, sessionId, kind: 'staff', userId: actor.userId, state: 'admitted', admittedAt: now },
    });
  }
  const externalUserId = `s-${part.id}`;
  const { room, attendee, demoMode } = await attendeeFor(c.room, externalUserId);
  const presence = applyJoin(presenceOf(part), now);
  await prisma.clinicalGroupVideoParticipant.update({
    where: { id: part.id },
    data: { externalUserId, chimeAttendeeId: String(attendee.AttendeeId ?? ''), state: 'admitted', ...presenceData(presence) },
  });
  const labels = await roomLabels(room, c.s);
  return { ok: true as const, meetingId: room.chimeMeetingId, meeting: room.chimeMeeting as Record<string, unknown>, attendee, demoMode, labels: labels.byExternal, selfExternalUserId: externalUserId };
}

export async function hostPresence(actor: GroupActor, sessionId: string, leave: boolean) {
  const ctx = await loadSessionCtx(actor.organizationId, sessionId);
  if (!ctx?.room) return fail(404, 'No video room');
  const part = await prisma.clinicalGroupVideoParticipant.findFirst({ where: { roomId: ctx.room.id, userId: actor.userId } });
  if (!part) return fail(404, 'Not in this room');
  const now = new Date();
  const p = leave ? applyLeave(presenceOf(part), now) : applyHeartbeat(presenceOf(part), now);
  await prisma.clinicalGroupVideoParticipant.update({ where: { id: part.id }, data: presenceData(p) });
  const labels = await roomLabels(ctx.room, ctx.s);
  return { ok: true as const, labels: labels.byExternal, roomOpen: ctx.room.status === 'open' };
}

export async function admit(actor: GroupActor, sessionId: string, participantId: string | 'all') {
  const c = await openRoomCtx(actor, sessionId);
  if (c.ok === false) return c;
  const where: Prisma.ClinicalGroupVideoParticipantWhereInput =
    participantId === 'all'
      ? { roomId: c.room.id, kind: 'member', state: 'waiting' }
      : { roomId: c.room.id, kind: 'member', id: participantId, state: { in: ['waiting', 'invited', 'left'] } };
  const rows = await prisma.clinicalGroupVideoParticipant.findMany({ where, select: { id: true, clientId: true } });
  if (!rows.length) return participantId === 'all' ? { ok: true as const, admitted: 0, patientIds: [] as string[] } : fail(404, 'That participant is not waiting.');
  await prisma.clinicalGroupVideoParticipant.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { state: 'admitted', admittedAt: new Date(), admittedById: actor.userId } });
  return { ok: true as const, admitted: rows.length, patientIds: rows.map((r) => r.clientId).filter((x): x is string => Boolean(x)) };
}

export async function requestMute(actor: GroupActor, sessionId: string, participantId: string) {
  const c = await openRoomCtx(actor, sessionId);
  if (c.ok === false) return c;
  const part = await prisma.clinicalGroupVideoParticipant.findFirst({ where: { id: participantId, roomId: c.room.id } });
  if (!part) return fail(404, 'Participant not found');
  await prisma.clinicalGroupVideoParticipant.update({ where: { id: part.id }, data: { muteRequestedAt: new Date() } });
  return { ok: true as const, patientIds: part.clientId ? [part.clientId] : [] };
}

export async function removeParticipant(actor: GroupActor, sessionId: string, participantId: string) {
  const c = await openRoomCtx(actor, sessionId);
  if (c.ok === false) return c;
  const part = await prisma.clinicalGroupVideoParticipant.findFirst({ where: { id: participantId, roomId: c.room.id, kind: 'member' } });
  if (!part) return fail(404, 'Participant not found');
  if (c.room.chimeMeetingId && part.chimeAttendeeId) await deleteChimeAttendee(c.room.chimeMeetingId, part.chimeAttendeeId);
  const p = applyLeave(presenceOf(part), new Date());
  await prisma.clinicalGroupVideoParticipant.update({
    where: { id: part.id },
    data: { ...presenceData(p), state: 'removed', removedAt: new Date(), removedById: actor.userId, chimeAttendeeId: null },
  });
  return { ok: true as const, patientIds: part.clientId ? [part.clientId] : [] };
}

export async function endRoom(actor: GroupActor, sessionId: string) {
  const c = await openRoomCtx(actor, sessionId);
  if (c.ok === false) return c;
  const now = new Date();
  const connected = await prisma.clinicalGroupVideoParticipant.findMany({ where: { roomId: c.room.id, connected: true } });
  for (const part of connected) {
    await prisma.clinicalGroupVideoParticipant.update({ where: { id: part.id }, data: presenceData(applyLeave(presenceOf(part), now)) });
  }
  await prisma.clinicalGroupVideoParticipant.updateMany({ where: { roomId: c.room.id, state: { in: ['admitted', 'waiting'] } }, data: { state: 'left' } });
  if (c.room.chimeMeetingId) await deleteChimeMeeting(c.room.chimeMeetingId);
  await prisma.clinicalGroupVideoRoom.update({ where: { id: c.room.id }, data: { status: 'ended', endedAt: now, endedById: actor.userId } });
  return { ok: true as const, closed: connected.length };
}

export async function setNameDisplay(actor: GroupActor, sessionId: string, mode: NameDisplayMode) {
  const c = await staffCtx(actor, sessionId);
  if (c.ok === false) return c;
  if (!c.room) return fail(409, 'Start the video room first.');
  await prisma.clinicalGroupVideoRoom.update({ where: { id: c.room.id }, data: { nameDisplay: mode } });
  return { ok: true as const };
}

/** "Copy link" for one member (staff sends it manually). */
export async function memberLink(actor: GroupActor, sessionId: string, participantId: string) {
  const c = await openRoomCtx(actor, sessionId);
  if (c.ok === false) return c;
  const part = await prisma.clinicalGroupVideoParticipant.findFirst({ where: { id: participantId, roomId: c.room.id, kind: 'member' } });
  if (!part) return fail(404, 'Participant not found');
  if (part.state === 'removed') return fail(409, 'This member was removed from the room.');
  const wall = await sessionWall(c.s);
  return { ok: true as const, url: joinUrlFor(part.id, groupTokenExpiry(wall.date, wall.tz)), patientIds: part.clientId ? [part.clientId] : [] };
}

/** Portal message (no caseload filter: the facilitator's group role authorizes it). Never throws. */
async function postPortalMessage(organizationId: string, clientId: string, content: string, senderName: string): Promise<boolean> {
  try {
    const now = new Date();
    let thread = await prisma.messageThread.findFirst({ where: { organizationId, clientId, proxyPortalUserId: null }, orderBy: { lastMessageAt: 'desc' }, select: { id: true } });
    if (!thread) {
      const client = await prisma.client.findFirst({ where: { id: clientId }, select: { name: true, riskLevel: true } });
      if (!client) return false;
      thread = await prisma.messageThread.create({
        data: { organizationId, clientId, clientName: client.name, topic: 'SCHEDULING', status: 'IN_PROGRESS', risk: client.riskLevel, assignedStaff: senderName, lastMessage: '', lastMessageAt: now, unreadCount: 0 },
        select: { id: true },
      });
    }
    await prisma.$transaction([
      prisma.threadMessage.create({ data: { threadId: thread.id, senderType: 'FRONT_OFFICE', senderName, content, read: false, createdAt: now } }),
      prisma.messageThread.update({ where: { id: thread.id }, data: { lastMessage: content, lastMessageAt: now, status: 'IN_PROGRESS' } }),
    ]);
    return true;
  } catch (err) {
    console.warn('[group-video] portal message failed', err instanceof Error ? err.name : err);
    return false;
  }
}

/** "Send links": email + portal message to active members with telehealth consent on file. Counts only. */
export async function sendLinks(actor: GroupActor, sessionId: string) {
  const c = await openRoomCtx(actor, sessionId);
  if (c.ok === false) return c;
  const wall = await sessionWall(c.s);
  const roster = await syncMembers(c.room, c.s, wall.date);
  const activeIds = new Set(roster.map((r) => r.clientId));
  const parts = await prisma.clinicalGroupVideoParticipant.findMany({ where: { roomId: c.room.id, kind: 'member' } });
  const clientIds = parts.map((p) => p.clientId).filter((x): x is string => Boolean(x));
  const [clients, consents] = await Promise.all([
    prisma.client.findMany({ where: { id: { in: clientIds }, organizationId: actor.organizationId }, select: { id: true, email: true, emailOptOutAt: true } }),
    prisma.consentForm.findMany({
      where: { organizationId: actor.organizationId, clientId: { in: clientIds } },
      select: { clientId: true, type: true, formKey: true, status: true, formStatus: true, expiresAt: true, revokedAt: true },
      take: 5000,
    }),
  ]);
  const cMap = new Map(clients.map((x) => [x.id, x]));
  const now = new Date();
  const exp = groupTokenExpiry(wall.date, wall.tz);
  const when = formatWhen(wall.date, wall.time, wall.tz);
  const counts = { emailed: 0, portal: 0, skipped: 0, emailFailed: 0, reasons: {} as Record<string, number> };
  const touched: string[] = [];
  const bump = (r: string) => (counts.reasons[r] = (counts.reasons[r] ?? 0) + 1);
  for (const p of parts) {
    const client = cMap.get(p.clientId ?? '');
    const rows = consents.filter((r) => r.clientId === p.clientId);
    const gate = linkChannels({
      memberActive: Boolean(client) && activeIds.has(p.clientId ?? ''),
      removed: p.state === 'removed',
      telehealthConsentOnFile: consentOnFile(rows, 'telehealth-consent', /telehealth/i, now),
      email: client?.email,
      emailOptOutAt: client?.emailOptOutAt,
    });
    if (gate.ok === false) {
      counts.skipped++;
      bump(gate.reason);
      continue;
    }
    const msg = groupInviteMessage({ when, joinUrl: joinUrlFor(p.id, exp) });
    const data: Prisma.ClinicalGroupVideoParticipantUpdateInput = {};
    if (gate.channels.email && client?.email) {
      try {
        await sendEmail({ to: client.email.trim(), subject: msg.subject, text: msg.text, html: msg.html, context: 'group-telehealth-link' });
        counts.emailed++;
        data.linkEmailedAt = now;
      } catch {
        counts.emailFailed++;
      }
    } else if (gate.channels.emailSkip) bump(gate.channels.emailSkip);
    if (await postPortalMessage(actor.organizationId, p.clientId!, msg.portal, 'Clinic')) {
      counts.portal++;
      data.linkPortalAt = now;
    }
    if (Object.keys(data).length) await prisma.clinicalGroupVideoParticipant.update({ where: { id: p.id }, data });
    touched.push(p.clientId!);
  }
  return { ok: true as const, ...counts, patientIds: touched };
}

/** Video data for the Attendance step prefill (clientId → joined / minutes / location). */
export async function videoAttendance(actor: GroupActor, sessionId: string) {
  const c = await staffCtx(actor, sessionId);
  if (c.ok === false) return c;
  if (!c.room) return { ok: true as const, roomEnded: false, hasRoom: false, rows: [] };
  const parts = await prisma.clinicalGroupVideoParticipant.findMany({ where: { roomId: c.room.id, kind: 'member' } });
  return {
    ok: true as const,
    hasRoom: true,
    roomEnded: c.room.status === 'ended',
    rows: parts
      .filter((p) => p.clientId)
      .map((p) => ({
        clientId: p.clientId!,
        joined: p.joinCount > 0,
        minutes: minutesInRoom(p.totalSeconds),
        locationType: p.locationType === 'home' || p.locationType === 'other' ? (p.locationType as 'home' | 'other') : null,
      })),
  };
}

// ─── Member (personal join link) ─────────────────────────────────────────────

async function loadByToken(token: string) {
  const payload = readGroupJoinToken(token);
  if (!payload) return fail(401, 'Invalid or expired link');
  const part = await prisma.clinicalGroupVideoParticipant.findUnique({ where: { id: payload.participantId } });
  if (!part || part.kind !== 'member' || !part.clientId) return fail(401, 'Invalid or expired link');
  if (part.state === 'removed') return fail(403, 'This link is no longer active. Contact the clinic.');
  const room = await prisma.clinicalGroupVideoRoom.findUnique({ where: { id: part.roomId } });
  if (!room) return fail(401, 'Invalid or expired link');
  const s = await prisma.clinicalGroupSession.findFirst({ where: { id: room.sessionId }, include: { group: true } });
  if (!s || s.status === 'cancelled') return fail(410, 'This session was cancelled');
  return { ok: true as const, part, room, s };
}

export type MemberCtx = Extract<Awaited<ReturnType<typeof loadByToken>>, { ok: true }>;

async function memberView(ctx: MemberCtx) {
  const wall = await sessionWall(ctx.s);
  const labels = await roomLabels(ctx.room, ctx.s);
  const muteRequested = Boolean(ctx.part.muteRequestedAt && (!ctx.part.muteAckAt || ctx.part.muteAckAt < ctx.part.muteRequestedAt));
  return {
    // Deliberately no group name, program, facilitator full name or other members' records
    date: wall.date,
    startTime: wall.time,
    timeZone: wall.tz,
    durationMinutes: ctx.s.durationMinutes,
    myLabel: labels.byParticipant.get(ctx.part.id) ?? 'You',
    state: ctx.part.state,
    checkedIn: Boolean(ctx.part.checkedInAt),
    roomOpen: ctx.room.status === 'open',
    canEnter: memberMayEnter(ctx.part.state, ctx.room.status),
    muteRequested,
    labels: labels.byExternal,
  };
}

export async function memberStatus(token: string) {
  const ctx = await loadByToken(token);
  if (ctx.ok === false) return ctx;
  return { ok: true as const, ctx, view: await memberView(ctx) };
}

/** Check-in: consent + where the member is (home / other + state). Puts them in the waiting room. */
export async function memberCheckIn(token: string, input: { locationType: 'home' | 'other'; locationState: string }) {
  const ctx = await loadByToken(token);
  if (ctx.ok === false) return ctx;
  if (ctx.room.status !== 'open') return fail(409, 'The session room is not open yet. Try again closer to the start time.');
  const now = new Date();
  const nextState = ctx.part.state === 'invited' ? 'waiting' : ctx.part.state;
  const part = await prisma.clinicalGroupVideoParticipant.update({
    where: { id: ctx.part.id },
    data: { locationType: input.locationType, locationState: input.locationState, consentAt: now, checkedInAt: now, state: nextState },
  });
  const next = { ...ctx, part };
  return { ok: true as const, ctx: next, view: await memberView(next) };
}

export async function memberJoin(token: string) {
  const ctx = await loadByToken(token);
  if (ctx.ok === false) return ctx;
  if (!ctx.part.checkedInAt) return fail(409, 'Check in first.');
  if (!memberMayEnter(ctx.part.state, ctx.room.status)) {
    return fail(409, ctx.room.status === 'open' ? 'Please wait. The facilitator will let you in.' : 'The session has ended.');
  }
  const now = new Date();
  if (!isConnectedNow(ctx.part, now) && (await connectedCount(ctx.room.id, now)) >= ctx.room.maxAttendees) {
    return fail(409, 'The room is full. Contact the clinic.');
  }
  const externalUserId = `m-${ctx.part.id}`;
  const { room, attendee, demoMode } = await attendeeFor(ctx.room, externalUserId);
  const presence = applyJoin(presenceOf(ctx.part), now);
  const part = await prisma.clinicalGroupVideoParticipant.update({
    where: { id: ctx.part.id },
    data: { externalUserId, chimeAttendeeId: String(attendee.AttendeeId ?? ''), state: 'admitted', ...presenceData(presence) },
  });
  const next = { ...ctx, room, part };
  return {
    ok: true as const,
    ctx: next,
    view: await memberView(next),
    chime: { meetingId: room.chimeMeetingId, meeting: room.chimeMeeting as Record<string, unknown>, attendee, demoMode, selfExternalUserId: externalUserId },
  };
}

export async function memberPresence(token: string, input: { leave?: boolean; ackMute?: boolean }) {
  const ctx = await loadByToken(token);
  if (ctx.ok === false) return ctx;
  const now = new Date();
  // Minutes count only while admitted into an open room (never in the waiting room)
  const inCall = ctx.part.state === 'admitted' && ctx.room.status === 'open';
  const p = input.leave || !inCall ? applyLeave(presenceOf(ctx.part), now) : applyHeartbeat(presenceOf(ctx.part), now);
  const part = await prisma.clinicalGroupVideoParticipant.update({
    where: { id: ctx.part.id },
    data: { ...presenceData(p), ...(input.ackMute ? { muteAckAt: now } : {}), ...(input.leave && ctx.part.state === 'admitted' ? { state: 'left' } : {}) },
  });
  const next = { ...ctx, part };
  return { ok: true as const, ctx: next, view: await memberView(next) };
}
