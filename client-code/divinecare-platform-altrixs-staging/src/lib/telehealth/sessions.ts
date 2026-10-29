import type {
  RiskLevel,
  Role,
  TelehealthPlatform,
  TelehealthSessionStatus,
} from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { canAccessClientAppointments, clientAccessWhere } from '@/lib/clients/orgScope';
import { isCaseloadScoped } from '@/lib/auth/medicalDirector';

export type TeleStatusUi = 'upcoming' | 'in_progress' | 'completed' | 'cancelled';
export type TelePlatformUi = 'zoom' | 'doxy' | 'google' | 'teams' | 'phone' | 'chime';

const STATUS_UI: Record<TelehealthSessionStatus, TeleStatusUi> = {
  UPCOMING: 'upcoming',
  IN_PROGRESS: 'in_progress',
  CHECKED_IN: 'upcoming',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
};
const STATUS_DB: Record<string, TelehealthSessionStatus> = {
  upcoming: 'UPCOMING',
  in_progress: 'IN_PROGRESS',
  checked_in: 'CHECKED_IN',
  completed: 'COMPLETED',
  cancelled: 'CANCELLED',
};

const PLATFORM_UI: Record<TelehealthPlatform, TelePlatformUi> = {
  ZOOM: 'zoom',
  DOXY: 'doxy',
  GOOGLE: 'google',
  TEAMS: 'teams',
  PHONE: 'phone',
  CHIME: 'chime',
};
const PLATFORM_DB: Record<string, TelehealthPlatform> = {
  zoom: 'ZOOM',
  doxy: 'DOXY',
  'doxy.me': 'DOXY',
  google: 'GOOGLE',
  teams: 'TEAMS',
  phone: 'PHONE',
  chime: 'CHIME',
  video: 'CHIME',
};

const RISK_UI = { HIGH: 'high', MEDIUM: 'medium', LOW: 'low' } as const;

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function localYmd(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dayBounds(ymd: string) {
  return {
    start: new Date(`${ymd}T00:00:00`),
    end: new Date(`${ymd}T23:59:59.999`),
  };
}

function todayYmd() {
  return localYmd(new Date());
}

function serializeSession(row: {
  id: string;
  clientId: string;
  clientName: string;
  clinicianId: string | null;
  clinicianName: string | null;
  type: string;
  sessionDate: Date;
  startTime: string;
  durationMin: number;
  status: TelehealthSessionStatus;
  platform: TelehealthPlatform;
  roomId: string | null;
  joinUrl: string | null;
  riskLevel: RiskLevel;
  rating: number | null;
  notesSummary: string | null;
}) {
  return {
    id: row.id,
    clientId: row.clientId,
    clientName: row.clientName,
    clinicianId: row.clinicianId,
    clinicianName: row.clinicianName,
    type: row.type,
    sessionDate: localYmd(row.sessionDate),
    startTime: row.startTime,
    durationMin: row.durationMin,
    status: STATUS_UI[row.status],
    platform: PLATFORM_UI[row.platform],
    roomId: row.roomId,
    joinUrl: row.joinUrl,
    riskLevel: RISK_UI[row.riskLevel],
    rating: row.rating,
    notesSummary: row.notesSummary,
  };
}

export type TeleSessionDto = ReturnType<typeof serializeSession>;

function orgWhere(organizationId: string, actor: { id: string; role: Role }) {
  return {
    organizationId,
    client: clientAccessWhere({
      organizationId,
      actorUserId: actor.id,
      actorRole: actor.role,
    }),
  };
}

export async function listTelehealthSessions(
  actor: { id: string; role: Role; organizationId: string },
  scope: 'today' | 'upcoming' | 'history' | 'all' = 'all'
) {
  if (!canAccessClientAppointments(actor.role)) return [];

  const today = todayYmd();
  const { start, end } = dayBounds(today);
  const base = orgWhere(actor.organizationId, actor);

  let where = { ...base } as Record<string, unknown>;
  if (scope === 'today') {
    where = {
      ...base,
      sessionDate: { gte: start, lte: end },
      status: { in: ['UPCOMING', 'IN_PROGRESS'] as TelehealthSessionStatus[] },
    };
  } else if (scope === 'upcoming') {
    where = {
      ...base,
      sessionDate: { gt: end },
      status: 'UPCOMING',
    };
  } else if (scope === 'history') {
    where = {
      ...base,
      OR: [
        { status: 'COMPLETED' },
        { sessionDate: { lt: start }, status: { not: 'CANCELLED' } },
      ],
    };
  }

  const rows = await prisma.telehealthSession.findMany({
    where,
    orderBy: [{ sessionDate: scope === 'history' ? 'desc' : 'asc' }, { startTime: 'asc' }],
    take: 200,
  });
  return rows.map(serializeSession);
}

export async function telehealthStats(actor: {
  id: string;
  role: Role;
  organizationId: string;
}) {
  if (!canAccessClientAppointments(actor.role)) {
    return { sessionsToday: 0, sessionsWeek: 0, avgDuration: 0, satisfaction: null as number | null };
  }

  const today = todayYmd();
  const { start, end } = dayBounds(today);
  const weekStart = new Date(start);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);
  weekEnd.setMilliseconds(-1);

  const base = orgWhere(actor.organizationId, actor);

  const [sessionsToday, weekRows, rated] = await Promise.all([
    prisma.telehealthSession.count({
      where: {
        ...base,
        sessionDate: { gte: start, lte: end },
        status: { not: 'CANCELLED' },
      },
    }),
    prisma.telehealthSession.findMany({
      where: {
        ...base,
        sessionDate: { gte: weekStart, lte: weekEnd },
        status: { not: 'CANCELLED' },
      },
      select: { durationMin: true },
    }),
    prisma.telehealthSession.findMany({
      where: { ...base, rating: { not: null } },
      select: { rating: true },
      take: 100,
      orderBy: { sessionDate: 'desc' },
    }),
  ]);

  const avgDuration = weekRows.length
    ? Math.round(
        weekRows.reduce((s, r) => s + r.durationMin, 0) / weekRows.length
      )
    : 0;
  const satisfaction = rated.length
    ? Math.round(
        (rated.reduce((s, r) => s + (r.rating || 0), 0) / rated.length) * 10
      ) / 10
    : null;

  return {
    sessionsToday,
    sessionsWeek: weekRows.length,
    avgDuration,
    satisfaction,
  };
}

function makeRoomId(clientName: string) {
  const slug = clientName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24);
  return `dcl-${slug || 'session'}-${Math.random().toString(36).slice(2, 6)}`;
}

export async function createTelehealthSession(
  actor: { id: string; role: Role; organizationId: string },
  input: {
    clientId: string;
    type: string;
    platform: string;
    sessionDate: string;
    startTime: string;
    durationMin?: number;
    clinicianId?: string | null;
  }
) {
  if (!canAccessClientAppointments(actor.role)) {
    return { ok: false as const, status: 403, error: 'Forbidden' };
  }

  const client = await prisma.client.findFirst({
    where: {
      id: input.clientId,
      ...clientAccessWhere({
        organizationId: actor.organizationId,
        actorUserId: actor.id,
        actorRole: actor.role,
      }),
    },
  });
  if (!client) return { ok: false as const, status: 404, error: 'Client not found' };

  const platform = PLATFORM_DB[input.platform.toLowerCase()] || 'ZOOM';
  const sessionDate = new Date(`${input.sessionDate}T12:00:00`);
  if (Number.isNaN(sessionDate.getTime())) {
    return { ok: false as const, status: 400, error: 'Invalid date' };
  }

  let clinicianName: string | null = null;
  // A caseload clinician (e.g. a treatment-team psychiatrist) books themselves unless they pick someone
  let clinicianId = isCaseloadScoped({ role: actor.role, userId: actor.id, organizationId: actor.organizationId })
    ? input.clinicianId || actor.id
    : input.clinicianId || client.assignedToId || actor.id;
  const clinician = await prisma.user.findFirst({
    where: { id: clinicianId, organizationId: actor.organizationId },
  });
  if (!clinician) {
    return { ok: false as const, status: 400, error: 'Clinician not found' };
  }
  clinicianName = clinician.name;
  clinicianId = clinician.id;

  const roomId = makeRoomId(client.name);
  const joinUrl =
    platform === 'DOXY'
      ? `https://doxy.me/${roomId}`
      : `https://zoom.us/j/${roomId.replace(/\D/g, '').padEnd(10, '0').slice(0, 10)}`;

  const row = await prisma.telehealthSession.create({
    data: {
      organizationId: actor.organizationId,
      clientId: client.id,
      clientName: client.name,
      clinicianId,
      clinicianName,
      type: input.type.trim() || 'Individual Therapy',
      sessionDate,
      startTime: input.startTime,
      durationMin: input.durationMin || 50,
      status: 'UPCOMING',
      platform,
      roomId,
      joinUrl,
      riskLevel: client.riskLevel,
    },
  });

  return { ok: true as const, session: serializeSession(row) };
}

export async function patchTelehealthSession(
  id: string,
  actor: { id: string; role: Role; organizationId: string },
  patch: { status?: string; notesSummary?: string | null; rating?: number | null }
) {
  if (!canAccessClientAppointments(actor.role)) {
    return { ok: false as const, status: 403, error: 'Forbidden' };
  }

  const existing = await prisma.telehealthSession.findFirst({
    where: { id, ...orgWhere(actor.organizationId, actor) },
  });
  if (!existing) return { ok: false as const, status: 404, error: 'Session not found' };

  const data: {
    status?: TelehealthSessionStatus;
    notesSummary?: string | null;
    rating?: number | null;
    roomId?: string;
    joinUrl?: string | null;
  } = {};

  if (patch.status) {
    const st = STATUS_DB[patch.status];
    if (!st) return { ok: false as const, status: 400, error: 'Invalid status' };
    data.status = st;
    if (st === 'IN_PROGRESS' && !existing.roomId) {
      data.roomId = makeRoomId(existing.clientName);
      data.joinUrl =
        existing.platform === 'DOXY'
          ? `https://doxy.me/${data.roomId}`
          : `https://zoom.us/j/${data.roomId.replace(/\D/g, '').padEnd(10, '0').slice(0, 10)}`;
    }
  }
  if (patch.notesSummary !== undefined) data.notesSummary = patch.notesSummary;
  if (patch.rating !== undefined) data.rating = patch.rating;

  const row = await prisma.telehealthSession.update({
    where: { id },
    data,
  });
  return { ok: true as const, session: serializeSession(row) };
}

export async function sendTelehealthLink(
  id: string,
  actor: { id: string; role: Role; organizationId: string }
) {
  const existing = await prisma.telehealthSession.findFirst({
    where: { id, ...orgWhere(actor.organizationId, actor) },
  });
  if (!existing) return { ok: false as const, status: 404, error: 'Session not found' };

  let roomId = existing.roomId;
  let joinUrl = existing.joinUrl;
  if (!roomId) {
    roomId = makeRoomId(existing.clientName);
    joinUrl =
      existing.platform === 'DOXY'
        ? `https://doxy.me/${roomId}`
        : `https://zoom.us/j/${roomId.replace(/\D/g, '').padEnd(10, '0').slice(0, 10)}`;
    await prisma.telehealthSession.update({
      where: { id },
      data: { roomId, joinUrl },
    });
  }

  return {
    ok: true as const,
    sessionId: id,
    roomId,
    joinUrl,
    message: `Link sent to ${existing.clientName}`,
  };
}

export async function getTelehealthSettings(organizationId: string) {
  let row = await prisma.telehealthSettings.findUnique({
    where: { organizationId },
  });
  if (!row) {
    row = await prisma.telehealthSettings.create({
      data: {
        organizationId,
        defaultPlatform: 'ZOOM',
        reminderMinutes: 15,
        recordingMode: 'off',
        autoSendLinkMinutes: 60,
        waitingRoom: true,
        platformsJson: { zoom: true, doxy: true, google: false, teams: false, phone: true },
      },
    });
  }
  const platforms = (row.platformsJson || {}) as Record<string, boolean>;
  return {
    defaultPlatform: PLATFORM_UI[row.defaultPlatform],
    reminderMinutes: row.reminderMinutes,
    recordingMode: row.recordingMode,
    autoSendLinkMinutes: row.autoSendLinkMinutes,
    waitingRoom: row.waitingRoom,
    platforms: {
      zoom: Boolean(platforms.zoom),
      doxy: Boolean(platforms.doxy),
      google: Boolean(platforms.google),
      teams: Boolean(platforms.teams),
      phone: Boolean(platforms.phone),
    },
  };
}

export async function putTelehealthSettings(
  organizationId: string,
  input: {
    defaultPlatform?: string;
    reminderMinutes?: number;
    recordingMode?: string;
    autoSendLinkMinutes?: number;
    waitingRoom?: boolean;
    platforms?: Record<string, boolean>;
  }
) {
  const defaultPlatform =
    PLATFORM_DB[(input.defaultPlatform || 'zoom').toLowerCase()] || 'ZOOM';
  const row = await prisma.telehealthSettings.upsert({
    where: { organizationId },
    create: {
      organizationId,
      defaultPlatform,
      reminderMinutes: input.reminderMinutes ?? 15,
      recordingMode: input.recordingMode ?? 'off',
      autoSendLinkMinutes: input.autoSendLinkMinutes ?? 60,
      waitingRoom: input.waitingRoom ?? true,
      platformsJson: input.platforms ?? {
        zoom: true,
        doxy: true,
        google: false,
        teams: false,
        phone: true,
      },
    },
    update: {
      defaultPlatform,
      reminderMinutes: input.reminderMinutes,
      recordingMode: input.recordingMode,
      autoSendLinkMinutes: input.autoSendLinkMinutes,
      waitingRoom: input.waitingRoom,
      platformsJson: input.platforms,
    },
  });
  return getTelehealthSettings(organizationId);
}
