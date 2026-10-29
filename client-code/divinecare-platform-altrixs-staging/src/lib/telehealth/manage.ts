import type {
  AppointmentStatus,
  Prisma,
  RiskLevel,
  Role,
  TelehealthPlatform,
  TelehealthSessionStatus,
} from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { canAccessClientAppointments, careTeamClientWhereForRole, clientAccessWhere, clientOrgFilter } from '@/lib/clients/orgScope';
import { caseloadAllows } from '@/lib/clients/caseloadAccess';
import { isMedicalRole } from '@/types/roles';
import { sendTelehealthJoinEmail } from '@/lib/telehealth/email';
import { isGoogleMeetConfigured } from '@/lib/telehealth/googleMeet';
import { clientTelehealthJoinUrl } from '@/lib/telehealth/joinUrl';
import {
  notesForStaffUi,
  parseTelehealthMeta,
  staffHostMeetingUrl,
  writeTelehealthMeta,
  type TelehealthMeta,
} from '@/lib/telehealth/meta';
import {
  isRealJoinUrl,
  provisionTelehealthMeeting,
  sessionStartAt,
} from '@/lib/telehealth/meeting';
import { isZoomConfigured } from '@/lib/telehealth/zoom';
import { getAppBaseUrl } from '@/lib/staff/invite';
import { createTelehealthJoinToken } from '@/lib/telehealth/join-token';
import { sendToUser } from '@/lib/notifications/pushService';
import { sendPatientSms } from '@/lib/sms/patientSms';
import { triggerAutopayAfterVisitStatus } from '@/lib/patientPayments/visitTrigger';
import { telehealthScheduledSms } from '@/lib/sms/templates';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import {
  appointmentWallTime,
  formatSessionTiming,
  practiceDayRange,
  practiceWeekRange,
  sessionDateValue,
  sessionDateYmd,
} from '@/lib/telehealth/practiceTiming';
import { isCaseloadScoped } from '@/lib/auth/medicalDirector';

export type SessionStatusUi = 'upcoming' | 'in_progress' | 'completed' | 'cancelled';
export type PlatformUi = 'zoom' | 'doxy' | 'google' | 'teams' | 'phone' | 'chime';

const STATUS_UI: Record<TelehealthSessionStatus, SessionStatusUi> = {
  UPCOMING: 'upcoming',
  CHECKED_IN: 'upcoming',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
};
const STATUS_DB: Record<string, TelehealthSessionStatus> = {
  upcoming: 'UPCOMING',
  checked_in: 'CHECKED_IN',
  in_progress: 'IN_PROGRESS',
  completed: 'COMPLETED',
  cancelled: 'CANCELLED',
};

const PLATFORM_UI: Record<TelehealthPlatform, PlatformUi> = {
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

// Day / week ranges and session times are on the PRACTICE clock (see practiceTiming.ts). The old
// `new Date('…T00:00:00')` / setHours() helpers ran on the server's UTC clock, so "today" began
// at 8 PM ET the previous evening and appointment times printed as 13:00 for a 9:00 AM ET visit.

export type TelehealthSessionDto = {
  id: string;
  clientId: string;
  clientName: string;
  clinicianId: string | null;
  clinicianName: string | null;
  type: string;
  sessionDate: string;
  startTime: string;
  durationMin: number;
  status: SessionStatusUi;
  platform: PlatformUi;
  roomId: string | null;
  joinUrl: string | null;
  hostUrl: string | null;
  source: 'session' | 'appointment';
  /** Appointment behind the row: the row itself for 'appointment', the linked appointment (if any) for 'session' */
  appointmentId?: string | null;
  riskLevel: 'high' | 'medium' | 'low';
  rating: number | null;
  notesSummary: string | null;
  patientCheckedIn?: boolean;
  patientCheckedInAt?: Date | string | null;
  joinToken?: string | null;
  chimeMeetingId?: string | null;
  patientPhone?: string | null;
  patientEmail?: string | null;
  clientConsentSigned?: boolean;
  clientLocationState?: string | null;
};

export type TelehealthStatsDto = {
  sessionsToday: number;
  sessionsThisWeek: number;
  avgDurationMin: number;
  clientSatisfaction: number | null;
};

export type TelehealthSettingsDto = {
  defaultPlatform: PlatformUi;
  reminderMinutes: number;
  recordingMode: string;
  autoSendLinkMinutes: number;
  waitingRoom: boolean;
  platforms: { zoom: boolean; doxy: boolean; google: boolean; teams: boolean; phone: boolean };
  zoomConfigured: boolean;
  googleMeetConfigured: boolean;
};

function serializeSession(row: {
  id: string;
  appointmentId?: string | null;
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
  patientCheckedIn?: boolean;
  patientCheckedInAt?: Date | null;
  joinToken?: string | null;
  chimeMeetingId?: string | null;
  patientPhone?: string | null;
  patientEmail?: string | null;
  clientConsentSigned?: boolean;
  clientLocationState?: string | null;
}): TelehealthSessionDto {
  const meta = parseTelehealthMeta(row.notesSummary);
  return {
    id: row.id,
    clientId: row.clientId,
    clientName: row.clientName,
    clinicianId: row.clinicianId,
    clinicianName: row.clinicianName,
    type: row.type,
    sessionDate: sessionDateYmd(row.sessionDate),
    startTime: row.startTime,
    durationMin: row.durationMin,
    status: STATUS_UI[row.status],
    platform: PLATFORM_UI[row.platform],
    roomId: row.roomId,
    joinUrl: row.joinUrl,
    hostUrl: staffHostMeetingUrl(meta) || row.joinUrl,
    source: 'session',
    appointmentId: row.appointmentId ?? null,
    riskLevel: RISK_UI[row.riskLevel],
    rating: row.rating,
    notesSummary: notesForStaffUi(row.notesSummary) || null,
    patientCheckedIn: Boolean((row as any).patientCheckedIn || row.status === 'CHECKED_IN'),
    patientCheckedInAt: (row as any).patientCheckedInAt ?? null,
    joinToken: (row as any).joinToken ?? null,
    chimeMeetingId: (row as any).chimeMeetingId ?? meta.chimeMeetingId ?? null,
    patientPhone: (row as any).patientPhone ?? null,
    patientEmail: (row as any).patientEmail ?? null,
    clientConsentSigned: Boolean((row as any).clientConsentSigned),
    clientLocationState: (row as any).clientLocationState ?? null,
  };
}

function meetingMetaFromProvision(
  platform: TelehealthPlatform,
  meeting: { roomId: string; joinUrl: string; hostUrl?: string }
): TelehealthMeta {
  if (platform === 'GOOGLE') {
    return {
      provider: 'google',
      googleEventId: meeting.roomId,
      googleMeetJoinUrl: meeting.joinUrl,
    };
  }
  if (platform === 'CHIME') {
    return { provider: 'chime' };
  }
  return {
    provider: 'zoom',
    zoomMeetingId: meeting.roomId,
    zoomJoinUrl: meeting.joinUrl,
    zoomStartUrl: meeting.hostUrl,
  };
}

function appointmentVisitToTeleStatus(status: AppointmentStatus): SessionStatusUi | null {
  if (status === 'IN_SESSION') return 'in_progress';
  if (status === 'COMPLETED') return 'completed';
  if (status === 'CANCELLED' || status === 'NO_SHOW' || status === 'LATE_CANCEL') {
    return 'cancelled';
  }
  if (status === 'SCHEDULED' || status === 'CHECKED_IN') return 'upcoming';
  return null;
}

function appointmentToSessionDto(timeZone: string, row: {
  id: string;
  clientId: string;
  clientName: string | null;
  clinicianId: string | null;
  clinicianName: string | null;
  type: string;
  startsAt: Date;
  endsAt: Date;
  status: AppointmentStatus;
  notes: string | null;
  client: { name: string };
}): TelehealthSessionDto {
  const meta = parseTelehealthMeta(row.notes);
  const joinUrl = clientTelehealthJoinUrl({
    appointmentId: row.id,
    clientId: row.clientId,
    endsAt: row.endsAt,
    meta,
  });
  const hostUrl = staffHostMeetingUrl(meta) || joinUrl;
  const durationMin = Math.max(
    15,
    Math.round((row.endsAt.getTime() - row.startsAt.getTime()) / 60000)
  );
  const platform: PlatformUi =
    meta.provider === 'google'
      ? 'google'
      : meta.provider === 'phone'
        ? 'phone'
        : meta.provider === 'chime'
          ? 'chime'
          : 'zoom';
  return {
    id: row.id,
    clientId: row.clientId,
    clientName: row.clientName?.trim() || row.client.name,
    clinicianId: row.clinicianId,
    clinicianName: row.clinicianName,
    type: row.type,
    ...appointmentWallTime(row.startsAt, timeZone),
    durationMin,
    platform,
    status: appointmentVisitToTeleStatus(row.status) || 'upcoming',
    roomId: meta.chimeMeetingId || meta.zoomMeetingId || meta.googleEventId || null,
    joinUrl,
    hostUrl,
    source: 'appointment',
    appointmentId: row.id,
    riskLevel: 'low',
    rating: null,
    notesSummary: notesForStaffUi(row.notes) || null,
    patientCheckedIn: row.status === 'CHECKED_IN',
  };
}

function appointmentOrgWhere(organizationId: string): Prisma.AppointmentWhereInput {
  return {
    OR: [{ organizationId }, { client: clientOrgFilter(organizationId) }],
  };
}

export async function listTelehealthSessions(input: {
  organizationId: string;
  actorRole: Role;
  actorUserId?: string;
  scope?: 'today' | 'upcoming' | 'history' | 'all';
}) {
  if (!canAccessClientAppointments(input.actorRole)) return [];

  const timeZone = await getPracticeTimeZone(input.organizationId);
  const day = practiceDayRange(timeZone);
  // TelehealthSession.sessionDate bounds (calendar day) vs Appointment.startsAt bounds (instants).
  const { sessionStart: todayStart, sessionEnd: todayEnd } = day;
  const { apptStart: todayApptStart, apptEnd: todayApptEnd } = day;
  const scope = input.scope || 'all';

  let where: Parameters<typeof prisma.telehealthSession.findMany>[0]['where'] = {
    organizationId: input.organizationId,
  };

  if (scope === 'today') {
    where = {
      ...where,
      sessionDate: { gte: todayStart, lte: todayEnd },
      status: { in: ['UPCOMING', 'IN_PROGRESS'] },
    };
  } else if (scope === 'upcoming') {
    where = {
      ...where,
      OR: [
        { sessionDate: { gt: todayEnd }, status: 'UPCOMING' },
        {
          sessionDate: { gte: todayStart, lte: todayEnd },
          status: 'UPCOMING',
        },
      ],
    };
  } else if (scope === 'history') {
    where = {
      ...where,
      OR: [
        { status: 'COMPLETED' },
        { sessionDate: { lt: todayStart }, status: { not: 'CANCELLED' } },
      ],
    };
  }

  const orgFilter = appointmentOrgWhere(input.organizationId);
  let apptWhere: Prisma.AppointmentWhereInput = {
    AND: [orgFilter, { isVirtual: true }],
  };
  if (input.actorUserId && isCaseloadScoped({ role: input.actorRole, userId: input.actorUserId, organizationId: input.organizationId })) {
    // Same rule as the appointments list: the actor's own visits, plus visits of clients on their
    // care team (behavioral: treatment team / recent or upcoming appointment; primary care keeps
    // the primary-assignee rule there, minimum necessary)
    const careTeam = isMedicalRole(input.actorRole)
      ? { assignedToId: input.actorUserId }
      : careTeamClientWhereForRole(input.actorUserId, input.actorRole);
    apptWhere = {
      AND: [apptWhere, { OR: [{ clinicianId: input.actorUserId }, { client: careTeam }] }],
    };
    // TelehealthSession rows: the same rule (own sessions, or the client on the actor's care team)
    where = {
      AND: [where, { OR: [{ clinicianId: input.actorUserId }, { client: careTeam }] }],
    };
  }

  if (scope === 'today') {
    apptWhere = {
      AND: [
        apptWhere,
        { startsAt: { gte: todayApptStart, lte: todayApptEnd } },
        { status: { in: ['SCHEDULED', 'CHECKED_IN', 'IN_SESSION'] } },
      ],
    };
  } else if (scope === 'upcoming') {
    apptWhere = {
      AND: [
        apptWhere,
        { status: { in: ['SCHEDULED', 'CHECKED_IN'] } },
        { startsAt: { gte: todayApptStart } },
      ],
    };
  } else if (scope === 'history') {
    apptWhere = {
      AND: [
        apptWhere,
        {
          OR: [
            { status: 'COMPLETED' },
            {
              startsAt: { lt: todayApptStart },
              status: { notIn: ['CANCELLED', 'NO_SHOW', 'LATE_CANCEL'] },
            },
          ],
        },
      ],
    };
  }

  const [rows, appointments] = await Promise.all([
    prisma.telehealthSession.findMany({
      where,
      orderBy: [{ sessionDate: scope === 'history' ? 'desc' : 'asc' }, { startTime: 'asc' }],
      take: 200,
    }),
    prisma.appointment.findMany({
      where: apptWhere,
      include: { client: { select: { name: true } } },
      orderBy: { startsAt: scope === 'history' ? 'desc' : 'asc' },
      take: 200,
    }),
  ]);

  const fromSessions = rows.map(serializeSession);
  const fromAppointments = appointments.map((a) => appointmentToSessionDto(timeZone, a));
  const sessionKeys = new Set(
    fromSessions.map((s) => `${s.clientId}|${s.sessionDate}|${s.startTime}|${s.joinUrl || ''}`)
  );
  const uniqueAppointments = fromAppointments.filter(
    (s) => !sessionKeys.has(`${s.clientId}|${s.sessionDate}|${s.startTime}|${s.joinUrl || ''}`)
  );

  return [...fromSessions, ...uniqueAppointments].sort((a, b) => {
    const byDate = a.sessionDate.localeCompare(b.sessionDate);
    if (byDate !== 0) return scope === 'history' ? -byDate : byDate;
    return a.startTime.localeCompare(b.startTime);
  });
}

export async function telehealthStats(input: {
  organizationId: string;
  actorRole: Role;
}): Promise<TelehealthStatsDto> {
  if (!canAccessClientAppointments(input.actorRole)) {
    return {
      sessionsToday: 0,
      sessionsThisWeek: 0,
      avgDurationMin: 0,
      clientSatisfaction: null,
    };
  }

  const timeZone = await getPracticeTimeZone(input.organizationId);
  const day = practiceDayRange(timeZone);
  const week = practiceWeekRange(timeZone);
  const { sessionStart: todayStart, sessionEnd: todayEnd } = day;

  const [sessionsToday, weekRows, rated, apptsToday, apptsWeek] = await Promise.all([
    prisma.telehealthSession.count({
      where: {
        organizationId: input.organizationId,
        sessionDate: { gte: todayStart, lte: todayEnd },
        status: { not: 'CANCELLED' },
      },
    }),
    prisma.telehealthSession.findMany({
      where: {
        organizationId: input.organizationId,
        sessionDate: { gte: week.sessionStart, lte: week.sessionEnd },
        status: { not: 'CANCELLED' },
      },
      select: { durationMin: true },
    }),
    prisma.telehealthSession.findMany({
      where: {
        organizationId: input.organizationId,
        rating: { not: null },
        status: 'COMPLETED',
      },
      select: { rating: true },
      take: 100,
    }),
    prisma.appointment.count({
      where: {
        AND: [
          appointmentOrgWhere(input.organizationId),
          { isVirtual: true },
          { startsAt: { gte: day.apptStart, lte: day.apptEnd } },
          { status: { notIn: ['CANCELLED', 'NO_SHOW', 'LATE_CANCEL'] } },
        ],
      },
    }),
    prisma.appointment.findMany({
      where: {
        AND: [
          appointmentOrgWhere(input.organizationId),
          { isVirtual: true },
          { startsAt: { gte: week.apptStart, lte: week.apptEnd } },
          { status: { notIn: ['CANCELLED', 'NO_SHOW', 'LATE_CANCEL'] } },
        ],
      },
      select: { startsAt: true, endsAt: true },
    }),
  ]);

  const apptDurations = apptsWeek.map((a) =>
    Math.max(15, Math.round((a.endsAt.getTime() - a.startsAt.getTime()) / 60000))
  );
  const durationPool = [...weekRows.map((r) => r.durationMin), ...apptDurations];
  const avgDurationMin = durationPool.length
    ? Math.round(durationPool.reduce((s, n) => s + n, 0) / durationPool.length)
    : 0;
  const clientSatisfaction = rated.length
    ? Math.round(
        (rated.reduce((s, r) => s + (r.rating || 0), 0) / rated.length) * 10
      ) / 10
    : null;

  return {
    sessionsToday: sessionsToday + apptsToday,
    sessionsThisWeek: weekRows.length + apptsWeek.length,
    avgDurationMin,
    clientSatisfaction,
  };
}

export async function createTelehealthSession(input: {
  organizationId: string;
  actorRole: Role;
  actorUserId: string;
  clientId: string;
  type: string;
  sessionDate: string;
  startTime: string;
  durationMin?: number;
  platform?: string;
  clinicianId?: string | null;
  riskLevel?: 'high' | 'medium' | 'low';
  extraNotes?: string | null;
  emailClient?: boolean;
}) {
  if (!canAccessClientAppointments(input.actorRole)) {
    return { ok: false as const, status: 403, error: 'Forbidden' };
  }

  const client = await prisma.client.findFirst({
    where: {
      id: input.clientId,
      ...clientAccessWhere({
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
      }),
    },
  });
  if (!client) return { ok: false as const, status: 404, error: 'Client not found' };

  const platform = PLATFORM_DB[input.platform || ''] || null;
  if (
    platform !== 'ZOOM' &&
    platform !== 'GOOGLE' &&
    platform !== 'PHONE' &&
    platform !== 'CHIME'
  ) {
    return {
      ok: false as const,
      status: 400,
      error: 'Select Video (Chime), Zoom, Google Meet, or Phone',
    };
  }

  const wantsEmail = Boolean(input.emailClient) && platform !== 'PHONE';
  if (wantsEmail && !client.email?.trim()) {
    return {
      ok: false as const,
      status: 400,
      error: 'Client has no email on file. Add an email before sending the join link.',
    };
  }

  // sessionDate + startTime are typed on the practice clock.
  const timeZone = await getPracticeTimeZone(input.organizationId);
  let startAt: Date;
  try {
    startAt = sessionStartAt(input.sessionDate, input.startTime, timeZone);
  } catch {
    return { ok: false as const, status: 400, error: 'Invalid date' };
  }

  let meeting: { roomId: string; joinUrl: string; hostUrl?: string } | null = null;
  if (platform === 'ZOOM' || platform === 'GOOGLE') {
    try {
      meeting = await provisionTelehealthMeeting({
        platform,
        topic: `${input.type.trim() || 'Telehealth'} — ${client.name}`,
        startAt,
        durationMin: input.durationMin || 50,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not create meeting';
      return { ok: false as const, status: 400, error: message };
    }
  }

  let clinicianId = input.clinicianId || client.assignedToId;
  let clinicianName: string | null = null;
  if (clinicianId) {
    const clin = await prisma.user.findFirst({
      where: { id: clinicianId, organizationId: input.organizationId },
    });
    if (!clin) {
      return { ok: false as const, status: 400, error: 'Clinician not found' };
    }
    clinicianName = clin.name;
  } else {
    const self = await prisma.user.findUnique({ where: { id: input.actorUserId } });
    clinicianId = input.actorUserId;
    clinicianName = self?.name || 'Clinician';
  }

  const sessionDate = sessionDateValue(input.sessionDate);
  if (Number.isNaN(sessionDate.getTime())) {
    return { ok: false as const, status: 400, error: 'Invalid date' };
  }

  const extraNotes = input.extraNotes?.trim() || null;
  const riskMap = { high: 'HIGH', medium: 'MEDIUM', low: 'LOW' } as const;
  const meta: TelehealthMeta =
    platform === 'PHONE'
      ? { provider: 'phone' }
      : platform === 'CHIME'
        ? { provider: 'chime' }
        : meetingMetaFromProvision(platform, meeting!);
  const created = await prisma.telehealthSession.create({
    data: {
      organizationId: input.organizationId,
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
      roomId: meeting?.roomId ?? null,
      joinUrl: meeting?.joinUrl ?? null,
      riskLevel: riskMap[input.riskLevel || 'low'],
      notesSummary: writeTelehealthMeta(extraNotes, meta),
    },
  });

  let patientJoinUrl = created.joinUrl;
  let joinToken: string | null = null;
  if (platform === 'CHIME') {
    joinToken = createTelehealthJoinToken({
      appointmentId: created.id,
      clientId: client.id,
      expiresInMinutes: 180,
    });
    patientJoinUrl = `${getAppBaseUrl()}/telehealth/join/${encodeURIComponent(joinToken)}`;
    await prisma.telehealthSession.update({
      where: { id: created.id },
      data: {
        joinToken,
        joinUrl: patientJoinUrl,
      },
    });
    (created as any).joinToken = joinToken;
    created.joinUrl = patientJoinUrl;
  }

  let emailed: { to: string; mode: 'smtp' | 'ses' | 'console' } | null = null;
  let emailError: string | null = null;
  const emailJoinUrl = platform === 'CHIME' ? patientJoinUrl : meeting?.joinUrl;
  if (wantsEmail && emailJoinUrl) {
    try {
      const sent = await sendTelehealthJoinEmail({
        to: client.email!.trim(),
        clientName: client.name,
        clinicianName: clinicianName || 'Your clinician',
        sessionDate: input.sessionDate,
        startTime: input.startTime,
        timeZone,
        platform,
        joinUrl: emailJoinUrl,
        extraNotes,
      });
      emailed = { to: client.email!.trim(), mode: sent.mode };
    } catch (err) {
      emailError = err instanceof Error ? err.message : 'Could not email the client';
    }
  }

  // Mobile App Push Notification & SMS with exact session timing
  const { formattedDate, formattedTime } = formatSessionTiming(
    input.sessionDate,
    input.startTime,
    timeZone
  );
  const duration = input.durationMin || 50;
  const docName = clinicianName || 'Your clinician';

  void sendToUser(client.id, {
    type: 'appointment_reminder',
    title: `Telehealth Session Scheduled · ${docName}`,
    body: `Your virtual visit with ${docName} is confirmed for ${formattedDate} at ${formattedTime} (${duration} min).`,
    data: {
      type: 'appointment_reminder',
      sessionId: created.id,
      sessionDate: input.sessionDate,
      startTime: input.startTime,
      formattedTime,
      formattedDate,
      durationMinutes: String(duration),
      doctorName: docName,
      joinUrl: patientJoinUrl || '',
      joinToken: joinToken || '',
    },
  }).catch((err) => {
    console.warn('[push] Telehealth session creation notification note:', err);
  });

  // Consent-gated text (src/lib/sms/patientSms.ts): no clinician name, no practice specialty
  const text = client.phone?.trim()
    ? await sendPatientSms({
        clientId: client.id,
        organizationId: input.organizationId,
        purpose: 'telehealth_scheduled',
        actor: { userId: input.actorUserId, role: input.actorRole },
        build: ({ sender }) => telehealthScheduledSms({ sender, date: formattedDate, time: formattedTime, joinUrl: patientJoinUrl || null }),
      })
    : null;

  return {
    ok: true as const,
    session: serializeSession(created),
    emailed,
    emailError,
    sms: text ? { sent: text.sent, ...('reason' in text ? { reason: text.reason } : {}), message: text.message } : null,
  };
}

async function patchAppointmentAsTelehealthSession(input: {
  id: string;
  organizationId: string;
  actorRole: Role;
  actorUserId?: string;
  status?: string | null;
}) {
  const existing = await prisma.appointment.findFirst({
    where: {
      id: input.id,
      isVirtual: true,
      AND: [appointmentOrgWhere(input.organizationId)],
    },
    include: {
      client: { select: { id: true, name: true, assignedToId: true } },
    },
  });
  if (!existing) return { ok: false as const, status: 404, error: 'Session not found' };

  // The visit's own clinician, or anyone on the client's care team (same rule as the chart)
  if (
    input.actorUserId &&
    existing.clinicianId !== input.actorUserId &&
    !(await caseloadAllows({ organizationId: input.organizationId, userId: input.actorUserId, role: input.actorRole }, existing.client))
  ) {
    return { ok: false as const, status: 403, error: 'Not your patient' };
  }

  let status = existing.status;
  if (input.status) {
    const next: Record<string, AppointmentStatus | undefined> = {
      in_progress: 'IN_SESSION',
      completed: 'COMPLETED',
      cancelled: 'CANCELLED',
    };
    if (input.status === 'upcoming') {
      status = existing.status;
    } else if (next[input.status]) {
      const desired = next[input.status]!;
      const allowedFrom = new Set<AppointmentStatus>([
        'SCHEDULED',
        'CHECKED_IN',
        'IN_SESSION',
      ]);
      // Do not resurrect completed / cancelled / no-show visits from Telehealth Start.
      if (desired === 'IN_SESSION' && !allowedFrom.has(existing.status)) {
        return {
          ok: false as const,
          status: 400,
          error: `Cannot start meeting from visit status ${existing.status}`,
        };
      }
      if (
        (desired === 'COMPLETED' || desired === 'CANCELLED') &&
        !allowedFrom.has(existing.status) &&
        existing.status !== desired
      ) {
        return {
          ok: false as const,
          status: 400,
          error: 'Cannot update this appointment status from Telehealth',
        };
      }
      status = desired;
    } else {
      return { ok: false as const, status: 400, error: 'Invalid status' };
    }
    if (status !== existing.status) {
      await prisma.appointment.update({
        where: { id: existing.id },
        data: { status },
      });
      void triggerAutopayAfterVisitStatus(existing.id, status, { userId: input.actorUserId ?? null, role: String(input.actorRole) });
    }
  }

  return {
    ok: true as const,
    session: appointmentToSessionDto(await getPracticeTimeZone(input.organizationId), {
      ...existing,
      status,
    }),
  };
}

export async function patchTelehealthSession(input: {
  id: string;
  organizationId: string;
  actorRole: Role;
  actorUserId?: string;
  status?: string | null;
  notesSummary?: string | null;
  rating?: number | null;
}) {
  if (!canAccessClientAppointments(input.actorRole)) {
    return { ok: false as const, status: 403, error: 'Forbidden' };
  }

  const existing = await prisma.telehealthSession.findFirst({
    where: { id: input.id, organizationId: input.organizationId },
  });
  if (!existing) {
    return patchAppointmentAsTelehealthSession(input);
  }

  const data: {
    status?: TelehealthSessionStatus;
    notesSummary?: string | null;
    rating?: number | null;
    roomId?: string;
    joinUrl?: string;
  } = {};

  if (input.status) {
    const st = STATUS_DB[input.status];
    if (!st) return { ok: false as const, status: 400, error: 'Invalid status' };
    data.status = st;
    if (st === 'IN_PROGRESS' && !isRealJoinUrl(existing.platform, existing.joinUrl)) {
      if (existing.platform === 'ZOOM' || existing.platform === 'GOOGLE') {
        try {
          const meeting = await provisionTelehealthMeeting({
            platform: existing.platform,
            topic: `${existing.type} — ${existing.clientName}`,
            startAt: sessionStartAt(
              sessionDateYmd(existing.sessionDate),
              existing.startTime,
              await getPracticeTimeZone(input.organizationId)
            ),
            durationMin: existing.durationMin,
          });
          data.roomId = meeting.roomId;
          data.joinUrl = meeting.joinUrl;
          data.notesSummary = writeTelehealthMeta(
            notesForStaffUi(existing.notesSummary),
            meetingMetaFromProvision(existing.platform, meeting)
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Could not create meeting';
          return { ok: false as const, status: 400, error: message };
        }
      }
    }
  }
  if (input.notesSummary !== undefined) {
    data.notesSummary = writeTelehealthMeta(
      input.notesSummary,
      parseTelehealthMeta(existing.notesSummary)
    );
  }
  if (input.rating !== undefined) data.rating = input.rating;

  const updated = await prisma.telehealthSession.update({
    where: { id: existing.id },
    data,
  });
  return { ok: true as const, session: serializeSession(updated) };
}

async function sendAppointmentJoinLink(input: {
  id: string;
  organizationId: string;
  actorRole: Role;
  extraNotes?: string | null;
}) {
  const existing = await prisma.appointment.findFirst({
    where: {
      id: input.id,
      isVirtual: true,
      AND: [appointmentOrgWhere(input.organizationId)],
    },
    include: { client: { select: { email: true, name: true } } },
  });
  if (!existing) return { ok: false as const, status: 404, error: 'Session not found' };

  const to = existing.client.email?.trim();
  if (!to) {
    return {
      ok: false as const,
      status: 400,
      error: 'Client has no email on file. Add an email before sending the join link.',
    };
  }

  const meta = parseTelehealthMeta(existing.notes);
  const joinUrl = clientTelehealthJoinUrl({
    appointmentId: existing.id,
    clientId: existing.clientId,
    endsAt: existing.endsAt,
    meta,
  });
  if (!joinUrl) {
    return { ok: false as const, status: 400, error: 'No meeting link to send' };
  }

  const extraNotes = input.extraNotes?.trim() || notesForStaffUi(existing.notes) || null;
  const platform = meta.provider === 'google' ? 'GOOGLE' : meta.provider === 'phone' ? 'PHONE' : 'ZOOM';
  if (platform === 'PHONE') {
    return {
      ok: false as const,
      status: 400,
      error: 'Phone sessions do not have a video join link to send.',
    };
  }
  const timeZone = await getPracticeTimeZone(input.organizationId);
  const wall = appointmentWallTime(existing.startsAt, timeZone);
  let sent: { mode: 'smtp' | 'ses' | 'console' };
  try {
    sent = await sendTelehealthJoinEmail({
      to,
      clientName: existing.client.name,
      clinicianName: existing.clinicianName || 'Your clinician',
      sessionDate: wall.sessionDate,
      startTime: wall.startTime,
      timeZone,
      platform,
      joinUrl,
      extraNotes,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not email the client';
    return { ok: false as const, status: 400, error: message };
  }

  return {
    ok: true as const,
    session: appointmentToSessionDto(timeZone, existing),
    link: joinUrl,
    sentTo: to,
    emailMode: sent.mode,
  };
}

export async function sendTelehealthLink(input: {
  id: string;
  organizationId: string;
  actorRole: Role;
  extraNotes?: string | null;
}) {
  if (!canAccessClientAppointments(input.actorRole)) {
    return { ok: false as const, status: 403, error: 'Forbidden' };
  }
  const existing = await prisma.telehealthSession.findFirst({
    where: { id: input.id, organizationId: input.organizationId },
    include: { client: { select: { email: true, name: true } } },
  });
  if (!existing) {
    return sendAppointmentJoinLink(input);
  }
  const timeZone = await getPracticeTimeZone(input.organizationId);
  const sessionYmd = sessionDateYmd(existing.sessionDate);

  if (existing.platform === 'PHONE') {
    return {
      ok: false as const,
      status: 400,
      error: 'Phone sessions do not have a video join link to send.',
    };
  }

  if (existing.platform === 'CHIME') {
    const to = existing.client.email?.trim();
    if (!to) {
      return {
        ok: false as const,
        status: 400,
        error: 'Client has no email on file. Add an email before sending the join link.',
      };
    }
    const token = createTelehealthJoinToken({
      appointmentId: existing.id,
      clientId: existing.clientId,
      expiresInMinutes: 180,
    });
    const joinUrl = `${getAppBaseUrl()}/telehealth/join/${encodeURIComponent(token)}`;
    const extraNotes = input.extraNotes?.trim() || notesForStaffUi(existing.notesSummary) || null;
    let sent: { mode: 'smtp' | 'ses' | 'console' };
    try {
      sent = await sendTelehealthJoinEmail({
        to,
        clientName: existing.client.name,
        clinicianName: existing.clinicianName || 'Your clinician',
        sessionDate: sessionYmd,
        timeZone,
        startTime: existing.startTime,
        platform: 'CHIME',
        joinUrl,
        extraNotes,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not email the client';
      return { ok: false as const, status: 400, error: message };
    }
    return {
      ok: true as const,
      session: serializeSession(existing),
      link: joinUrl,
      sentTo: to,
      emailMode: sent.mode,
    };
  }

  const to = existing.client.email?.trim();
  if (!to) {
    return {
      ok: false as const,
      status: 400,
      error: 'Client has no email on file. Add an email before sending the join link.',
    };
  }

  let roomId = existing.roomId;
  let joinUrl = existing.joinUrl;
  if (!isRealJoinUrl(existing.platform, joinUrl)) {
    try {
      const meeting = await provisionTelehealthMeeting({
        platform: existing.platform,
        topic: `${existing.type} — ${existing.clientName}`,
        startAt: sessionStartAt(sessionYmd, existing.startTime, timeZone),
        durationMin: existing.durationMin,
      });
      roomId = meeting.roomId;
      joinUrl = meeting.joinUrl;
      await prisma.telehealthSession.update({
        where: { id: existing.id },
        data: {
          roomId,
          joinUrl,
          notesSummary: writeTelehealthMeta(
            notesForStaffUi(existing.notesSummary),
            meetingMetaFromProvision(existing.platform, meeting)
          ),
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not create meeting';
      return { ok: false as const, status: 400, error: message };
    }
  }

  if (!joinUrl) {
    return { ok: false as const, status: 400, error: 'No meeting link to send' };
  }

  const extraNotes = input.extraNotes?.trim() || notesForStaffUi(existing.notesSummary) || null;
  let sent: { mode: 'smtp' | 'ses' | 'console' };
  try {
    sent = await sendTelehealthJoinEmail({
      to,
      clientName: existing.client.name,
      clinicianName: existing.clinicianName || 'Your clinician',
      sessionDate: sessionYmd,
      timeZone,
      startTime: existing.startTime,
      platform: existing.platform,
      joinUrl,
      extraNotes,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not email the client';
    return { ok: false as const, status: 400, error: message };
  }

  return {
    ok: true as const,
    session: serializeSession({ ...existing, roomId, joinUrl }),
    link: joinUrl,
    sentTo: to,
    emailMode: sent.mode,
  };
}

export async function getTelehealthSettings(organizationId: string): Promise<TelehealthSettingsDto> {
  let row = await prisma.telehealthSettings.findUnique({
    where: { organizationId },
  });
  if (!row) {
    row = await prisma.telehealthSettings.create({
      data: { organizationId },
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
      zoom: Boolean(platforms.zoom ?? true),
      doxy: Boolean(platforms.doxy ?? false),
      google: Boolean(platforms.google ?? true),
      teams: Boolean(platforms.teams ?? false),
      phone: Boolean(platforms.phone ?? true),
    },
    zoomConfigured: isZoomConfigured(),
    googleMeetConfigured: await isGoogleMeetConfigured(),
  };
}

export async function updateTelehealthSettings(
  organizationId: string,
  patch: Partial<TelehealthSettingsDto>
) {
  const existing = await getTelehealthSettings(organizationId);
  const next = {
    defaultPlatform: PLATFORM_DB[patch.defaultPlatform || existing.defaultPlatform] || 'ZOOM',
    reminderMinutes: patch.reminderMinutes ?? existing.reminderMinutes,
    recordingMode: patch.recordingMode ?? existing.recordingMode,
    autoSendLinkMinutes: patch.autoSendLinkMinutes ?? existing.autoSendLinkMinutes,
    waitingRoom: patch.waitingRoom ?? existing.waitingRoom,
    platformsJson: patch.platforms ?? existing.platforms,
  };

  await prisma.telehealthSettings.upsert({
    where: { organizationId },
    create: { organizationId, ...next },
    update: next,
  });

  return getTelehealthSettings(organizationId);
}
