import 'server-only';
import { Prisma, type Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { triggerAutopayAfterVisitStatus } from '@/lib/patientPayments/visitTrigger';
import { verifiedMedicalDirector } from '@/lib/auth/medicalDirector';
import { lockedSensitiveClientIds } from '@/lib/privacy/sensitiveAccess';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { isPart2Classification } from '@/lib/fhir/mapping/privacy';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { fromPracticeWallTime, practiceToday, toPracticeWallTime } from '@/lib/time/practiceTime';
import { describeRecurrence, type SeriesFrequency } from '@/lib/scheduling/recurrence';
import { resolveTelehealthPos } from '@/lib/telehealth/pos';
import { goalsSummary, loadLicenseLevel } from '@/lib/ehr/therapy/planStore';
import { updateProgressNoteWorkflow } from '@/lib/notes/workflow-store';
import { generateClaimFromNote } from '@/lib/billing/claims';
import { watchProgressNote } from '@/lib/ai/riskWatch/hooks';
import { BUILTIN_LAB_TESTS } from '@/lib/labs/catalog';
import {
  HIDDEN_MEMBER_LABEL,
  PROTECTED_MEMBER_LABEL,
  canDocumentSession,
  canManageGroup,
  canSeeMember,
  isGroupFacilitator,
  isGroupLeadership,
} from './access';
import {
  aggregateGroupReport,
  appointmentStatusForAttendance,
  attendedCount,
  billableLine,
  groupNoteCosignRequired,
  isPart2Group,
  kindChangeProblem,
  memberAttendanceRows,
  missingRequired,
  notePart2,
  plannedOccurrences,
  privacyWarnings,
  renderGroupNoteBody,
  type BillableLine,
  type GroupRecurrence,
} from './rules';
import {
  GROUP_KIND_META,
  INDIVIDUAL_FIELDS,
  SHARED_FIELDS,
  defaultBilling,
  groupTypeLabel,
  isAttended,
  type AttendanceStatus,
  type GroupKind,
  type LabUdsResult,
  type NoteValues,
  type PlanGoalOption,
} from './types';

/**
 * Group module data access. Every function takes the signed-in actor and enforces the org, the
 * group page role (checked by the route), caseload / facilitator visibility and protected-record
 * masking. Routes audit-log each call with the client ids it touched (returned as `patientIds`).
 */

export type GroupActor = { organizationId: string; userId: string; role: Role; medicalDirector: boolean };

export function groupActor(gate: { organizationId: string; userId: string; role: Role }): GroupActor {
  return {
    organizationId: gate.organizationId,
    userId: gate.userId,
    role: gate.role,
    medicalDirector: verifiedMedicalDirector({ userId: gate.userId, role: gate.role, organizationId: gate.organizationId }),
  };
}

type Fail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });

const ymd = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const dateOnly = (s: string) => new Date(`${s}T00:00:00.000Z`);

type GroupRow = Prisma.ClinicalGroupGetPayload<object>;

function recurrenceOf(g: GroupRow): GroupRecurrence {
  return {
    recurFrequency: g.recurFrequency,
    recurInterval: g.recurInterval,
    recurWeekdays: g.recurWeekdays,
    recurStartTime: g.recurStartTime,
    recurStartDate: ymd(g.recurStartDate),
    recurEndDate: ymd(g.recurEndDate),
    defaultDurationMinutes: g.defaultDurationMinutes,
  };
}

function scheduleLabel(g: GroupRow): string | null {
  if (!g.recurFrequency || !g.recurStartDate || !g.recurStartTime) return null;
  const desc = describeRecurrence({
    frequency: g.recurFrequency as SeriesFrequency,
    interval: g.recurInterval ?? 1,
    byWeekday: g.recurWeekdays.length ? g.recurWeekdays : null,
    startDate: ymd(g.recurStartDate)!,
  });
  return `${desc} at ${g.recurStartTime}`;
}

async function staffNames(ids: (string | null | undefined)[]) {
  const list = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (!list.length) return new Map<string, { name: string; credentials: string | null }>();
  const users = await prisma.user.findMany({ where: { id: { in: list } }, select: { id: true, name: true, email: true, credentials: true } });
  return new Map(users.map((u) => [u.id, { name: u.name?.trim() || u.email, credentials: u.credentials?.trim() || null }]));
}

async function locationNames(organizationId: string, ids: (string | null | undefined)[]) {
  const list = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (!list.length) return new Map<string, string>();
  const rows = await prisma.location.findMany({ where: { organizationId, id: { in: list } }, select: { id: true, name: true } });
  return new Map(rows.map((r) => [r.id, r.name]));
}

type ClientLite = { id: string; name: string; assignedToId: string | null };

/** Visibility of each client for this actor within a group: visible, hidden (not caseload) or protected. */
async function memberVisibility(actor: GroupActor, group: { facilitatorId: string | null; coFacilitatorId: string | null }, clients: ClientLite[]) {
  const locked = await lockedSensitiveClientIds({
    organizationId: actor.organizationId,
    userId: actor.userId,
    role: actor.role,
    clientIds: clients.map((c) => c.id),
  });
  // Care team (same rule as the client list / chart), one query for the whole roster
  const careTeam = clients.length
    ? new Set(
        (
          await prisma.client.findMany({
            where: { AND: [{ id: { in: clients.map((c) => c.id) } }, clientAccessWhere({ organizationId: actor.organizationId, actorUserId: actor.userId, actorRole: actor.role })] },
            select: { id: true },
          })
        ).map((r) => r.id)
      )
    : new Set<string>();
  const out = new Map<string, { visible: boolean; label: string }>();
  for (const c of clients) {
    const scoped = canSeeMember({ role: actor.role, userId: actor.userId, medicalDirector: actor.medicalDirector, group, assignedToId: c.assignedToId, onCareTeam: careTeam.has(c.id) });
    if (!scoped) out.set(c.id, { visible: false, label: HIDDEN_MEMBER_LABEL });
    else if (locked.has(c.id)) out.set(c.id, { visible: false, label: PROTECTED_MEMBER_LABEL });
    else out.set(c.id, { visible: true, label: c.name });
  }
  return out;
}

async function loadClients(organizationId: string, ids: string[]): Promise<ClientLite[]> {
  if (!ids.length) return [];
  return prisma.client.findMany({
    where: { id: { in: [...new Set(ids)] }, organizationId },
    select: { id: true, name: true, assignedToId: true },
  });
}

async function loadGroup(actor: GroupActor, id: string, kind?: GroupKind) {
  return prisma.clinicalGroup.findFirst({ where: { id, organizationId: actor.organizationId, ...(kind ? { kind } : {}) } });
}

// ─── Groups list ─────────────────────────────────────────────────────────────

export type GroupListItem = {
  id: string;
  kind: GroupKind;
  name: string;
  groupType: string;
  groupTypeLabel: string;
  program: string | null;
  facilitatorId: string | null;
  facilitatorName: string | null;
  coFacilitatorName: string | null;
  locationId: string | null;
  locationName: string | null;
  room: string | null;
  telehealth: boolean;
  capacity: number;
  activeMembers: number;
  enrollment: string;
  status: string;
  billingCode: string | null;
  billingMode: string;
  schedule: string | null;
  weekdays: number[];
  nextSession: { id: string; startsAt: string } | null;
  part2: boolean;
  canManage: boolean;
};

export async function listGroups(actor: GroupActor, kind: GroupKind): Promise<GroupListItem[]> {
  const now = new Date();
  const groups = await prisma.clinicalGroup.findMany({
    where: { organizationId: actor.organizationId, kind },
    orderBy: [{ status: 'asc' }, { name: 'asc' }],
    take: 500,
  });
  const ids = groups.map((g) => g.id);
  const [counts, next, staff, locs] = await Promise.all([
    prisma.clinicalGroupMember.groupBy({ by: ['groupId'], where: { groupId: { in: ids }, status: 'active' }, _count: { _all: true } }),
    prisma.clinicalGroupSession.findMany({
      where: { groupId: { in: ids }, startsAt: { gte: new Date(now.getTime() - 3 * 3_600_000) }, status: { not: 'cancelled' } },
      orderBy: { startsAt: 'asc' },
      select: { id: true, groupId: true, startsAt: true },
    }),
    staffNames(groups.flatMap((g) => [g.facilitatorId, g.coFacilitatorId])),
    locationNames(actor.organizationId, groups.map((g) => g.locationId)),
  ]);
  const countMap = new Map(counts.map((c) => [c.groupId, c._count._all]));
  const nextMap = new Map<string, { id: string; startsAt: string }>();
  for (const s of next) if (!nextMap.has(s.groupId)) nextMap.set(s.groupId, { id: s.id, startsAt: s.startsAt.toISOString() });
  return groups.map((g) => ({
    id: g.id,
    kind: g.kind as GroupKind,
    name: g.name,
    groupType: g.groupType,
    groupTypeLabel: groupTypeLabel(g.kind as GroupKind, g.groupType),
    program: g.program,
    facilitatorId: g.facilitatorId,
    facilitatorName: g.facilitatorId ? staff.get(g.facilitatorId)?.name ?? null : null,
    coFacilitatorName: g.coFacilitatorId ? staff.get(g.coFacilitatorId)?.name ?? null : null,
    locationId: g.locationId,
    locationName: g.locationId ? locs.get(g.locationId) ?? null : null,
    room: g.room,
    telehealth: g.telehealth,
    capacity: g.capacity,
    activeMembers: countMap.get(g.id) ?? 0,
    enrollment: g.enrollment,
    status: g.status,
    billingCode: g.billingCode,
    billingMode: g.billingMode,
    schedule: scheduleLabel(g),
    weekdays: g.recurWeekdays,
    nextSession: nextMap.get(g.id) ?? null,
    part2: g.part2,
    canManage: canManageGroup({ role: actor.role, userId: actor.userId, medicalDirector: actor.medicalDirector, group: g }),
  }));
}

// ─── Create / update ─────────────────────────────────────────────────────────

export type GroupInput = {
  name: string;
  groupType: string;
  description?: string | null;
  program?: string | null;
  facilitatorId?: string | null;
  coFacilitatorId?: string | null;
  locationId?: string | null;
  room?: string | null;
  telehealth?: boolean;
  capacity?: number;
  defaultDurationMinutes?: number;
  billingCode?: string | null;
  billingMode?: 'per_session' | 'attendance_only';
  minBillableMinutes?: number | null;
  maxBillableGroupSize?: number | null;
  enrollment?: 'open' | 'closed';
  status?: 'active' | 'paused' | 'archived';
  recurFrequency?: SeriesFrequency | null;
  recurInterval?: number | null;
  recurWeekdays?: number[];
  recurStartTime?: string | null;
  recurStartDate?: string | null;
  recurEndDate?: string | null;
  kind?: GroupKind;
};

async function validateStaff(organizationId: string, ids: (string | null | undefined)[]): Promise<string | null> {
  const list = ids.filter((x): x is string => Boolean(x));
  if (!list.length) return null;
  const found = await prisma.user.count({ where: { id: { in: list }, organizationId, status: 'ACTIVE' } });
  return found === new Set(list).size ? null : 'Facilitator must be an active staff member of this practice.';
}

async function validateLocation(organizationId: string, id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  const loc = await prisma.location.findFirst({ where: { id, organizationId }, select: { id: true } });
  return loc ? null : 'Location not found.';
}

/** PRP groups never carry a billing code here; SUD groups are always Part 2. */
function billingFields(kind: GroupKind, input: GroupInput, current?: GroupRow) {
  const type = input.groupType ?? current?.groupType ?? 'other';
  const def = defaultBilling(kind, type);
  if (def.locked) return { billingCode: null, billingMode: 'attendance_only' as const };
  const code = input.billingCode !== undefined ? input.billingCode?.trim().toUpperCase() || null : current ? current.billingCode : def.billingCode;
  const mode = input.billingMode ?? (current ? (current.billingMode as 'per_session' | 'attendance_only') : def.billingMode);
  return { billingCode: code, billingMode: mode };
}

export async function createGroup(actor: GroupActor, kind: GroupKind, input: GroupInput) {
  if (!isGroupLeadership(actor.role, actor.medicalDirector) && input.facilitatorId && input.facilitatorId !== actor.userId && input.coFacilitatorId !== actor.userId) {
    return fail(403, 'Only leadership can create a group run by someone else. Name yourself as facilitator or co-facilitator.');
  }
  const problem =
    (await validateStaff(actor.organizationId, [input.facilitatorId, input.coFacilitatorId])) ||
    (await validateLocation(actor.organizationId, input.locationId));
  if (problem) return fail(400, problem);
  const billing = billingFields(kind, input);
  const row = await prisma.clinicalGroup.create({
    data: {
      organizationId: actor.organizationId,
      kind,
      groupType: input.groupType,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      program: input.program?.trim() || null,
      facilitatorId: input.facilitatorId || actor.userId,
      coFacilitatorId: input.coFacilitatorId || null,
      locationId: input.locationId || null,
      room: input.room?.trim() || null,
      telehealth: Boolean(input.telehealth),
      capacity: input.capacity ?? 10,
      defaultDurationMinutes: input.defaultDurationMinutes ?? 60,
      ...billing,
      minBillableMinutes: input.minBillableMinutes ?? null,
      maxBillableGroupSize: input.maxBillableGroupSize ?? null,
      enrollment: input.enrollment ?? 'open',
      status: input.status ?? 'active',
      part2: isPart2Group(kind),
      recurFrequency: input.recurFrequency ?? null,
      recurInterval: input.recurInterval ?? null,
      recurWeekdays: input.recurWeekdays ?? [],
      recurStartTime: input.recurStartTime ?? null,
      recurStartDate: input.recurStartDate ? dateOnly(input.recurStartDate) : null,
      recurEndDate: input.recurEndDate ? dateOnly(input.recurEndDate) : null,
      createdById: actor.userId,
    },
  });
  return { ok: true as const, group: row };
}

async function groupHasNotes(groupId: string): Promise<boolean> {
  const n = await prisma.clinicalGroupAttendance.count({ where: { groupId, progressNoteId: { not: null } } });
  return n > 0;
}

export async function updateGroup(actor: GroupActor, groupId: string, input: Partial<GroupInput>) {
  const g = await loadGroup(actor, groupId);
  if (!g) return fail(404, 'Group not found');
  if (!canManageGroup({ role: actor.role, userId: actor.userId, medicalDirector: actor.medicalDirector, group: g })) return fail(403, 'Only leadership or the group’s facilitators can change this group.');
  if (input.kind && input.kind !== g.kind) {
    const problem = kindChangeProblem(g.kind, input.kind, await groupHasNotes(g.id));
    if (problem) return fail(409, problem);
  }
  const problem =
    (await validateStaff(actor.organizationId, [input.facilitatorId, input.coFacilitatorId])) ||
    (await validateLocation(actor.organizationId, input.locationId));
  if (problem) return fail(400, problem);
  const kind = (input.kind ?? g.kind) as GroupKind;
  const billing = billingFields(kind, { ...input, groupType: input.groupType ?? g.groupType, name: input.name ?? g.name }, g);
  const set = <K extends keyof GroupInput>(k: K) => input[k] !== undefined;
  const row = await prisma.clinicalGroup.update({
    where: { id: g.id },
    data: {
      ...(set('name') ? { name: input.name!.trim() } : {}),
      ...(set('groupType') ? { groupType: input.groupType } : {}),
      ...(set('kind') ? { kind, part2: isPart2Group(kind) } : {}),
      ...(set('description') ? { description: input.description?.trim() || null } : {}),
      ...(set('program') ? { program: input.program?.trim() || null } : {}),
      ...(set('facilitatorId') ? { facilitatorId: input.facilitatorId || null } : {}),
      ...(set('coFacilitatorId') ? { coFacilitatorId: input.coFacilitatorId || null } : {}),
      ...(set('locationId') ? { locationId: input.locationId || null } : {}),
      ...(set('room') ? { room: input.room?.trim() || null } : {}),
      ...(set('telehealth') ? { telehealth: Boolean(input.telehealth) } : {}),
      ...(set('capacity') ? { capacity: input.capacity } : {}),
      ...(set('defaultDurationMinutes') ? { defaultDurationMinutes: input.defaultDurationMinutes } : {}),
      ...billing,
      ...(set('minBillableMinutes') ? { minBillableMinutes: input.minBillableMinutes ?? null } : {}),
      ...(set('maxBillableGroupSize') ? { maxBillableGroupSize: input.maxBillableGroupSize ?? null } : {}),
      ...(set('enrollment') ? { enrollment: input.enrollment } : {}),
      ...(set('status') ? { status: input.status } : {}),
      ...(set('recurFrequency') ? { recurFrequency: input.recurFrequency ?? null } : {}),
      ...(set('recurInterval') ? { recurInterval: input.recurInterval ?? null } : {}),
      ...(set('recurWeekdays') ? { recurWeekdays: input.recurWeekdays ?? [] } : {}),
      ...(set('recurStartTime') ? { recurStartTime: input.recurStartTime ?? null } : {}),
      ...(set('recurStartDate') ? { recurStartDate: input.recurStartDate ? dateOnly(input.recurStartDate) : null } : {}),
      ...(set('recurEndDate') ? { recurEndDate: input.recurEndDate ? dateOnly(input.recurEndDate) : null } : {}),
    },
  });
  return { ok: true as const, group: row };
}

// ─── Group detail ────────────────────────────────────────────────────────────

export type MemberView = {
  memberId: string;
  /** null when the viewer may not see who this is */
  clientId: string | null;
  displayName: string;
  visible: boolean;
  status: string;
  joinedOn: string;
  leftOn: string | null;
  leftReason: string | null;
  confidentialityOnFile: boolean | null;
};

export type SessionSummary = {
  id: string;
  startsAt: string;
  endsAt: string;
  date: string;
  startTime: string;
  durationMinutes: number;
  status: string;
  telehealth: boolean;
  topic: string | null;
  groupSize: number | null;
  attended: number;
  marked: number;
  notesDraft: number;
  notesSigned: number;
};

/** Signed group-confidentiality agreement per client (consent library), or null if it cannot be checked. */
async function confidentialityOnFile(organizationId: string, clientIds: string[]): Promise<Map<string, boolean> | null> {
  if (!clientIds.length) return new Map();
  try {
    const rows = await prisma.consentForm.findMany({
      where: {
        organizationId,
        clientId: { in: clientIds },
        status: 'SIGNED',
        OR: [{ formKey: { contains: 'group', mode: 'insensitive' } }, { type: { contains: 'group', mode: 'insensitive' } }],
      },
      select: { clientId: true, expiresAt: true, formStatus: true },
    });
    const now = Date.now();
    const ok = new Set(
      rows
        .filter((r) => (!r.expiresAt || r.expiresAt.getTime() > now) && !['SUPERSEDED', 'VOIDED'].includes(r.formStatus ?? ''))
        .map((r) => r.clientId)
    );
    return new Map(clientIds.map((id) => [id, ok.has(id)]));
  } catch {
    return null;
  }
}

async function noteStatuses(noteIds: string[]) {
  if (!noteIds.length) return new Map<string, { status: string; cosignRequired: boolean; cosignedAt: Date | null }>();
  const rows = await prisma.progressNoteWorkflow.findMany({
    where: { noteId: { in: noteIds } },
    select: { noteId: true, status: true, cosignRequired: true, cosignedAt: true },
  });
  return new Map(rows.map((r) => [r.noteId, { status: r.status, cosignRequired: r.cosignRequired, cosignedAt: r.cosignedAt }]));
}

export async function getGroupDetail(actor: GroupActor, groupId: string, kind: GroupKind) {
  const g = await loadGroup(actor, groupId, kind);
  if (!g) return fail(404, 'Group not found');
  const tz = await getPracticeTimeZone(actor.organizationId);
  const [members, sessions, staff, locs] = await Promise.all([
    prisma.clinicalGroupMember.findMany({ where: { groupId: g.id }, orderBy: [{ status: 'asc' }, { joinedOn: 'asc' }] }),
    prisma.clinicalGroupSession.findMany({
      where: { groupId: g.id },
      orderBy: { startsAt: 'desc' },
      take: 120,
      include: { attendance: { select: { status: true, progressNoteId: true } } },
    }),
    staffNames([g.facilitatorId, g.coFacilitatorId]),
    locationNames(actor.organizationId, [g.locationId]),
  ]);
  const clients = await loadClients(actor.organizationId, members.map((m) => m.clientId));
  const vis = await memberVisibility(actor, g, clients);
  const visibleIds = members.map((m) => m.clientId).filter((id) => vis.get(id)?.visible);
  const [consent, statuses] = await Promise.all([
    confidentialityOnFile(actor.organizationId, visibleIds),
    noteStatuses(sessions.flatMap((s) => s.attendance.map((a) => a.progressNoteId).filter((x): x is string => Boolean(x)))),
  ]);
  const memberViews: MemberView[] = members.map((m) => {
    const v = vis.get(m.clientId) ?? { visible: false, label: HIDDEN_MEMBER_LABEL };
    return {
      memberId: m.id,
      clientId: v.visible ? m.clientId : null,
      displayName: v.label,
      visible: v.visible,
      status: m.status,
      joinedOn: ymd(m.joinedOn)!,
      leftOn: ymd(m.leftOn),
      leftReason: v.visible ? m.leftReason : null,
      confidentialityOnFile: v.visible ? consent?.get(m.clientId) ?? null : null,
    };
  });
  const sessionViews: SessionSummary[] = sessions.map((s) => {
    const wall = toPracticeWallTime(s.startsAt, tz);
    const notes = s.attendance.map((a) => (a.progressNoteId ? statuses.get(a.progressNoteId)?.status ?? 'DRAFT' : null)).filter(Boolean);
    return {
      id: s.id,
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
      date: wall.date,
      startTime: wall.time,
      durationMinutes: s.durationMinutes,
      status: s.status,
      telehealth: s.telehealth,
      topic: s.topic,
      groupSize: s.groupSize,
      attended: attendedCount(s.attendance),
      marked: s.attendance.filter((a) => a.status !== 'unmarked').length,
      notesDraft: notes.filter((n) => n === 'DRAFT').length,
      notesSigned: notes.filter((n) => n === 'SIGNED' || n === 'LOCKED').length,
    };
  });
  const def = defaultBilling(g.kind as GroupKind, g.groupType);
  return {
    ok: true as const,
    timeZone: tz,
    group: {
      ...g,
      recurStartDate: ymd(g.recurStartDate),
      recurEndDate: ymd(g.recurEndDate),
      kind: g.kind as GroupKind,
      groupTypeLabel: groupTypeLabel(g.kind as GroupKind, g.groupType),
      facilitatorName: g.facilitatorId ? staff.get(g.facilitatorId)?.name ?? null : null,
      coFacilitatorName: g.coFacilitatorId ? staff.get(g.coFacilitatorId)?.name ?? null : null,
      locationName: g.locationId ? locs.get(g.locationId) ?? null : null,
      schedule: scheduleLabel(g),
      billingNote: def.note,
      billingLocked: Boolean(def.locked),
      hasNotes: sessions.some((s) => s.attendance.some((a) => a.progressNoteId)),
    },
    members: memberViews,
    sessions: sessionViews,
    consentCheckAvailable: consent !== null,
    canManage: canManageGroup({ role: actor.role, userId: actor.userId, medicalDirector: actor.medicalDirector, group: g }),
    patientIds: visibleIds,
  };
}

// ─── Members ─────────────────────────────────────────────────────────────────

export async function addMember(actor: GroupActor, groupId: string, input: { clientId: string; joinedOn?: string | null }) {
  const g = await loadGroup(actor, groupId);
  if (!g) return fail(404, 'Group not found');
  if (!canManageGroup({ role: actor.role, userId: actor.userId, medicalDirector: actor.medicalDirector, group: g })) return fail(403, 'Only leadership or the group’s facilitators can add members.');
  if (g.status === 'archived') return fail(409, 'This group is archived.');
  const client = await prisma.client.findFirst({ where: { id: input.clientId, organizationId: actor.organizationId }, select: { id: true, name: true, assignedToId: true, status: true } });
  if (!client) return fail(404, 'Client not found');
  if (client.status === 'DISCHARGED') return fail(409, 'This client is discharged.');
  const vis = await memberVisibility(actor, { facilitatorId: g.facilitatorId, coFacilitatorId: g.coFacilitatorId }, [client]);
  if (!vis.get(client.id)?.visible && !isGroupLeadership(actor.role, actor.medicalDirector)) {
    // Facilitators may add any org client to their own group; protected records still need access
    if (vis.get(client.id)?.label === PROTECTED_MEMBER_LABEL) return fail(403, 'This is a protected record. Ask the Practice Director for access before adding the client to a group.');
  }
  const active = await prisma.clinicalGroupMember.count({ where: { groupId: g.id, status: 'active' } });
  const existing = await prisma.clinicalGroupMember.findUnique({ where: { groupId_clientId: { groupId: g.id, clientId: client.id } } });
  if (existing?.status === 'active') return fail(409, 'Already a member of this group.');
  if (active >= g.capacity) return fail(409, `The group is full (${g.capacity}). Raise the capacity first.`);
  const tz = await getPracticeTimeZone(actor.organizationId);
  const joinedOn = input.joinedOn || practiceToday(tz);
  const member = existing
    ? await prisma.clinicalGroupMember.update({ where: { id: existing.id }, data: { status: 'active', joinedOn: dateOnly(joinedOn), leftOn: null, leftReason: null } })
    : await prisma.clinicalGroupMember.create({
        data: { organizationId: actor.organizationId, groupId: g.id, clientId: client.id, status: 'active', joinedOn: dateOnly(joinedOn), addedById: actor.userId },
      });
  // Upcoming sessions get the new member's visit on the calendar
  const upcoming = await prisma.clinicalGroupSession.findMany({ where: { groupId: g.id, startsAt: { gt: new Date() }, status: 'scheduled' } });
  for (const s of upcoming) await ensureMemberAppointment(actor, g, s, client);
  return { ok: true as const, member, patientIds: [client.id] };
}

export async function endMembership(actor: GroupActor, groupId: string, memberId: string, input: { status: 'completed' | 'discharged' | 'withdrawn' | 'inactive'; leftOn?: string | null; reason?: string | null }) {
  const g = await loadGroup(actor, groupId);
  if (!g) return fail(404, 'Group not found');
  if (!canManageGroup({ role: actor.role, userId: actor.userId, medicalDirector: actor.medicalDirector, group: g })) return fail(403, 'Only leadership or the group’s facilitators can end a membership.');
  const m = await prisma.clinicalGroupMember.findFirst({ where: { id: memberId, groupId: g.id } });
  if (!m) return fail(404, 'Member not found');
  const tz = await getPracticeTimeZone(actor.organizationId);
  const leftOn = input.leftOn || practiceToday(tz);
  const member = await prisma.clinicalGroupMember.update({
    where: { id: m.id },
    data: { status: input.status, leftOn: dateOnly(leftOn), leftReason: input.reason?.trim() || null },
  });
  // Future group visits for this member are cancelled; history (attendance, notes) is kept
  const future = await prisma.clinicalGroupSession.findMany({ where: { groupId: g.id, startsAt: { gt: new Date() } }, select: { id: true } });
  if (future.length) {
    await prisma.appointment.updateMany({
      where: { groupSessionId: { in: future.map((s) => s.id) }, clientId: m.clientId, status: 'SCHEDULED' },
      data: { status: 'CANCELLED' },
    });
  }
  return { ok: true as const, member, patientIds: [m.clientId] };
}

// ─── Sessions / scheduling ───────────────────────────────────────────────────

type SessionRow = Prisma.ClinicalGroupSessionGetPayload<object>;

/**
 * Per-member appointment linked to the group occurrence (facilitator's calendar, member's upcoming
 * visits, reminders). Written directly, not through createAppointment: the facilitator is booked
 * once per member at the same time on purpose (that is the group), and no per-member booking
 * confirmation is sent. Idempotent per session + client.
 */
async function ensureMemberAppointment(actor: GroupActor, g: GroupRow, s: SessionRow, client: { id: string; name: string }) {
  const existing = await prisma.appointment.findFirst({ where: { groupSessionId: s.id, clientId: client.id }, select: { id: true } });
  if (existing) return existing.id;
  const kind = g.kind as GroupKind;
  const appt = await prisma.appointment.create({
    data: {
      clientId: client.id,
      clientName: client.name,
      clinicianId: s.facilitatorId ?? g.facilitatorId,
      organizationId: actor.organizationId,
      type: GROUP_KIND_META[kind].appointmentType,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      status: 'SCHEDULED',
      isVirtual: s.telehealth,
      groupSessionId: s.id,
      createdById: actor.userId,
      createdVia: 'group',
    },
    select: { id: true },
  });
  return appt.id;
}

async function syncSessionAppointments(actor: GroupActor, g: GroupRow, s: SessionRow) {
  const date = toPracticeWallTime(s.startsAt, await getPracticeTimeZone(actor.organizationId)).date;
  const members = await prisma.clinicalGroupMember.findMany({
    where: { groupId: g.id, status: 'active', joinedOn: { lte: dateOnly(date) } },
    select: { clientId: true },
  });
  const clients = await loadClients(actor.organizationId, members.map((m) => m.clientId));
  for (const c of clients) await ensureMemberAppointment(actor, g, s, c);
  return clients.length;
}

/** Next `count` occurrences of the group's repeat schedule (skips ones that exist). */
export async function generateSessions(actor: GroupActor, groupId: string, input: { count: number; fromDate?: string | null }) {
  const g = await loadGroup(actor, groupId);
  if (!g) return fail(404, 'Group not found');
  if (!canManageGroup({ role: actor.role, userId: actor.userId, medicalDirector: actor.medicalDirector, group: g })) return fail(403, 'Only leadership or the group’s facilitators can schedule sessions.');
  if (g.status !== 'active') return fail(409, 'Only active groups can be scheduled.');
  const tz = await getPracticeTimeZone(actor.organizationId);
  const existing = await prisma.clinicalGroupSession.findMany({ where: { groupId: g.id }, select: { startsAt: true } });
  const plan = plannedOccurrences(recurrenceOf(g), {
    fromDate: input.fromDate || practiceToday(tz),
    count: input.count,
    timeZone: tz,
    now: new Date(),
    existingStarts: existing.map((e) => e.startsAt),
  });
  if ('error' in plan) return fail(400, plan.error);
  const created: SessionRow[] = [];
  for (const o of plan.occurrences) {
    const s = await prisma.clinicalGroupSession.create({
      data: {
        organizationId: actor.organizationId,
        groupId: g.id,
        startsAt: o.start,
        endsAt: o.end,
        durationMinutes: g.defaultDurationMinutes,
        telehealth: g.telehealth,
        locationId: g.locationId,
        room: g.room,
        facilitatorId: g.facilitatorId,
        coFacilitatorId: g.coFacilitatorId,
        part2: g.part2,
        fromRecurrence: true,
        createdById: actor.userId,
      },
    });
    await syncSessionAppointments(actor, g, s);
    created.push(s);
  }
  return { ok: true as const, created: created.map((s) => ({ id: s.id, startsAt: s.startsAt.toISOString() })) };
}

/** One-off session (ad hoc or a make-up date). */
export async function createSession(actor: GroupActor, groupId: string, input: { date: string; startTime: string; durationMinutes?: number | null }) {
  const g = await loadGroup(actor, groupId);
  if (!g) return fail(404, 'Group not found');
  if (!canManageGroup({ role: actor.role, userId: actor.userId, medicalDirector: actor.medicalDirector, group: g })) return fail(403, 'Only leadership or the group’s facilitators can schedule sessions.');
  const tz = await getPracticeTimeZone(actor.organizationId);
  const start = fromPracticeWallTime(input.date, input.startTime, tz);
  if (!start) return fail(400, 'Date or time is not valid.');
  const minutes = input.durationMinutes ?? g.defaultDurationMinutes;
  const dup = await prisma.clinicalGroupSession.findUnique({ where: { groupId_startsAt: { groupId: g.id, startsAt: start } } });
  if (dup) return fail(409, 'A session already starts at that time.');
  const s = await prisma.clinicalGroupSession.create({
    data: {
      organizationId: actor.organizationId,
      groupId: g.id,
      startsAt: start,
      endsAt: new Date(start.getTime() + minutes * 60_000),
      durationMinutes: minutes,
      telehealth: g.telehealth,
      locationId: g.locationId,
      room: g.room,
      facilitatorId: g.facilitatorId,
      coFacilitatorId: g.coFacilitatorId,
      part2: g.part2,
      createdById: actor.userId,
    },
  });
  await syncSessionAppointments(actor, g, s);
  return { ok: true as const, session: { id: s.id, startsAt: s.startsAt.toISOString() } };
}

export async function updateSessionStatus(actor: GroupActor, sessionId: string, input: { status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled'; cancelReason?: string | null }) {
  const s = await prisma.clinicalGroupSession.findFirst({ where: { id: sessionId, organizationId: actor.organizationId }, include: { group: true } });
  if (!s) return fail(404, 'Session not found');
  if (!canDocumentSession({ role: actor.role, userId: actor.userId, session: s, group: s.group })) return fail(403, 'Only the session’s facilitators or leadership can change it.');
  if (input.status === 'cancelled') {
    const notes = await prisma.clinicalGroupAttendance.count({ where: { sessionId: s.id, progressNoteId: { not: null } } });
    if (notes) return fail(409, 'This session has notes; it cannot be cancelled.');
  }
  await prisma.clinicalGroupSession.update({
    where: { id: s.id },
    data: { status: input.status, cancelReason: input.status === 'cancelled' ? input.cancelReason?.trim() || null : null },
  });
  if (input.status === 'cancelled') {
    await prisma.appointment.updateMany({ where: { groupSessionId: s.id, status: 'SCHEDULED' }, data: { status: 'CANCELLED' } });
  }
  return { ok: true as const };
}

// ─── Today's groups ──────────────────────────────────────────────────────────

export async function listTodaySessions(actor: GroupActor, kind: GroupKind, opts: { mine: boolean; date?: string | null }) {
  const tz = await getPracticeTimeZone(actor.organizationId);
  const day = opts.date || practiceToday(tz);
  const start = fromPracticeWallTime(day, '00:00', tz)!;
  const end = new Date(start.getTime() + 36 * 3_600_000);
  const nextDay = fromPracticeWallTime(new Date(start.getTime() + 30 * 3_600_000).toISOString().slice(0, 10), '00:00', tz) ?? end;
  const sessions = await prisma.clinicalGroupSession.findMany({
    where: {
      organizationId: actor.organizationId,
      group: { kind },
      startsAt: { gte: start, lt: nextDay },
      ...(opts.mine ? { OR: [{ facilitatorId: actor.userId }, { coFacilitatorId: actor.userId }] } : {}),
    },
    orderBy: { startsAt: 'asc' },
    include: { group: true, attendance: { select: { status: true, progressNoteId: true } } },
  });
  const staff = await staffNames(sessions.map((s) => s.facilitatorId));
  const counts = await prisma.clinicalGroupMember.groupBy({ by: ['groupId'], where: { groupId: { in: sessions.map((s) => s.groupId) }, status: 'active' }, _count: { _all: true } });
  const countMap = new Map(counts.map((c) => [c.groupId, c._count._all]));
  const statuses = await noteStatuses(sessions.flatMap((s) => s.attendance.map((a) => a.progressNoteId).filter((x): x is string => Boolean(x))));
  return {
    date: day,
    timeZone: tz,
    sessions: sessions.map((s) => {
      const wall = toPracticeWallTime(s.startsAt, tz);
      const attended = s.attendance.filter((a) => isAttended(a.status));
      const signed = attended.filter((a) => a.progressNoteId && ['SIGNED', 'LOCKED'].includes(statuses.get(a.progressNoteId)?.status ?? '')).length;
      return {
        id: s.id,
        groupId: s.groupId,
        groupName: s.group.name,
        groupTypeLabel: groupTypeLabel(s.group.kind as GroupKind, s.group.groupType),
        startTime: wall.time,
        startsAt: s.startsAt.toISOString(),
        durationMinutes: s.durationMinutes,
        status: s.status,
        telehealth: s.telehealth,
        room: s.room,
        facilitatorName: s.facilitatorId ? staff.get(s.facilitatorId)?.name ?? null : null,
        activeMembers: countMap.get(s.groupId) ?? 0,
        marked: s.attendance.filter((a) => a.status !== 'unmarked').length,
        attended: attended.length,
        notesSigned: signed,
        mine: isGroupFacilitator(actor.userId, s) || isGroupFacilitator(actor.userId, s.group),
      };
    }),
  };
}

// ─── Session detail (attendance + documentation) ─────────────────────────────

export type AttendeeView = {
  attendanceId: string | null;
  memberId: string | null;
  clientId: string | null;
  displayName: string;
  visible: boolean;
  status: AttendanceStatus;
  minutesAttended: number | null;
  patientLocationType: string | null;
  individual: NoteValues | null;
  note: { id: string; status: string; cosignRequired: boolean; cosignedAt: string | null; authorId: string | null } | null;
  goals: PlanGoalOption[];
  uds: LabUdsResult | null;
  confidentialityOnFile: boolean | null;
  missing: string[];
  billing: BillableLine;
  part2: boolean;
};

const DRUG_SCREEN_KEYS = BUILTIN_LAB_TESTS.filter((t) => t.category === 'drug_screen').map((t) => t.key);

/** Latest UDS / toxicology result per client from the Labs module, collected within 14 days before the session. */
async function udsResults(organizationId: string, clientIds: string[], sessionEnd: Date): Promise<Map<string, LabUdsResult>> {
  const out = new Map<string, LabUdsResult>();
  if (!clientIds.length) return out;
  try {
    const from = new Date(sessionEnd.getTime() - 14 * 86_400_000);
    const rows = await prisma.labResult.findMany({
      where: {
        order: { organizationId, clientId: { in: clientIds } },
        OR: [
          { testKey: { in: DRUG_SCREEN_KEYS } },
          { panelName: { contains: 'drug', mode: 'insensitive' } },
          { testName: { contains: 'drug screen', mode: 'insensitive' } },
          { testName: { contains: 'toxicology', mode: 'insensitive' } },
        ],
        AND: [{ OR: [{ collectedAt: { gte: from, lte: sessionEnd } }, { collectedAt: null, createdAt: { gte: from, lte: sessionEnd } }] }],
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, testName: true, value: true, flag: true, collectedAt: true, createdAt: true, order: { select: { clientId: true } } },
      take: 200,
    });
    for (const r of rows) {
      if (out.has(r.order.clientId)) continue;
      out.set(r.order.clientId, { resultId: r.id, testName: r.testName, value: r.value, flag: r.flag, collectedOn: ymd(r.collectedAt ?? r.createdAt) });
    }
  } catch {
    // Labs tables absent: the manual field stays available
  }
  return out;
}

async function planGoals(organizationId: string, clientIds: string[]): Promise<Map<string, PlanGoalOption[]>> {
  const out = new Map<string, PlanGoalOption[]>();
  if (!clientIds.length) return out;
  const plans = await prisma.treatmentPlan.findMany({
    where: { organizationId, clientId: { in: clientIds }, status: { in: ['ACTIVE', 'NEEDS_REVIEW'] } },
    orderBy: { createdAt: 'desc' },
    select: { clientId: true, goals: true },
  });
  for (const p of plans) {
    if (out.has(p.clientId)) continue;
    out.set(p.clientId, goalsSummary(p.goals).map((g) => ({ id: g.id, text: g.text })));
  }
  return out;
}

async function clientPart2(organizationId: string, clientIds: string[]): Promise<Set<string>> {
  if (!clientIds.length) return new Set();
  const rows = await prisma.sensitiveRecord.findMany({ where: { organizationId, clientId: { in: clientIds } }, select: { clientId: true, noteClassification: true } });
  return new Set(rows.filter((r) => isPart2Classification(r.noteClassification)).map((r) => r.clientId));
}

async function loadSession(actor: GroupActor, sessionId: string) {
  return prisma.clinicalGroupSession.findFirst({
    where: { id: sessionId, organizationId: actor.organizationId },
    include: { group: true, attendance: true },
  });
}

type LoadedSession = NonNullable<Awaited<ReturnType<typeof loadSession>>>;

/** Members expected at a session: active on the session date, plus anyone already marked. */
async function sessionRoster(s: LoadedSession, sessionDate: string) {
  const members = await prisma.clinicalGroupMember.findMany({
    where: {
      groupId: s.groupId,
      joinedOn: { lte: dateOnly(sessionDate) },
      OR: [{ leftOn: null }, { leftOn: { gte: dateOnly(sessionDate) } }],
    },
  });
  const ids = new Set([...members.map((m) => m.clientId), ...s.attendance.map((a) => a.clientId)]);
  return { members, clientIds: [...ids] };
}

export async function getSessionDetail(actor: GroupActor, sessionId: string, kind: GroupKind) {
  const s = await loadSession(actor, sessionId);
  if (!s || s.group.kind !== kind) return fail(404, 'Session not found');
  const g = s.group;
  const tz = await getPracticeTimeZone(actor.organizationId);
  const wall = toPracticeWallTime(s.startsAt, tz);
  const { members, clientIds } = await sessionRoster(s, wall.date);
  const clients = await loadClients(actor.organizationId, clientIds);
  const vis = await memberVisibility(actor, g, clients);
  const visibleIds = clientIds.filter((id) => vis.get(id)?.visible);
  const attByClient = new Map(s.attendance.map((a) => [a.clientId, a]));
  const memberByClient = new Map(members.map((m) => [m.clientId, m]));
  const groupSize = attendedCount(s.attendance);
  const [goals, uds, consent, statuses, staff, notes, part2Clients] = await Promise.all([
    planGoals(actor.organizationId, visibleIds),
    isPart2Group(g.kind) ? udsResults(actor.organizationId, visibleIds, s.endsAt) : Promise.resolve(new Map<string, LabUdsResult>()),
    confidentialityOnFile(actor.organizationId, visibleIds),
    noteStatuses(s.attendance.map((a) => a.progressNoteId).filter((x): x is string => Boolean(x))),
    staffNames([s.facilitatorId, s.coFacilitatorId]),
    prisma.progressNote.findMany({ where: { id: { in: s.attendance.map((a) => a.progressNoteId).filter((x): x is string => Boolean(x)) } }, select: { id: true, clinicianId: true } }),
    clientPart2(actor.organizationId, visibleIds),
  ]);
  const authorOf = new Map(notes.map((n) => [n.id, n.clinicianId]));
  const kindKey = g.kind as GroupKind;
  const attendees: AttendeeView[] = clientIds
    .map((clientId) => {
      const v = vis.get(clientId) ?? { visible: false, label: HIDDEN_MEMBER_LABEL };
      const a = attByClient.get(clientId);
      const m = memberByClient.get(clientId);
      const status = (a?.status ?? 'unmarked') as AttendanceStatus;
      const individual = v.visible ? ((a?.individualNote as NoteValues | null) ?? null) : null;
      const st = a?.progressNoteId ? statuses.get(a.progressNoteId) : undefined;
      return {
        attendanceId: a?.id ?? null,
        memberId: m?.id ?? a?.memberId ?? null,
        clientId: v.visible ? clientId : null,
        displayName: v.label,
        visible: v.visible,
        status,
        minutesAttended: a?.minutesAttended ?? null,
        patientLocationType: a?.patientLocationType ?? null,
        individual,
        note: a?.progressNoteId && v.visible
          ? { id: a.progressNoteId, status: st?.status ?? 'DRAFT', cosignRequired: st?.cosignRequired ?? false, cosignedAt: st?.cosignedAt?.toISOString() ?? null, authorId: authorOf.get(a.progressNoteId) ?? null }
          : null,
        goals: v.visible ? goals.get(clientId) ?? [] : [],
        uds: v.visible ? uds.get(clientId) ?? null : null,
        confidentialityOnFile: v.visible ? consent?.get(clientId) ?? null : null,
        missing: v.visible && isAttended(status) ? missingRequired(INDIVIDUAL_FIELDS[kindKey], individual) : [],
        billing: billableLine({ group: g, attendance: { status, minutesAttended: a?.minutesAttended ?? null }, groupSize, scheduledMinutes: s.durationMinutes }),
        part2: notePart2(g.kind, part2Clients.has(clientId)),
      };
    })
    .sort((x, y) => Number(y.visible) - Number(x.visible) || x.displayName.localeCompare(y.displayName));
  const warnings = privacyWarnings({
    shared: s.sharedNote as NoteValues | null,
    attendees: clients.filter((c) => vis.get(c.id)?.visible).map((c) => ({ clientId: c.id, name: c.name, individual: attByClient.get(c.id)?.individualNote as NoteValues | null })),
  });
  const cosign = await cosignPreview(actor);
  return {
    ok: true as const,
    timeZone: tz,
    session: {
      id: s.id,
      groupId: g.id,
      groupName: g.name,
      kind: kindKey,
      groupTypeLabel: groupTypeLabel(kindKey, g.groupType),
      date: wall.date,
      startTime: wall.time,
      startsAt: s.startsAt.toISOString(),
      durationMinutes: s.durationMinutes,
      status: s.status,
      telehealth: s.telehealth,
      room: s.room,
      topic: s.topic,
      shared: (s.sharedNote as NoteValues | null) ?? null,
      sharedMissing: missingRequired(SHARED_FIELDS[kindKey], s.sharedNote as NoteValues | null),
      groupSize,
      part2: s.part2 || isPart2Group(g.kind),
      billingCode: g.billingCode,
      billingMode: g.billingMode,
      minBillableMinutes: g.minBillableMinutes,
      maxBillableGroupSize: g.maxBillableGroupSize,
      facilitatorId: s.facilitatorId,
      facilitatorName: s.facilitatorId ? staff.get(s.facilitatorId)?.name ?? null : null,
      coFacilitatorName: s.coFacilitatorId ? staff.get(s.coFacilitatorId)?.name ?? null : null,
      signerTitle: GROUP_KIND_META[kindKey].signerTitle,
    },
    attendees,
    privacyWarnings: warnings,
    canDocument: canDocumentSession({ role: actor.role, userId: actor.userId, session: s, group: g }),
    cosignRequiredForMe: cosign,
    consentCheckAvailable: consent !== null,
    patientIds: visibleIds,
  };
}

async function cosignPreview(actor: GroupActor): Promise<boolean> {
  const [license, track] = await Promise.all([
    loadLicenseLevel(actor.organizationId, actor.userId).catch(() => null),
    prisma.supervisionTrack.findFirst({ where: { organizationId: actor.organizationId, superviseeId: actor.userId }, select: { id: true } }).catch(() => null),
  ]);
  return groupNoteCosignRequired(actor.role, Boolean(track), license?.level === 'PRE_LICENSED');
}

// ─── Attendance ──────────────────────────────────────────────────────────────

export type AttendanceMark = { clientId: string; status: AttendanceStatus; minutesAttended?: number | null; patientLocationType?: 'home' | 'other' | null };

export async function saveAttendance(actor: GroupActor, sessionId: string, marks: AttendanceMark[]) {
  const s = await loadSession(actor, sessionId);
  if (!s) return fail(404, 'Session not found');
  if (!canDocumentSession({ role: actor.role, userId: actor.userId, session: s, group: s.group })) return fail(403, 'Only the session’s facilitators or leadership can take attendance.');
  if (s.status === 'cancelled') return fail(409, 'This session was cancelled.');
  const tz = await getPracticeTimeZone(actor.organizationId);
  const { members, clientIds } = await sessionRoster(s, toPracticeWallTime(s.startsAt, tz).date);
  const allowed = new Set(clientIds);
  const clients = await loadClients(actor.organizationId, clientIds);
  const vis = await memberVisibility(actor, s.group, clients);
  const memberByClient = new Map(members.map((m) => [m.clientId, m.id]));
  const touched: string[] = [];
  const problems: string[] = [];
  for (const mark of marks) {
    if (!allowed.has(mark.clientId)) {
      problems.push('A client is not on this session’s roster.');
      continue;
    }
    if (!vis.get(mark.clientId)?.visible) {
      problems.push('A protected or out-of-scope member was skipped.');
      continue;
    }
    const existing = s.attendance.find((a) => a.clientId === mark.clientId);
    if (existing?.progressNoteId && !isAttended(mark.status)) {
      const st = (await noteStatuses([existing.progressNoteId])).get(existing.progressNoteId)?.status;
      if (st === 'SIGNED' || st === 'LOCKED') {
        problems.push('A member with a signed note cannot be marked absent or excused; correct it with an addendum.');
        continue;
      }
    }
    const data = {
      status: mark.status,
      minutesAttended: isAttended(mark.status) ? mark.minutesAttended ?? null : null,
      patientLocationType: s.telehealth ? mark.patientLocationType ?? null : null,
      markedById: actor.userId,
      markedAt: new Date(),
    };
    const row = existing
      ? await prisma.clinicalGroupAttendance.update({ where: { id: existing.id }, data })
      : await prisma.clinicalGroupAttendance.create({
          data: { organizationId: actor.organizationId, sessionId: s.id, groupId: s.groupId, clientId: mark.clientId, memberId: memberByClient.get(mark.clientId) ?? null, ...data },
        });
    // Mirror on the member's group visit (absent = no-show, excused = cancelled)
    const apptStatus = appointmentStatusForAttendance(mark.status);
    const appt = await prisma.appointment.findFirst({ where: { groupSessionId: s.id, clientId: mark.clientId }, select: { id: true } });
    if (appt) {
      await prisma.appointment.update({ where: { id: appt.id }, data: { status: apptStatus } });
      void triggerAutopayAfterVisitStatus(appt.id, apptStatus, { userId: actor.userId, role: String(actor.role) });
      if (row.appointmentId !== appt.id) await prisma.clinicalGroupAttendance.update({ where: { id: row.id }, data: { appointmentId: appt.id } });
    }
    touched.push(mark.clientId);
  }
  const all = await prisma.clinicalGroupAttendance.findMany({ where: { sessionId: s.id }, select: { status: true } });
  await prisma.clinicalGroupSession.update({
    where: { id: s.id },
    data: { groupSize: attendedCount(all), ...(s.status === 'scheduled' ? { status: 'in_progress' } : {}) },
  });
  return { ok: true as const, saved: touched.length, problems: [...new Set(problems)], patientIds: touched };
}

// ─── Notes (drafts into each client's chart) ─────────────────────────────────

export type NotesInput = {
  topic?: string | null;
  shared?: NoteValues | null;
  individuals?: { clientId: string; values: NoteValues }[];
};

async function practicePos(organizationId: string) {
  return prisma.practiceSettings
    .findUnique({ where: { organizationId }, select: { posOffice: true, posTelehealthHome: true, posTelehealthOther: true } })
    .catch(() => null);
}

/**
 * Save the shared section and individual sections, then write / refresh a DRAFT ProgressNote in
 * each attending member's chart (author = the actor). Signed notes are never rewritten.
 */
export async function saveNotes(actor: GroupActor, sessionId: string, input: NotesInput) {
  const s = await loadSession(actor, sessionId);
  if (!s) return fail(404, 'Session not found');
  if (!canDocumentSession({ role: actor.role, userId: actor.userId, session: s, group: s.group })) return fail(403, 'Only the session’s facilitators or leadership can write group notes.');
  if (s.status === 'cancelled') return fail(409, 'This session was cancelled.');
  const g = s.group;
  const kind = g.kind as GroupKind;
  if (input.shared !== undefined || input.topic !== undefined) {
    const shared = input.shared ?? (s.sharedNote as NoteValues | null) ?? {};
    await prisma.clinicalGroupSession.update({
      where: { id: s.id },
      data: {
        sharedNote: shared as Prisma.InputJsonValue,
        topic: (input.topic ?? (typeof shared.topic === 'string' ? shared.topic : null) ?? s.topic) || null,
        sharedUpdatedAt: new Date(),
        sharedUpdatedById: actor.userId,
      },
    });
  }
  const tz = await getPracticeTimeZone(actor.organizationId);
  const wall = toPracticeWallTime(s.startsAt, tz);
  const clients = await loadClients(actor.organizationId, s.attendance.map((a) => a.clientId));
  const vis = await memberVisibility(actor, g, clients);
  for (const ind of input.individuals ?? []) {
    const a = s.attendance.find((x) => x.clientId === ind.clientId);
    if (!a || !vis.get(ind.clientId)?.visible) continue;
    await prisma.clinicalGroupAttendance.update({ where: { id: a.id }, data: { individualNote: ind.values as Prisma.InputJsonValue } });
  }
  return writeDraftNotes(actor, s.id, { kind, wall, tz });
}

async function writeDraftNotes(actor: GroupActor, sessionId: string, ctx: { kind: GroupKind; wall: { date: string; time: string }; tz: string }) {
  const s = (await loadSession(actor, sessionId))!;
  const g = s.group;
  const clients = await loadClients(actor.organizationId, s.attendance.map((a) => a.clientId));
  const vis = await memberVisibility(actor, g, clients);
  const attended = s.attendance.filter((a) => isAttended(a.status) && vis.get(a.clientId)?.visible);
  const groupSize = attendedCount(s.attendance);
  const [goals, staff, pos, statuses, existingNotes, part2Clients] = await Promise.all([
    planGoals(actor.organizationId, attended.map((a) => a.clientId)),
    staffNames([actor.userId, s.coFacilitatorId, s.facilitatorId]),
    practicePos(actor.organizationId),
    noteStatuses(attended.map((a) => a.progressNoteId).filter((x): x is string => Boolean(x))),
    prisma.progressNote.findMany({ where: { id: { in: attended.map((a) => a.progressNoteId).filter((x): x is string => Boolean(x)) } }, select: { id: true, clinicianId: true } }),
    clientPart2(actor.organizationId, attended.map((a) => a.clientId)),
  ]);
  const authorOf = new Map(existingNotes.map((n) => [n.id, n.clinicianId]));
  const me = staff.get(actor.userId);
  const coName = s.coFacilitatorId && s.coFacilitatorId !== actor.userId ? staff.get(s.coFacilitatorId)?.name ?? null : s.facilitatorId && s.facilitatorId !== actor.userId ? staff.get(s.facilitatorId)?.name ?? null : null;
  const results: { clientId: string; noteId: string | null; result: 'created' | 'updated' | 'signed_unchanged' | 'other_author' }[] = [];
  for (const a of attended) {
    const individual = (a.individualNote as NoteValues | null) ?? {};
    const body = renderGroupNoteBody({
      kind: ctx.kind,
      groupName: g.name,
      groupTypeLabel: groupTypeLabel(ctx.kind, g.groupType),
      sessionDate: ctx.wall.date,
      startTime: ctx.wall.time,
      durationMinutes: s.durationMinutes,
      telehealth: s.telehealth,
      attendance: { status: a.status, minutesAttended: a.minutesAttended },
      groupSize,
      shared: s.sharedNote as NoteValues | null,
      individual,
      goals: goals.get(a.clientId) ?? [],
      facilitatorName: me?.name ?? null,
      facilitatorCredentials: me?.credentials ?? null,
      coFacilitatorName: coName,
      billingCode: g.billingMode === 'per_session' ? g.billingCode : null,
    });
    const posCode = s.telehealth
      ? resolveTelehealthPos({ patientLocationType: a.patientLocationType, settings: pos }).pos
      : pos?.posOffice || '11';
    const minutes = a.minutesAttended ?? (a.status === 'present' ? s.durationMinutes : null);
    const appt = a.appointmentId ? await prisma.appointment.findUnique({ where: { id: a.appointmentId }, select: { id: true, clinicianId: true } }) : null;
    const columns = {
      body,
      noteType: GROUP_KIND_META[ctx.kind].noteType,
      dateOfService: dateOnly(ctx.wall.date),
      durationMinutes: minutes,
      // Attendance-only groups (PRP, IOP per diem) carry no code, so no claim line is made
      cptCode: g.billingMode === 'per_session' ? g.billingCode : null,
      placeOfService: posCode ?? null,
      telehealth: s.telehealth,
      part2: notePart2(g.kind, part2Clients.has(a.clientId)),
      // Linked only when the author is the visit's clinician (claims cross-check clinician + date)
      appointmentId: appt && appt.clinicianId === actor.userId ? appt.id : null,
    };
    if (a.progressNoteId) {
      const st = statuses.get(a.progressNoteId)?.status;
      if (st === 'SIGNED' || st === 'LOCKED') {
        results.push({ clientId: a.clientId, noteId: a.progressNoteId, result: 'signed_unchanged' });
        continue;
      }
      if (authorOf.get(a.progressNoteId) && authorOf.get(a.progressNoteId) !== actor.userId && !isGroupLeadership(actor.role)) {
        results.push({ clientId: a.clientId, noteId: a.progressNoteId, result: 'other_author' });
        continue;
      }
      await prisma.progressNote.update({ where: { id: a.progressNoteId }, data: columns });
      results.push({ clientId: a.clientId, noteId: a.progressNoteId, result: 'updated' });
    } else {
      const note = await prisma.progressNote.create({ data: { clientId: a.clientId, clinicianId: actor.userId, ...columns } });
      await prisma.clinicalGroupAttendance.update({ where: { id: a.id }, data: { progressNoteId: note.id } });
      results.push({ clientId: a.clientId, noteId: note.id, result: 'created' });
    }
  }
  return { ok: true as const, notes: results, patientIds: results.map((r) => r.clientId) };
}

// ─── Sign (individually or all) ──────────────────────────────────────────────

export type SignResult = {
  clientId: string;
  ok: boolean;
  error?: string;
  noteId?: string;
  cosignRequired?: boolean;
  claim?: { created: boolean; id?: string; blocked?: string } | null;
};

/**
 * Sign each attendee's note through the normal note workflow (attestation, author-only signature,
 * treatment-plan gate, co-signature for pre-licensed / supervised authors), then hand each signed
 * note to the existing claim builder (generateClaimFromNote), which applies the group billing rule.
 */
export async function signNotes(actor: GroupActor, sessionId: string, input: { clientIds?: string[] | null; attested: boolean; lateEntryReason?: string | null }) {
  if (input.attested !== true) return fail(400, 'Confirm the attestation before signing.');
  const s = await loadSession(actor, sessionId);
  if (!s) return fail(404, 'Session not found');
  if (!canDocumentSession({ role: actor.role, userId: actor.userId, session: s, group: s.group })) return fail(403, 'Only the session’s facilitators can sign group notes.');
  const kind = s.group.kind as GroupKind;
  const sharedMissing = missingRequired(SHARED_FIELDS[kind], s.sharedNote as NoteValues | null);
  if (sharedMissing.length) return fail(400, `Complete the shared group section first: ${sharedMissing.join(', ')}.`);
  const tz = await getPracticeTimeZone(actor.organizationId);
  // Refresh drafts so the signed text matches the latest shared + individual sections
  const refreshed = await writeDraftNotes(actor, s.id, { kind, wall: toPracticeWallTime(s.startsAt, tz), tz });
  const fresh = (await loadSession(actor, s.id))!;
  const wanted = input.clientIds?.length ? new Set(input.clientIds) : null;
  const targets = fresh.attendance.filter((a) => isAttended(a.status) && a.progressNoteId && (!wanted || wanted.has(a.clientId)));
  const results: SignResult[] = [];
  for (const a of targets) {
    if (refreshed.notes.find((n) => n.clientId === a.clientId)?.result === 'other_author') {
      results.push({ clientId: a.clientId, ok: false, error: 'Another facilitator wrote this draft; only its author can sign it.' });
      continue;
    }
    const missing = missingRequired(INDIVIDUAL_FIELDS[kind], a.individualNote as NoteValues | null);
    if (missing.length) {
      results.push({ clientId: a.clientId, ok: false, error: `Missing: ${missing.join(', ')}.` });
      continue;
    }
    const wf = await updateProgressNoteWorkflow({
      noteId: a.progressNoteId!,
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      status: 'Signed',
      attested: true,
      // Required group fields, attendance, minutes and POS are validated above
      source: 'group_session',
      // Required only for notes signed after the practice deadline
      lateEntryReason: input.lateEntryReason ?? null,
    });
    if (!wf.ok) {
      results.push({ clientId: a.clientId, ok: false, error: (wf as { error: string }).error, noteId: a.progressNoteId! });
      continue;
    }
    let claim: SignResult['claim'] = null;
    try {
      const c = await generateClaimFromNote({ organizationId: actor.organizationId, actorUserId: actor.userId, actorRole: actor.role }, a.progressNoteId!);
      claim = c.ok ? { created: !c.alreadyExisted, id: c.claim.id } : { created: false, blocked: c.error };
    } catch (err) {
      console.error('[group note claim]', err instanceof Error ? err.name : 'error');
      claim = { created: false, blocked: 'Claim could not be created; billing can create it from the signed note.' };
    }
    await watchProgressNote({ noteId: a.progressNoteId!, organizationId: actor.organizationId, actorUserId: actor.userId, actorRole: actor.role });
    results.push({ clientId: a.clientId, ok: true, noteId: a.progressNoteId!, cosignRequired: wf.cosignRequired, claim });
  }
  // All attended members signed: the session is complete
  const statuses = await noteStatuses(fresh.attendance.map((a) => a.progressNoteId).filter((x): x is string => Boolean(x)));
  const allSigned = fresh.attendance
    .filter((a) => isAttended(a.status))
    .every((a) => a.progressNoteId && ['SIGNED', 'LOCKED'].includes(statuses.get(a.progressNoteId)?.status ?? ''));
  if (allSigned && fresh.attendance.some((a) => a.status !== 'unmarked')) {
    await prisma.clinicalGroupSession.update({ where: { id: s.id }, data: { status: 'completed' } });
  }
  return { ok: true as const, results, patientIds: results.map((r) => r.clientId) };
}

// ─── Attendance report (group detail tab) ────────────────────────────────────

export async function groupAttendanceReport(actor: GroupActor, groupId: string, kind: GroupKind, range: { from: Date; to: Date }) {
  const g = await loadGroup(actor, groupId, kind);
  if (!g) return fail(404, 'Group not found');
  const sessions = await prisma.clinicalGroupSession.findMany({
    where: { groupId: g.id, startsAt: { gte: range.from, lt: range.to } },
    select: { id: true, groupId: true, status: true, groupSize: true, attendance: { select: { clientId: true, status: true, progressNoteId: true } } },
  });
  const att = sessions.flatMap((s) => s.attendance.map((a) => ({ ...a, sessionId: s.id, groupId: s.groupId })));
  const noteIds = att.map((a) => a.progressNoteId).filter((x): x is string => Boolean(x));
  const [statuses, claims] = await Promise.all([
    noteStatuses(noteIds),
    prisma.claim.findMany({ where: { progressNoteId: { in: noteIds } }, select: { id: true, progressNoteId: true } }),
  ]);
  const claimBy = new Map(claims.map((c) => [c.progressNoteId, c.id]));
  const rows = att.map((a) => ({
    sessionId: a.sessionId,
    groupId: a.groupId,
    clientId: a.clientId,
    status: a.status,
    hasNote: Boolean(a.progressNoteId),
    noteSigned: a.progressNoteId ? ['SIGNED', 'LOCKED'].includes(statuses.get(a.progressNoteId)?.status ?? '') : false,
    claimId: a.progressNoteId ? claimBy.get(a.progressNoteId) ?? null : null,
  }));
  const [summary] = aggregateGroupReport(sessions.map((s) => ({ id: s.id, groupId: s.groupId, status: s.status, groupSize: s.groupSize })), rows);
  const clients = await loadClients(actor.organizationId, [...new Set(rows.map((r) => r.clientId))]);
  const vis = await memberVisibility(actor, g, clients);
  const perMember = memberAttendanceRows(rows).map((r) => {
    const v = vis.get(r.clientId) ?? { visible: false, label: HIDDEN_MEMBER_LABEL };
    return { ...r, clientId: v.visible ? r.clientId : null, displayName: v.label };
  });
  return {
    ok: true as const,
    summary: summary ?? aggregateGroupReport([], [])[0] ?? null,
    members: perMember,
    patientIds: perMember.map((m) => m.clientId).filter((x): x is string => Boolean(x)),
  };
}
