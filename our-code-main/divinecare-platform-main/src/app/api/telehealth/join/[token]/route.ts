import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { readTelehealthJoinToken } from '@/lib/telehealth/join-token';
import { parseTelehealthMeta } from '@/lib/telehealth/meta';
import { createChimeAttendee, loadStoredChimeMeeting } from '@/lib/telehealth/chime';

export const runtime = 'nodejs';

const postSchema = z.object({
  action: z.enum(['here', 'join', 'chime']),
});

async function loadVirtualAppointment(token: string) {
  // 1. First check TelehealthSession by direct joinToken, id, or appointmentId
  const sessionByToken = await prisma.telehealthSession.findFirst({
    where: {
      OR: [
        { joinToken: token },
        { id: token },
        { appointmentId: token },
      ],
    },
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
}) {
  const pad = (n: number) => String(n).padStart(2, '0');
  if (loaded.type === 'appointment' && loaded.appointment) {
    const appt = loaded.appointment;
    const meta = parseTelehealthMeta(appt.notes);
    const start = appt.startsAt;
    const chimeReady = Boolean(meta.chimeMeetingId && meta.chimeMeeting);
    return {
      clientName: appt.client.name,
      clinicianName: appt.clinician?.name || 'Clinical staff',
      date: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`,
      startTime: `${pad(start.getHours())}:${pad(start.getMinutes())}`,
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
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      startTime: sess.startTime,
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
  _req: Request,
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
    return NextResponse.json(
      { success: true, session: serializeLoadedVisit(loaded) },
      { headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' } }
    );
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not load join link' },
      { status: 400 }
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
          return NextResponse.json({
            success: true,
            session: serializeLoadedVisit(loaded),
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

      return NextResponse.json({
        success: true,
        session: serializeLoadedVisit(loaded),
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


    return NextResponse.json({ success: true, session: serializeLoadedVisit(loaded) });
  } catch (err: unknown) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'Could not update waiting status',
      },
      { status: 400 }
    );
  }
}
