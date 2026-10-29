import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { assertClientPhiAccess, lockedSensitiveClientIds, SensitiveRecordAccessError } from '@/lib/privacy/sensitiveAccess';
import { PEER_CLIENT_SELECT, peerClientWhere, type PeerActor } from './scope';
import {
  LEGACY_MODULES,
  PEER_SUPPORT_PATH,
  followUpState,
  isOpenGoal,
  isPeerLeadership,
  normalizeTopics,
  parseDateInput,
  parseLegacyList,
  parseProgressNotes,
  summarize,
  type ContactMode,
  type GoalDomain,
  type GoalStatus,
  type LegacyKind,
  type PlacementStatus,
  type PlacementType,
  type ProgressNote,
} from './workflow';

export type { PeerActor };

export class PeerError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'PeerError';
  }
}

// ─── Scoping ────────────────────────────────────────────────────────────────

const DAY = 24 * 60 * 60 * 1000;

/** In-scope client ids minus protected (Part 2 / sensitive) records this actor cannot open. */
async function dropLocked<T extends { id: string }>(actor: PeerActor, rows: T[]): Promise<T[]> {
  if (rows.length === 0) return rows;
  const locked = await lockedSensitiveClientIds({
    organizationId: actor.organizationId,
    userId: actor.actorUserId,
    role: actor.actorRole,
    clientIds: rows.map((r) => r.id),
  });
  return rows.filter((r) => !locked.has(r.id));
}

/** One client in the actor's peer scope, with the protected-record (break-glass) check. */
export async function requireClient(actor: PeerActor, clientId: string) {
  const client = await prisma.client.findFirst({
    where: { AND: [{ id: clientId }, peerClientWhere(actor)] },
    select: PEER_CLIENT_SELECT,
  });
  if (!client) throw new PeerError('Client not found in your caseload', 404);
  try {
    await assertClientPhiAccess({
      organizationId: actor.organizationId,
      userId: actor.actorUserId,
      role: actor.actorRole,
      clientId,
      path: PEER_SUPPORT_PATH,
    });
  } catch (e) {
    if (e instanceof SensitiveRecordAccessError) throw new PeerError('Protected record: break-glass access is required', 403);
    throw e;
  }
  return client;
}

/** Ids of every client whose peer records the actor may list. */
async function scopedClientIds(actor: PeerActor, clientIds?: string[]): Promise<string[]> {
  const where: Prisma.ClientWhereInput = clientIds ? { AND: [{ id: { in: clientIds } }, peerClientWhere(actor)] } : peerClientWhere(actor);
  const rows = await prisma.client.findMany({ where, select: { id: true } });
  return (await dropLocked(actor, rows)).map((r) => r.id);
}

async function actorName(actor: PeerActor) {
  const u = await prisma.user.findFirst({
    where: { id: actor.actorUserId, organizationId: actor.organizationId },
    select: { name: true, email: true },
  });
  return u?.name || u?.email || null;
}

/** Active PEER_SUPPORT staff of the org (for assignment / legacy filing). */
export async function listPeerStaff(organizationId: string) {
  const rows = await prisma.user.findMany({
    where: { organizationId, role: 'PEER_SUPPORT', status: 'ACTIVE' },
    select: { id: true, name: true, email: true },
    orderBy: { name: 'asc' },
  });
  return rows.map((r) => ({ id: r.id, name: r.name || r.email || 'Peer specialist' }));
}

const canEditRow = (actor: PeerActor, row: { peerUserId: string; createdById: string | null }) =>
  isPeerLeadership(actor.actorRole) || row.peerUserId === actor.actorUserId || row.createdById === actor.actorUserId;

// ─── Caseload ───────────────────────────────────────────────────────────────

/**
 * The page's caseload. PEER_SUPPORT: clients they are assigned to or on the care team of.
 * Other roles: clients in their scope with a peer specialist on the care team or any peer record.
 * Discharged clients drop off the caseload list (their records stay reachable).
 */
export async function getCaseload(actor: PeerActor, now = new Date()) {
  const isPeer = actor.actorRole === 'PEER_SUPPORT';
  const peers = await listPeerStaff(actor.organizationId);
  const peerIds = peers.map((p) => p.id);

  let candidateWhere: Prisma.ClientWhereInput;
  if (isPeer) {
    candidateWhere = peerClientWhere(actor);
  } else {
    const [c, g, p] = await Promise.all([
      prisma.peerContact.findMany({ where: { organizationId: actor.organizationId, voidedAt: null }, select: { clientId: true }, distinct: ['clientId'] }),
      prisma.peerGoal.findMany({ where: { organizationId: actor.organizationId }, select: { clientId: true }, distinct: ['clientId'] }),
      prisma.peerPlacement.findMany({ where: { organizationId: actor.organizationId }, select: { clientId: true }, distinct: ['clientId'] }),
    ]);
    const withRecords = [...new Set([...c, ...g, ...p].map((r) => r.clientId))];
    candidateWhere = {
      AND: [
        peerClientWhere(actor),
        {
          OR: [
            ...(peerIds.length ? [{ treatmentTeamMembers: { some: { providerId: { in: peerIds } } } }] : []),
            ...(withRecords.length ? [{ id: { in: withRecords } }] : []),
          ],
        },
      ],
    };
    if (!peerIds.length && !withRecords.length) candidateWhere = { id: { in: [] } };
  }

  const clientRows = await dropLocked(
    actor,
    await prisma.client.findMany({
      where: { AND: [candidateWhere, { status: { not: 'DISCHARGED' } }] },
      select: PEER_CLIENT_SELECT,
      orderBy: { name: 'asc' },
      take: 500,
    })
  );
  const ids = clientRows.map((c) => c.id);
  const since = new Date(Math.min(new Date(now.getFullYear(), now.getMonth(), 1).getTime(), now.getTime() - 30 * DAY));

  const [lastContacts, recentContacts, openFollowUps, goals, team] = await Promise.all([
    ids.length
      ? prisma.peerContact.groupBy({
          by: ['clientId'],
          where: { organizationId: actor.organizationId, clientId: { in: ids }, voidedAt: null },
          _max: { contactAt: true },
        })
      : Promise.resolve([]),
    ids.length
      ? prisma.peerContact.findMany({
          where: { organizationId: actor.organizationId, clientId: { in: ids }, contactAt: { gte: since } },
          select: { clientId: true, contactAt: true, voidedAt: true, followUpAt: true, followUpDoneAt: true },
        })
      : Promise.resolve([]),
    ids.length
      ? prisma.peerContact.findMany({
          where: { organizationId: actor.organizationId, clientId: { in: ids }, voidedAt: null, followUpDoneAt: null, followUpAt: { not: null } },
          select: { id: true, clientId: true, followUpAt: true, contactAt: true, mode: true, peerName: true, peerUserId: true },
          orderBy: { followUpAt: 'asc' },
          take: 500,
        })
      : Promise.resolve([]),
    ids.length
      ? prisma.peerGoal.findMany({ where: { organizationId: actor.organizationId, clientId: { in: ids } }, select: { clientId: true, status: true } })
      : Promise.resolve([]),
    ids.length && peerIds.length
      ? prisma.clientTreatmentTeamMember.findMany({
          where: { clientId: { in: ids }, providerId: { in: peerIds } },
          select: { clientId: true, providerId: true },
        })
      : Promise.resolve([]),
  ]);

  const nameById = new Map(clientRows.map((c) => [c.id, c.name]));
  const peerName = new Map(peers.map((p) => [p.id, p.name]));
  const last = new Map(lastContacts.map((r) => [r.clientId, r._max.contactAt]));
  const nextFollowUp = new Map<string, Date>();
  for (const f of openFollowUps) if (f.followUpAt && !nextFollowUp.has(f.clientId)) nextFollowUp.set(f.clientId, f.followUpAt);
  const openGoals = new Map<string, number>();
  for (const g of goals) if (isOpenGoal(g.status)) openGoals.set(g.clientId, (openGoals.get(g.clientId) ?? 0) + 1);
  const teamPeers = new Map<string, string[]>();
  const onMyTeam = new Set<string>();
  for (const t of team) {
    if (!t.providerId) continue;
    if (t.providerId === actor.actorUserId) onMyTeam.add(t.clientId);
    const list = teamPeers.get(t.clientId) ?? [];
    list.push(peerName.get(t.providerId) ?? 'Peer specialist');
    teamPeers.set(t.clientId, list);
  }

  // Summary over the full caseload (open follow-ups are not limited by date)
  const summaryContacts = [
    ...recentContacts,
    ...openFollowUps
      .filter((f) => f.contactAt < since)
      .map((f) => ({ clientId: f.clientId, contactAt: f.contactAt, voidedAt: null, followUpAt: f.followUpAt, followUpDoneAt: null })),
  ];

  return {
    clients: clientRows.map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      assignment: c.assignedToId === actor.actorUserId ? ('assigned' as const) : onMyTeam.has(c.id) ? ('care_team' as const) : null,
      peerSpecialists: teamPeers.get(c.id) ?? [],
      lastContactAt: last.get(c.id)?.toISOString() ?? null,
      nextFollowUpAt: nextFollowUp.get(c.id)?.toISOString() ?? null,
      openGoals: openGoals.get(c.id) ?? 0,
    })),
    followUps: openFollowUps
      .filter((f) => f.followUpAt && followUpState(f.followUpAt, now) !== 'upcoming')
      .map((f) => ({
        contactId: f.id,
        clientId: f.clientId,
        clientName: nameById.get(f.clientId) ?? '',
        followUpAt: f.followUpAt!.toISOString(),
        state: followUpState(f.followUpAt!, now),
        lastContactMode: f.mode,
        peerName: f.peerName,
        mine: f.peerUserId === actor.actorUserId,
      })),
    upcomingFollowUps: openFollowUps.filter((f) => f.followUpAt && followUpState(f.followUpAt, now) === 'upcoming').length,
    summary: summarize({ now, caseloadSize: clientRows.length, contacts: summaryContacts, goals }),
    peers,
    truncated: clientRows.length >= 500,
  };
}

/** Name search inside the actor's peer scope (for logging a contact / filing a legacy entry). */
export async function searchClients(actor: PeerActor, q: string) {
  const term = q.trim();
  if (term.length < 2) return [];
  const rows = await prisma.client.findMany({
    where: { AND: [peerClientWhere(actor), { name: { contains: term, mode: 'insensitive' } }] },
    select: PEER_CLIENT_SELECT,
    orderBy: { name: 'asc' },
    take: 20,
  });
  return (await dropLocked(actor, rows)).map((r) => ({ id: r.id, name: r.name, status: r.status }));
}

// ─── Contacts ───────────────────────────────────────────────────────────────

type ContactRow = Prisma.PeerContactGetPayload<object>;

function serializeContact(row: ContactRow, actor: PeerActor, clientName: string | undefined, now = new Date()) {
  return {
    id: row.id,
    clientId: row.clientId,
    clientName: clientName ?? '',
    peerUserId: row.peerUserId,
    peerName: row.peerName,
    contactAt: row.contactAt.toISOString(),
    mode: row.mode,
    durationMinutes: row.durationMinutes,
    topics: row.topics,
    goalIds: row.goalIds,
    notes: row.notes,
    followUpAt: row.followUpAt?.toISOString() ?? null,
    followUpDoneAt: row.followUpDoneAt?.toISOString() ?? null,
    followUpState: row.followUpAt && !row.followUpDoneAt ? followUpState(row.followUpAt, now) : null,
    voided: Boolean(row.voidedAt),
    voidReason: row.voidReason,
    source: row.source,
    createdAt: row.createdAt.toISOString(),
    canEdit: canEditRow(actor, row) && !row.voidedAt,
  };
}
export type PeerContactDto = ReturnType<typeof serializeContact>;

async function clientNames(ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const rows = await prisma.client.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true } });
  return new Map(rows.map((r) => [r.id, r.name]));
}

export async function listContacts(actor: PeerActor, opts: { clientId?: string | null; days?: number; includeVoided?: boolean }) {
  const ids = opts.clientId ? [(await requireClient(actor, opts.clientId)).id] : await scopedClientIds(actor);
  if (!ids.length) return [];
  const where: Prisma.PeerContactWhereInput = { organizationId: actor.organizationId, clientId: { in: ids } };
  if (!opts.includeVoided) where.voidedAt = null;
  if (opts.days) where.contactAt = { gte: new Date(Date.now() - opts.days * DAY) };
  const rows = await prisma.peerContact.findMany({ where, orderBy: { contactAt: 'desc' }, take: 300 });
  const names = await clientNames(rows.map((r) => r.clientId));
  return rows.map((r) => serializeContact(r, actor, names.get(r.clientId)));
}

export interface ContactInput {
  clientId: string;
  contactAt: Date;
  mode: ContactMode;
  durationMinutes?: number | null;
  topics?: string[];
  goalIds?: string[];
  notes?: string | null;
  followUpAt?: Date | null;
  completesFollowUpIds?: string[];
}

async function goalIdsForClient(actor: PeerActor, clientId: string, ids: string[] | undefined) {
  if (!ids?.length) return [];
  const rows = await prisma.peerGoal.findMany({
    where: { id: { in: ids }, organizationId: actor.organizationId, clientId },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export async function createContact(actor: PeerActor, input: ContactInput) {
  const client = await requireClient(actor, input.clientId);
  if (input.contactAt.getTime() > Date.now() + 60 * 60 * 1000) throw new PeerError('Contact time cannot be in the future', 400);
  if (input.followUpAt && input.followUpAt < input.contactAt) throw new PeerError('Follow-up must be after the contact', 400);
  const [name, goalIds] = await Promise.all([actorName(actor), goalIdsForClient(actor, client.id, input.goalIds)]);
  return prisma.$transaction(async (tx) => {
    const row = await tx.peerContact.create({
      data: {
        organizationId: actor.organizationId,
        clientId: client.id,
        peerUserId: actor.actorUserId,
        peerName: name,
        contactAt: input.contactAt,
        mode: input.mode,
        durationMinutes: input.durationMinutes ?? null,
        topics: normalizeTopics(input.topics),
        goalIds,
        notes: input.notes?.trim() || null,
        followUpAt: input.followUpAt ?? null,
        source: 'manual',
        createdById: actor.actorUserId,
      },
    });
    let completed = 0;
    if (input.completesFollowUpIds?.length) {
      const res = await tx.peerContact.updateMany({
        where: {
          id: { in: input.completesFollowUpIds },
          organizationId: actor.organizationId,
          clientId: client.id,
          followUpDoneAt: null,
          voidedAt: null,
        },
        data: { followUpDoneAt: new Date(), followUpDoneById: actor.actorUserId },
      });
      completed = res.count;
    }
    return { contact: serializeContact(row, actor, client.name), followUpsCompleted: completed };
  });
}

async function requireContact(actor: PeerActor, id: string) {
  const row = await prisma.peerContact.findFirst({ where: { id, organizationId: actor.organizationId } });
  if (!row) throw new PeerError('Contact not found', 404);
  const client = await requireClient(actor, row.clientId);
  return { row, client };
}

export interface ContactUpdate {
  followUpDone?: boolean;
  followUpAt?: Date | null;
  mode?: ContactMode;
  durationMinutes?: number | null;
  topics?: string[];
  notes?: string | null;
  goalIds?: string[];
}

export async function updateContact(actor: PeerActor, id: string, input: ContactUpdate) {
  const { row, client } = await requireContact(actor, id);
  if (row.voidedAt) throw new PeerError('This contact was voided', 409);
  const editsContent =
    input.mode !== undefined || input.durationMinutes !== undefined || input.topics !== undefined || input.notes !== undefined || input.goalIds !== undefined;
  // Anyone on the caseload may close or reschedule a follow-up; only the author or leadership edits the note.
  if (editsContent && !canEditRow(actor, row)) throw new PeerError('Only the peer who logged this contact can edit it', 403);
  const data: Prisma.PeerContactUpdateInput = {};
  if (input.followUpDone === true) {
    data.followUpDoneAt = new Date();
    data.followUpDoneById = actor.actorUserId;
  } else if (input.followUpDone === false) {
    data.followUpDoneAt = null;
    data.followUpDoneById = null;
  }
  if (input.followUpAt !== undefined) {
    if (input.followUpAt && input.followUpAt < row.contactAt) throw new PeerError('Follow-up must be after the contact', 400);
    data.followUpAt = input.followUpAt;
    if (input.followUpAt && input.followUpDone === undefined) {
      data.followUpDoneAt = null;
      data.followUpDoneById = null;
    }
  }
  if (input.mode !== undefined) data.mode = input.mode;
  if (input.durationMinutes !== undefined) data.durationMinutes = input.durationMinutes;
  if (input.topics !== undefined) data.topics = normalizeTopics(input.topics);
  if (input.notes !== undefined) data.notes = input.notes?.trim() || null;
  if (input.goalIds !== undefined) data.goalIds = await goalIdsForClient(actor, client.id, input.goalIds);
  const updated = await prisma.peerContact.update({ where: { id: row.id }, data });
  return { contact: serializeContact(updated, actor, client.name), clientId: client.id, editsContent };
}

/** Void instead of delete: the entry stays for the record, out of lists and counts. */
export async function voidContact(actor: PeerActor, id: string, reason: string) {
  const { row, client } = await requireContact(actor, id);
  if (!canEditRow(actor, row)) throw new PeerError('Only the peer who logged this contact can void it', 403);
  if (row.voidedAt) return { contact: serializeContact(row, actor, client.name), clientId: client.id };
  const updated = await prisma.peerContact.update({
    where: { id: row.id },
    data: { voidedAt: new Date(), voidedById: actor.actorUserId, voidReason: reason.trim() },
  });
  return { contact: serializeContact(updated, actor, client.name), clientId: client.id };
}

// ─── Goals ──────────────────────────────────────────────────────────────────

type GoalRow = Prisma.PeerGoalGetPayload<object>;

function serializeGoal(row: GoalRow, actor: PeerActor, clientName: string | undefined) {
  return {
    id: row.id,
    clientId: row.clientId,
    clientName: clientName ?? '',
    peerUserId: row.peerUserId,
    peerName: row.peerName,
    goal: row.goal,
    domain: row.domain,
    status: row.status,
    targetDate: row.targetDate?.toISOString() ?? null,
    progressNotes: parseProgressNotes(row.progressNotes),
    achievedAt: row.achievedAt?.toISOString() ?? null,
    source: row.source,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    canEdit: canEditRow(actor, row),
  };
}
export type PeerGoalDto = ReturnType<typeof serializeGoal>;

export async function listGoals(actor: PeerActor, opts: { clientId?: string | null; includeClosed?: boolean }) {
  const ids = opts.clientId ? [(await requireClient(actor, opts.clientId)).id] : await scopedClientIds(actor);
  if (!ids.length) return [];
  const where: Prisma.PeerGoalWhereInput = { organizationId: actor.organizationId, clientId: { in: ids } };
  if (!opts.includeClosed) where.status = { in: ['active', 'in_progress', 'on_hold'] };
  const rows = await prisma.peerGoal.findMany({ where, orderBy: [{ updatedAt: 'desc' }], take: 500 });
  const names = await clientNames(rows.map((r) => r.clientId));
  return rows.map((r) => serializeGoal(r, actor, names.get(r.clientId)));
}

export interface GoalInput {
  clientId: string;
  goal: string;
  domain: GoalDomain;
  status?: GoalStatus;
  targetDate?: Date | null;
  progressNote?: string | null;
}

function note(actor: PeerActor, byName: string | null, text: string): ProgressNote {
  return { at: new Date().toISOString(), byId: actor.actorUserId, byName, text: text.trim() };
}

export async function createGoal(actor: PeerActor, input: GoalInput) {
  const client = await requireClient(actor, input.clientId);
  const name = await actorName(actor);
  const status = input.status ?? 'active';
  const row = await prisma.peerGoal.create({
    data: {
      organizationId: actor.organizationId,
      clientId: client.id,
      peerUserId: actor.actorUserId,
      peerName: name,
      goal: input.goal.trim(),
      domain: input.domain,
      status,
      targetDate: input.targetDate ?? null,
      progressNotes: (input.progressNote?.trim() ? [note(actor, name, input.progressNote)] : []) as Prisma.InputJsonValue,
      achievedAt: status === 'achieved' ? new Date() : null,
      createdById: actor.actorUserId,
    },
  });
  return serializeGoal(row, actor, client.name);
}

export interface GoalUpdate {
  goal?: string;
  domain?: GoalDomain;
  status?: GoalStatus;
  targetDate?: Date | null;
  progressNote?: string | null;
}

/** Status changes and progress notes: any peer-page user on the caseload. Rewording the goal: author or leadership. */
export async function updateGoal(actor: PeerActor, id: string, input: GoalUpdate) {
  const row = await prisma.peerGoal.findFirst({ where: { id, organizationId: actor.organizationId } });
  if (!row) throw new PeerError('Goal not found', 404);
  const client = await requireClient(actor, row.clientId);
  if ((input.goal !== undefined || input.domain !== undefined) && !canEditRow(actor, row)) {
    throw new PeerError('Only the peer who added this goal can reword it', 403);
  }
  const name = await actorName(actor);
  const data: Prisma.PeerGoalUpdateInput = {};
  if (input.goal !== undefined) data.goal = input.goal.trim();
  if (input.domain !== undefined) data.domain = input.domain;
  if (input.targetDate !== undefined) data.targetDate = input.targetDate;
  if (input.status !== undefined && input.status !== row.status) {
    data.status = input.status;
    data.achievedAt = input.status === 'achieved' ? new Date() : null;
  }
  if (input.progressNote?.trim()) {
    const notes = parseProgressNotes(row.progressNotes);
    data.progressNotes = [...notes, note(actor, name, input.progressNote)] as Prisma.InputJsonValue;
  }
  const updated = await prisma.peerGoal.update({ where: { id: row.id }, data });
  return { goal: serializeGoal(updated, actor, client.name), clientId: client.id };
}

// ─── Placements ─────────────────────────────────────────────────────────────

type PlacementRow = Prisma.PeerPlacementGetPayload<object>;

function serializePlacement(row: PlacementRow, actor: PeerActor, clientName: string | undefined, resourceName: string | undefined) {
  return {
    id: row.id,
    clientId: row.clientId,
    clientName: clientName ?? '',
    peerUserId: row.peerUserId,
    peerName: row.peerName,
    placementType: row.placementType,
    organizationName: row.organizationName,
    resourceId: row.resourceId,
    resourceName: resourceName ?? null,
    status: row.status,
    startDate: row.startDate?.toISOString() ?? null,
    endDate: row.endDate?.toISOString() ?? null,
    hoursPerWeek: row.hoursPerWeek,
    notes: row.notes,
    source: row.source,
    updatedAt: row.updatedAt.toISOString(),
    canEdit: canEditRow(actor, row),
  };
}
export type PeerPlacementDto = ReturnType<typeof serializePlacement>;

async function resourceNames(organizationId: string, ids: (string | null)[]) {
  const list = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (!list.length) return new Map<string, string>();
  const rows = await prisma.sdohResource.findMany({ where: { organizationId, id: { in: list } }, select: { id: true, name: true } });
  return new Map(rows.map((r) => [r.id, r.name]));
}

async function requireResource(organizationId: string, id: string | null | undefined) {
  if (!id) return null;
  const r = await prisma.sdohResource.findFirst({ where: { id, organizationId }, select: { id: true, name: true } });
  if (!r) throw new PeerError('Resource not found in your directory', 400);
  return r;
}

export async function listPlacements(actor: PeerActor, opts: { clientId?: string | null; includeClosed?: boolean }) {
  const ids = opts.clientId ? [(await requireClient(actor, opts.clientId)).id] : await scopedClientIds(actor);
  if (!ids.length) return [];
  const where: Prisma.PeerPlacementWhereInput = { organizationId: actor.organizationId, clientId: { in: ids } };
  if (!opts.includeClosed) where.status = { in: ['pending', 'active'] };
  const rows = await prisma.peerPlacement.findMany({ where, orderBy: { updatedAt: 'desc' }, take: 500 });
  const [names, resources] = await Promise.all([
    clientNames(rows.map((r) => r.clientId)),
    resourceNames(actor.organizationId, rows.map((r) => r.resourceId)),
  ]);
  return rows.map((r) => serializePlacement(r, actor, names.get(r.clientId), r.resourceId ? resources.get(r.resourceId) : undefined));
}

export interface PlacementInput {
  clientId: string;
  placementType: PlacementType;
  organizationName?: string | null;
  resourceId?: string | null;
  status?: PlacementStatus;
  startDate?: Date | null;
  endDate?: Date | null;
  hoursPerWeek?: number | null;
  notes?: string | null;
}

export async function createPlacement(actor: PeerActor, input: PlacementInput) {
  const client = await requireClient(actor, input.clientId);
  const resource = await requireResource(actor.organizationId, input.resourceId);
  const orgName = input.organizationName?.trim() || resource?.name || '';
  if (!orgName) throw new PeerError('Name the organization or pick a directory resource', 400);
  const name = await actorName(actor);
  const row = await prisma.peerPlacement.create({
    data: {
      organizationId: actor.organizationId,
      clientId: client.id,
      peerUserId: actor.actorUserId,
      peerName: name,
      placementType: input.placementType,
      organizationName: orgName,
      resourceId: resource?.id ?? null,
      status: input.status ?? 'pending',
      startDate: input.startDate ?? null,
      endDate: input.endDate ?? null,
      hoursPerWeek: input.hoursPerWeek ?? null,
      notes: input.notes?.trim() || null,
      createdById: actor.actorUserId,
    },
  });
  return serializePlacement(row, actor, client.name, resource?.name);
}

export async function updatePlacement(actor: PeerActor, id: string, input: Partial<Omit<PlacementInput, 'clientId'>>) {
  const row = await prisma.peerPlacement.findFirst({ where: { id, organizationId: actor.organizationId } });
  if (!row) throw new PeerError('Placement not found', 404);
  const client = await requireClient(actor, row.clientId);
  const data: Prisma.PeerPlacementUpdateInput = {};
  if (input.placementType !== undefined) data.placementType = input.placementType;
  if (input.organizationName !== undefined && input.organizationName?.trim()) data.organizationName = input.organizationName.trim();
  if (input.resourceId !== undefined) data.resourceId = (await requireResource(actor.organizationId, input.resourceId))?.id ?? null;
  if (input.status !== undefined) data.status = input.status;
  if (input.startDate !== undefined) data.startDate = input.startDate;
  if (input.endDate !== undefined) data.endDate = input.endDate;
  if (input.hoursPerWeek !== undefined) data.hoursPerWeek = input.hoursPerWeek;
  if (input.notes !== undefined) {
    if (!canEditRow(actor, row)) throw new PeerError('Only the peer who added this placement can edit its notes', 403);
    data.notes = input.notes?.trim() || null;
  }
  const updated = await prisma.peerPlacement.update({ where: { id: row.id }, data });
  const resources = await resourceNames(actor.organizationId, [updated.resourceId]);
  return { placement: serializePlacement(updated, actor, client.name, updated.resourceId ? resources.get(updated.resourceId) : undefined), clientId: client.id };
}

// ─── Community resources (SDOH directory, no PHI) ──────────────────────────

export async function listCommunityResources(organizationId: string) {
  const rows = await prisma.sdohResource.findMany({
    where: { organizationId, active: true },
    select: {
      id: true,
      name: true,
      domains: true,
      phone: true,
      website: true,
      address: true,
      city: true,
      state: true,
      hours: true,
      cost: true,
      eligibilityNotes: true,
      lastVerifiedAt: true,
    },
    orderBy: { name: 'asc' },
  });
  return rows.map((r) => ({ ...r, lastVerifiedAt: r.lastVerifiedAt?.toISOString() ?? null }));
}

// ─── Legacy module lists ───────────────────────────────────────────────────

async function readLegacy(organizationId: string) {
  const states = await prisma.clinicModuleState.findMany({
    where: { organizationId, module: { in: Object.values(LEGACY_MODULES) } },
    select: { module: true, data: true },
  });
  const byModule = new Map(states.map((s) => [s.module, s.data]));
  const [contacts, goals, placements] = await Promise.all([
    prisma.peerContact.findMany({ where: { organizationId, source: 'legacy' }, select: { legacyId: true } }),
    prisma.peerGoal.findMany({ where: { organizationId, source: 'legacy' }, select: { legacyId: true } }),
    prisma.peerPlacement.findMany({ where: { organizationId, source: 'legacy' }, select: { legacyId: true } }),
  ]);
  const imported: Record<LegacyKind, Set<string>> = {
    contact: new Set(contacts.map((r) => r.legacyId ?? '')),
    goal: new Set(goals.map((r) => r.legacyId ?? '')),
    placement: new Set(placements.map((r) => r.legacyId ?? '')),
  };
  return (Object.keys(LEGACY_MODULES) as LegacyKind[]).map((kind) => {
    const parsed = parseLegacyList(kind, byModule.get(LEGACY_MODULES[kind]));
    const pending = parsed.entries.filter((e) => !imported[kind].has(e.legacyId));
    return { kind, pending, imported: parsed.entries.length - pending.length, sampleRows: parsed.sampleRows, unreadable: parsed.unreadable };
  });
}

/**
 * Old free-text entries. Leadership sees the entries (client names typed on the old page are
 * org-wide); other roles get counts only. Nothing is matched to a client automatically.
 */
export async function legacyOverview(actor: PeerActor) {
  const lists = await readLegacy(actor.organizationId);
  const canImport = isPeerLeadership(actor.actorRole);
  return {
    canImport,
    counts: Object.fromEntries(
      lists.map((l) => [l.kind, { pending: l.pending.length, imported: l.imported, sampleRows: l.sampleRows, unreadable: l.unreadable }])
    ) as Record<LegacyKind, { pending: number; imported: number; sampleRows: number; unreadable: number }>,
    entries: canImport ? lists.flatMap((l) => l.pending.map(({ raw: _raw, ...e }) => e)) : [],
  };
}

export interface LegacyImportInput {
  kind: LegacyKind;
  legacyId: string;
  clientId: string;
  peerUserId: string;
  contactAt?: Date | null;
  mode?: ContactMode;
  domain?: GoalDomain;
  placementType?: PlacementType;
}

/** File one old entry to a client the user picked. Idempotent per (org, legacy, id). */
export async function importLegacyEntry(actor: PeerActor, input: LegacyImportInput) {
  if (!isPeerLeadership(actor.actorRole)) throw new PeerError('Only clinic leadership can file legacy entries', 403);
  const lists = await readLegacy(actor.organizationId);
  const list = lists.find((l) => l.kind === input.kind)!;
  const entry = list.pending.find((e) => e.legacyId === input.legacyId);
  if (!entry) throw new PeerError('That entry was already filed or no longer exists', 409);
  if (entry.group) throw new PeerError('Group entries covered several people and cannot be filed to one chart', 400);
  const client = await requireClient(actor, input.clientId);
  const peer = await prisma.user.findFirst({
    where: { id: input.peerUserId, organizationId: actor.organizationId },
    select: { id: true, name: true, email: true },
  });
  if (!peer) throw new PeerError('Pick a staff member from your clinic', 400);
  const peerName = peer.name || peer.email || null;
  const s = entry.suggested;
  const legacyData = entry.raw as Prisma.InputJsonValue;
  const base = {
    organizationId: actor.organizationId,
    clientId: client.id,
    peerUserId: peer.id,
    peerName,
    source: 'legacy',
    legacyId: entry.legacyId,
    legacyData,
    createdById: actor.actorUserId,
  };
  const date = (v: unknown) => (typeof v === 'string' ? parseDateInput(v) : null);
  try {
    if (input.kind === 'contact') {
      const contactAt = input.contactAt ?? date(entry.date);
      if (!contactAt) throw new PeerError('This entry has no date: enter the contact date', 400);
      const row = await prisma.peerContact.create({
        data: {
          ...base,
          contactAt,
          mode: input.mode ?? (s.mode as ContactMode),
          durationMinutes: typeof s.durationMinutes === 'number' ? Math.round(s.durationMinutes) : null,
          topics: normalizeTopics(s.topics as string[]),
          notes: (s.notes as string) || null,
        },
      });
      return { id: row.id, clientId: client.id };
    }
    if (input.kind === 'goal') {
      if (!input.domain) throw new PeerError('Pick a goal domain', 400);
      const status = (s.status as GoalStatus) ?? 'active';
      const progressNote = typeof s.progressNote === 'string' && s.progressNote ? s.progressNote : null;
      const row = await prisma.peerGoal.create({
        data: {
          ...base,
          goal: String(s.goal || entry.summary),
          domain: input.domain,
          status,
          targetDate: date(s.targetDate),
          achievedAt: null,
          progressNotes: (progressNote
            ? [{ at: new Date().toISOString(), byId: actor.actorUserId, byName: null, text: `Legacy note: ${progressNote}` }]
            : []) as Prisma.InputJsonValue,
        },
      });
      return { id: row.id, clientId: client.id };
    }
    const placementType = input.placementType ?? (s.placementType as PlacementType | null);
    if (!placementType) throw new PeerError('Pick a placement type', 400);
    const row = await prisma.peerPlacement.create({
      data: {
        ...base,
        placementType,
        organizationName: String(s.organizationName || entry.summary),
        status: (s.status as PlacementStatus) ?? 'pending',
        startDate: date(s.startDate),
        hoursPerWeek: typeof s.hoursPerWeek === 'number' ? s.hoursPerWeek : null,
        notes: (s.notes as string) || null,
      },
    });
    return { id: row.id, clientId: client.id };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new PeerError('That entry was already filed', 409);
    throw e;
  }
}
