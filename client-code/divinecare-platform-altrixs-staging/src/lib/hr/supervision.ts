import type { Role, SupervisionSessionType, UserStatus } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';

/**
 * Same roles as the /dashboard/hr/supervision page (roleAccess PATH_ACCESS). Practice Director was
 * missing (page opened, GET answered 403). Office Manager opens the page but only sees logs where
 * they are supervisor or supervisee (not in HR_CORE_ROLES): minimum necessary.
 */
export const SUPERVISION_ACCESS_ROLES: Role[] = [
  'ADMIN',
  'DIRECTOR',
  'PRACTICE_DIRECTOR',
  'HR',
  'OFFICE_MANAGER',
  'CLINICIAN',
  'THERAPIST',
  'PSYCHIATRIST',
  'NP',
];

/** Org-wide supervision logs: leadership (incl. Practice Director) and HR. */
export const HR_CORE_ROLES: Role[] = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'HR'];

export const SESSION_TYPES: SupervisionSessionType[] = ['Individual', 'Triadic', 'Group'];

export function hoursFromMinutes(durationMin: number) {
  return Math.round((durationMin / 60) * 100) / 100;
}

export function bothSigned(log: {
  signedBySupervisorAt: Date | string | null;
  signedBySuperviseeAt: Date | string | null;
}) {
  return Boolean(log.signedBySupervisorAt && log.signedBySuperviseeAt);
}

function isMissingTableError(err: unknown) {
  const code =
    typeof err === 'object' && err && 'code' in err ? String((err as { code: unknown }).code) : '';
  const message = err instanceof Error ? err.message : String(err);
  return code === 'P2021' || code === 'P2010' || /does not exist/i.test(message);
}

export function canAccessSupervision(role: Role | undefined | null) {
  return Boolean(role && SUPERVISION_ACCESS_ROLES.includes(role));
}

export function canSeeAllSupervisionLogs(role: Role | undefined | null) {
  return Boolean(role && HR_CORE_ROLES.includes(role));
}

export type SupervisionActor = {
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
};

export type SupervisionLogItem = {
  id: string;
  organizationId: string;
  supervisorId: string;
  supervisorName: string;
  superviseeId: string;
  superviseeName: string;
  sessionAt: string;
  sessionType: SupervisionSessionType;
  durationMin: number;
  hoursTowardLicensure: number;
  hoursCredited: number;
  topics: string;
  clientRefs: string[];
  signedBySupervisorAt: string | null;
  signedBySuperviseeAt: string | null;
  createdAt: string;
};

export type SupervisionTrackItem = {
  id: string;
  superviseeId: string;
  superviseeName: string;
  supervisorId: string;
  supervisorName: string;
  licenseTrack: string;
  targetLicense: string;
  requiredHours: number;
  startedAt: string;
};

export type SupervisionStaffOption = {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
};

function parseSessionAt(value: string) {
  const d = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function displayName(user: { name: string | null; email: string }) {
  return user.name?.trim() || user.email;
}

function serialize(row: {
  id: string;
  organizationId: string;
  supervisorId: string;
  superviseeId: string;
  sessionAt: Date;
  sessionType: SupervisionSessionType;
  durationMin: number;
  topics: string;
  clientRefs: string[];
  signedBySupervisorAt: Date | null;
  signedBySuperviseeAt: Date | null;
  createdAt: Date;
  supervisor: { name: string | null; email: string };
  supervisee: { name: string | null; email: string };
}): SupervisionLogItem {
  const hours = hoursFromMinutes(row.durationMin);
  const credited = bothSigned(row);
  return {
    id: row.id,
    organizationId: row.organizationId,
    supervisorId: row.supervisorId,
    supervisorName: displayName(row.supervisor),
    superviseeId: row.superviseeId,
    superviseeName: displayName(row.supervisee),
    sessionAt: row.sessionAt.toISOString(),
    sessionType: row.sessionType,
    durationMin: row.durationMin,
    hoursTowardLicensure: hours,
    hoursCredited: credited ? hours : 0,
    topics: row.topics,
    clientRefs: row.clientRefs,
    signedBySupervisorAt: row.signedBySupervisorAt?.toISOString() ?? null,
    signedBySuperviseeAt: row.signedBySuperviseeAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Minimum necessary: the cases discussed (clientRefs: client names / initials) and the free-text
 * topics are clinical content for the supervisor and supervisee. Anyone else who can list the log
 * (HR, leadership checking licensure hours) gets hours, dates and signatures only.
 */
export function redactSupervisionForViewer(item: SupervisionLogItem, viewerUserId: string): SupervisionLogItem {
  if (item.supervisorId === viewerUserId || item.superviseeId === viewerUserId) return item;
  return { ...item, topics: '', clientRefs: [] };
}

const includePeople = {
  supervisor: { select: { name: true, email: true } },
  supervisee: { select: { name: true, email: true } },
} as const;

function listWhere(actor: SupervisionActor) {
  if (canSeeAllSupervisionLogs(actor.actorRole)) {
    return { organizationId: actor.organizationId };
  }
  return {
    organizationId: actor.organizationId,
    OR: [{ supervisorId: actor.actorUserId }, { superviseeId: actor.actorUserId }],
  };
}

export async function listSupervisionStaff(organizationId: string) {
  const users = await prisma.user.findMany({
    where: { organizationId },
    select: { id: true, name: true, email: true, role: true, status: true },
    orderBy: { name: 'asc' },
    take: 200,
  });
  return users.map((u) => ({
    id: u.id,
    name: u.name?.trim() || u.email,
    email: u.email,
    role: u.role,
    status: u.status,
  })) satisfies SupervisionStaffOption[];
}

export async function listSupervisionTracks(actor: SupervisionActor) {
  try {
    const rows = await prisma.supervisionTrack.findMany({
      where: canSeeAllSupervisionLogs(actor.actorRole)
        ? { organizationId: actor.organizationId }
        : {
            organizationId: actor.organizationId,
            OR: [{ supervisorId: actor.actorUserId }, { superviseeId: actor.actorUserId }],
          },
      include: {
        supervisee: { select: { name: true, email: true } },
        supervisor: { select: { name: true, email: true } },
      },
      orderBy: { supervisee: { name: 'asc' } },
    });
    return {
      ok: true as const,
      tracks: rows.map(
        (row): SupervisionTrackItem => ({
          id: row.id,
          superviseeId: row.superviseeId,
          superviseeName: displayName(row.supervisee),
          supervisorId: row.supervisorId,
          supervisorName: displayName(row.supervisor),
          licenseTrack: row.licenseTrack,
          targetLicense: row.targetLicense,
          requiredHours: row.requiredHours,
          startedAt: row.startedAt.toISOString(),
        })
      ),
      schemaReady: true,
    };
  } catch (err) {
    if (isMissingTableError(err)) {
      return { ok: true as const, tracks: [] as SupervisionTrackItem[], schemaReady: false };
    }
    throw err;
  }
}

export async function listSupervisionLogs(actor: SupervisionActor) {
  try {
    const rows = await prisma.supervisionLog.findMany({
      where: listWhere(actor),
      include: includePeople,
      orderBy: { sessionAt: 'desc' },
      take: 400,
    });
    return {
      ok: true as const,
      logs: rows.map((row) => redactSupervisionForViewer(serialize(row), actor.actorUserId)),
      schemaReady: true,
    };
  } catch (err) {
    if (isMissingTableError(err)) {
      return { ok: true as const, logs: [] as SupervisionLogItem[], schemaReady: false };
    }
    throw err;
  }
}

export async function createSupervisionLog(
  actor: SupervisionActor,
  input: {
    superviseeId: string;
    supervisorId?: string;
    sessionAt: string;
    sessionType?: SupervisionSessionType;
    durationMin: number;
    topics: string;
    clientRefs?: string[];
  }
) {
  let trackSupervisorId: string | undefined;
  try {
    const track = await prisma.supervisionTrack.findFirst({
      where: { organizationId: actor.organizationId, superviseeId: input.superviseeId },
      select: { supervisorId: true },
    });
    trackSupervisorId = track?.supervisorId;
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
  }

  const supervisorId = canSeeAllSupervisionLogs(actor.actorRole)
    ? input.supervisorId || trackSupervisorId || actor.actorUserId
    : actor.actorUserId;

  if (supervisorId === input.superviseeId) {
    return {
      ok: false as const,
      error: 'Supervisor and supervisee must be different people',
      status: 400 as const,
    };
  }

  const [supervisor, supervisee] = await Promise.all([
    prisma.user.findFirst({
      where: { id: supervisorId, organizationId: actor.organizationId },
      select: { id: true },
    }),
    prisma.user.findFirst({
      where: { id: input.superviseeId, organizationId: actor.organizationId },
      select: { id: true },
    }),
  ]);
  if (!supervisor || !supervisee) {
    return { ok: false as const, error: 'Staff member not found', status: 404 as const };
  }

  const sessionAt = parseSessionAt(input.sessionAt);
  if (!sessionAt) {
    return { ok: false as const, error: 'Invalid session date', status: 400 as const };
  }
  if (input.durationMin < 15 || input.durationMin > 480) {
    return { ok: false as const, error: 'Duration must be between 15 and 480 minutes', status: 400 as const };
  }

  const sessionType = input.sessionType && SESSION_TYPES.includes(input.sessionType)
    ? input.sessionType
    : 'Individual';

  const row = await prisma.supervisionLog.create({
    data: {
      organizationId: actor.organizationId,
      supervisorId: supervisor.id,
      superviseeId: supervisee.id,
      sessionAt,
      sessionType,
      durationMin: Math.trunc(input.durationMin),
      topics: input.topics.trim(),
      clientRefs: (input.clientRefs ?? []).map((c) => c.trim()).filter(Boolean),
      signedBySupervisorAt: new Date(),
    },
    include: includePeople,
  });
  return { ok: true as const, log: redactSupervisionForViewer(serialize(row), actor.actorUserId) };
}

export async function signSupervisionLog(
  actor: SupervisionActor,
  id: string,
  as: 'supervisor' | 'supervisee'
) {
  const existing = await prisma.supervisionLog.findFirst({
    where: { id, ...listWhere(actor) },
    include: includePeople,
  });
  if (!existing) {
    return { ok: false as const, error: 'Supervision log not found', status: 404 as const };
  }

  // Only the people in the session sign it: no HR / leadership sign-off on someone's behalf
  if (as === 'supervisor') {
    if (existing.supervisorId !== actor.actorUserId) {
      return { ok: false as const, error: 'Only the supervisor can sign this log', status: 403 as const };
    }
    if (existing.signedBySupervisorAt) {
      return { ok: true as const, log: serialize(existing) };
    }
    const row = await prisma.supervisionLog.update({
      where: { id: existing.id },
      data: { signedBySupervisorAt: new Date() },
      include: includePeople,
    });
    return { ok: true as const, log: serialize(row) };
  }

  if (existing.superviseeId !== actor.actorUserId) {
    return { ok: false as const, error: 'Only the supervisee can sign this log', status: 403 as const };
  }
  if (!existing.signedBySupervisorAt) {
    return {
      ok: false as const,
      error: 'Supervisor must sign before the supervisee',
      status: 400 as const,
    };
  }
  if (existing.signedBySuperviseeAt) {
    return { ok: true as const, log: serialize(existing) };
  }
  const row = await prisma.supervisionLog.update({
    where: { id: existing.id },
    data: { signedBySuperviseeAt: new Date() },
    include: includePeople,
  });
  return { ok: true as const, log: serialize(row) };
}
