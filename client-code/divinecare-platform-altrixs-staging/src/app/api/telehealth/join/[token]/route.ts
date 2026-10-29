import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { readTelehealthJoinToken } from '@/lib/telehealth/join-token';
import { parseTelehealthMeta } from '@/lib/telehealth/meta';
import { createChimeAttendee, loadStoredChimeMeeting } from '@/lib/telehealth/chime';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { auditRequestMeta } from '@/lib/audit/requestMeta';
import {
  DEFAULT_PRACTICE_TIME_ZONE,
  practiceZoneLabel,
  toPracticeWallTime,
} from '@/lib/time/practiceTime';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { sessionDateYmd } from '@/lib/telehealth/practiceTiming';

export const runtime = 'nodejs';

const postSchema = z.object({
  action: z.enum(['here', 'join', 'chime']),
});

async function loadVirtualAppointment(token: string) {
  // 1. Stored join token only. Never fall back to the row id or appointmentId:
  // those are guessable/leaked identifiers, not bearer secrets.
  if (!token || token.length < 16) {
    return { ok: false as const, status: 401, error: 'Invalid or expired link' };
  }
  const sessionByToken = await prisma.telehealthSession.findFirst({
    where: { joinToken: token },
    include: {
      client: { select: { name: true, image: true } },
    },
  });
  if (sessionByToken) {
    if (sessionByToken.status === 'CANCELLED') {
      return { ok: false as const, status: 410, error: 'This visit was cancelled' };
    }
    if (sessionByToken.status === 'COMPLETED') {
      return { ok: false as const, status: 410, error: 'This session already ended' };
    }
    return { ok: true as const, type: 'session' as const, appointment: null, session: sessionByToken };
  }


  // 2. Decode JWT payload
  const payload = readTelehealthJoinToken(token);
  if (!payload) return { ok: false as const, status: 401, error: 'Invalid or expired link' };

  const appointment = await prisma.appointment.findFirst({
    where: {
      id: payload.appointmentId,
      clientId: payload.clientId,
      isVirtual: true,
    },
    include: {
      client: { select: { name: true, image: true } },
      clinician: { select: { name: true } },
    },
  });
  if (appointment) {
    if (appointment.status === 'CANCELLED') {
      return { ok: false as const, status: 410, error: 'This visit was cancelled' };
    }
    if (appointment.status === 'COMPLETED') {
      return { ok: false as const, status: 410, error: 'This session already ended' };
    }
    return { ok: true as const, type: 'appointment' as const, appointment, session: null };
  }

  // Check TelehealthSession table for sessions scheduled via Telehealth dashboard
  const session = await prisma.telehealthSession.findFirst({
    where: {
      id: payload.appointmentId,
      clientId: payload.clientId,
    },
    include: {
      client: { select: { name: true, image: true } },
    },
  });
  if (session) {
    if (session.status === 'CANCELLED') {
      return { ok: false as const, status: 410, error: 'This visit was cancelled' };
    }
    if (session.status === 'COMPLETED') {
      return { ok: false as const, status: 410, error: 'This session already ended' };
    }
    return { ok: true as const, type: 'session' as const, appointment: null, session };
  }

  return { ok: false as const, status: 404, error: 'Invalid or expired link' };
}

type LoadedVisit = Extract<Awaited<ReturnType<typeof loadVirtualAppointment>>, { ok: true }>;

/** Join-link holder (the patient, no portal session): ids/enums only. Never throws. */
async function auditJoinLink(
  req: Request,
  loaded: LoadedVisit,
  action: string,
  metadata: Record<string, unknown>
) {
  const record = loaded.type === 'appointment' ? loaded.appointment : loaded.session;
  await writeAuditLog({
    action,
    actorUserId: null,
    actorRole: 'PATIENT',
    organizationId: record?.organizationId ?? null,
    resourceType: loaded.type === 'appointment' ? 'appointment' : 'telehealthSession',
    resourceId: record?.id ?? null,
    patientId: record?.clientId ?? null,
    ...auditRequestMeta(req),
    metadata: { via: 'join-link', ...metadata },
  });
}

/** Practice zone of the visit's org: date/startTime below are on that clock (server is UTC). */
async function loadedTimeZone(loaded: LoadedVisit): Promise<string> {
  const record = loaded.type === 'appointment' ? loaded.appointment : loaded.session;
  return getPracticeTimeZone(record?.organizationId ?? null);
}

function serializeLoadedVisit(loaded: {
  type: 'appointment' | 'session';
  appointment: {
    id: string;
    clientId: string;
    client: { name: string; image: string | null };
    clinician: { name: string | null } | null;
    startsAt: Date;
    status: string;
    isVirtual: boolean;
    notes: string | null;
  } | null;
  session: {
    id: string;
    clientId: string;
    clientName: string;
    clinicianName: string | null;
    sessionDate: Date;
    startTime: string;
    status: string;
    notesSummary: string | null;
    chimeMeetingId?: string | null;
    chimeData?: unknown;
    patientCheckedIn?: boolean;
  } | null;
}, timeZone: string = DEFAULT_PRACTICE_TIME_ZONE) {
  const zone = { timeZone, timeZoneLabel: practiceZoneLabel(timeZone) };
  if (loaded.type === 'appointment' && loaded.appointment) {
    const appt = loaded.appointment;
    const meta = parseTelehealthMeta(appt.notes);
    const start = appt.startsAt;
    const chimeReady = Boolean(meta.chimeMeetingId && meta.chimeMeeting);
    return {
      clientName: appt.client.name,
      clinicianName: appt.clinician?.name || 'Clinical staff',
      date: toPracticeWallTime(start, timeZone).date,
      startTime: toPracticeWallTime(start, timeZone).time,
      ...zone,
      status: appt.status,
      waiting: appt.status === 'CHECKED_IN',
      provider:
        meta.provider ||
        (chimeReady
          ? 'chime'
          : meta.googleMeetJoinUrl
            ? 'google'
            : meta.zoomJoinUrl
              ? 'zoom'
              : 'in_app'),
      chimeReady,
      chimeMeetingId: meta.chimeMeetingId || null,
      zoomJoinUrl: meta.zoomJoinUrl || null,
      googleMeetJoinUrl: meta.googleMeetJoinUrl || null,
    };
  }

  if (loaded.type === 'session' && loaded.session) {
    const sess = loaded.session;
    const meta = parseTelehealthMeta(sess.notesSummary);
    const d = sess.sessionDate;
    const chimeReady = Boolean((sess.chimeMeetingId && sess.chimeData) || (meta.chimeMeetingId && meta.chimeMeeting));
    return {
      clientName: sess.clientName,
      clinicianName: sess.clinicianName || 'Clinical staff',
      date: sessionDateYmd(d),
      startTime: sess.startTime,
      ...zone,
      status: sess.status,
      waiting: sess.patientCheckedIn || sess.status === 'CHECKED_IN' || sess.status === 'IN_PROGRESS',
      provider:
        meta.provider ||
        (chimeReady
          ? 'chime'
          : meta.googleMeetJoinUrl
            ? 'google'
            : meta.zoomJoinUrl
              ? 'zoom'
              : 'chime'),
      chimeReady,
      chimeMeetingId: sess.chimeMeetingId || meta.chimeMeetingId || null,
      zoomJoinUrl: meta.zoomJoinUrl || null,
      googleMeetJoinUrl: meta.googleMeetJoinUrl || null,
    };
  }

  throw new Error('Invalid loaded visit state');
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ token: string }> }
) {
  try {
    const { token: rawToken } = await ctx.params;
    const token = decodeURIComponent(rawToken || '');
    const loaded = await loadVirtualAppointment(token);
    if (!loaded.ok) {
      return NextResponse.json(
        { success: false, error: loaded.error },
        {
          status: loaded.status,
          headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' },
        }
      );
    }
    await auditJoinLink(req, loaded, 'READ', {});
    const timeZone = await loadedTimeZone(loaded);
    return NextResponse.json(
      { success: true, session: serializeLoadedVisit(loaded, timeZone) },
      { headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' } }
    );
  } catch (err: unknown) {
    // Public caller: log details server-side, return a generic message.
    console.error('[telehealth/join] GET failed:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { success: false, error: 'Could not load join link' },
      { status: 400, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' } }
    );
  }
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ token: string }> }
) {
  try {
    const { token: rawToken } = await ctx.params;
    const token = decodeURIComponent(rawToken || '');
    const body = postSchema.parse(await req.json().catch(() => ({ action: 'here' })));
    const loaded = await loadVirtualAppointment(token);
    if (!loaded.ok) {
      return NextResponse.json(
        { success: false, error: loaded.error },
        { status: loaded.status }
      );
    }
    const timeZone = await loadedTimeZone(loaded);

    const sessionId = loaded.type === 'appointment' ? loaded.appointment!.id : loaded.session!.id;
    const clientName = loaded.type === 'appointment' ? loaded.appointment!.client.name : loaded.session!.clientName;

    if (loaded.type === 'appointment' && loaded.appointment?.status === 'SCHEDULED') {
      loaded.appointment = await prisma.appointment.update({
        where: { id: loaded.appointment.id },
        data: { status: 'CHECKED_IN' },
        include: {
          client: { select: { name: true, image: true } },
          clinician: { select: { name: true } },
        },
      });
    }

    if (loaded.type === 'session' && loaded.session) {
      loaded.session = await prisma.telehealthSession.update({
        where: { id: loaded.session.id },
        data: {
          patientCheckedIn: true,
          patientCheckedInAt: new Date(),
          status: 'CHECKED_IN',
        },
        include: {
          client: { select: { name: true, image: true } },
        },
      });
    }

    if (body.action === 'chime' || body.action === 'join') {
      const stored = await loadStoredChimeMeeting(sessionId);
      if (!stored) {
        // Fallback: If session already has a chimeMeetingId stored
        if (loaded.type === 'session' && loaded.session?.chimeMeetingId) {
          const meetingId = loaded.session.chimeMeetingId;
          const { attendee, joinToken, demoMode } = await createChimeAttendee({
            meetingId,
            externalUserId: clientName.slice(0, 64),
          });
          await auditJoinLink(req, loaded, 'TELEHEALTH_JOIN', { requested: body.action, provider: 'chime', demoMode });
          return NextResponse.json({
            success: true,
            session: serializeLoadedVisit(loaded, timeZone),
            chime: {
              meetingId,
              meeting: (loaded.session.chimeData as any) || { MeetingId: meetingId, demoMode: true },
              attendee,
              joinToken,
              demoMode,
              provider: 'chime' as const,
              mediaRegion: 'us-east-1',
            },
          });
        }

        await auditJoinLink(req, loaded, 'TELEHEALTH_CHECK_IN', { requested: body.action, videoReady: false });
        return NextResponse.json(
          {
            success: false,
            error: 'Video session not started yet. Wait for your clinician to launch the call.',
          },
          { status: 409 }
        );
      }
      const { attendee, joinToken, demoMode } = await createChimeAttendee({
        meetingId: stored.meetingId,
        externalUserId: clientName.slice(0, 64),
      });

      if (loaded.type === 'session' && loaded.session) {
        await prisma.telehealthSession.update({
          where: { id: loaded.session.id },
          data: {
            patientAttendeeId: (attendee as any)?.AttendeeId,
            patientJoinToken: joinToken,
          },
        }).catch(() => {});
      }

      await auditJoinLink(req, loaded, 'TELEHEALTH_JOIN', { requested: body.action, provider: 'chime', demoMode });
      return NextResponse.json({
        success: true,
        session: serializeLoadedVisit(loaded, timeZone),
        chime: {
          meetingId: stored.meetingId,
          meeting: stored.meeting,
          attendee,
          joinToken,
          demoMode,
          provider: 'chime' as const,
          mediaRegion: String(stored.meeting.MediaRegion || 'us-east-1'),
        },
      });
    }


    await auditJoinLink(req, loaded, 'TELEHEALTH_CHECK_IN', { requested: body.action });
    return NextResponse.json({ success: true, session: serializeLoadedVisit(loaded, timeZone) });
  } catch (err: unknown) {
    // Public caller: log details server-side, return a generic message.
    console.error('[telehealth/join] POST failed:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { success: false, error: 'Could not update waiting status' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
