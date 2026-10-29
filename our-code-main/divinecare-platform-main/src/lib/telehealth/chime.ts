/**
 * Amazon Chime SDK Meetings — video telehealth system of record.
 *
 * Live when AWS_ACCESS_KEY_ID is set; otherwise honest demoMode meeting payload.
 * Meetings region forced to us-east-1 per product rule.
 *
 * IAM (attach to altrixs-connect / app user in us-east-1):
 *   chime:CreateMeeting, chime:CreateAttendee, chime:GetMeeting,
 *   chime:DeleteMeeting, chime:ListAttendees
 * Env: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION=us-east-1
 */

import { prisma } from '@/lib/db/prisma';
import { parseTelehealthMeta, writeTelehealthMeta, type TelehealthMeta } from '@/lib/telehealth/meta';

export type ChimeMeetingPayload = {
  meetingId: string;
  externalMeetingId: string;
  mediaRegion: string;
  meeting: Record<string, unknown>;
  attendee: Record<string, unknown>;
  joinToken: string;
  expiresAt: string;
  provider: 'chime';
  demoMode: boolean;
};

export function isChimeLive(): boolean {
  return Boolean(process.env.AWS_ACCESS_KEY_ID?.trim());
}

function chimeRegion() {
  return 'us-east-1';
}

async function chimeClient() {
  const { ChimeSDKMeetingsClient } = await import('@aws-sdk/client-chime-sdk-meetings');
  return new ChimeSDKMeetingsClient({
    region: chimeRegion(),
    credentials:
      process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
        ? {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID.trim(),
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY.trim(),
          }
        : undefined,
  });
}

export async function createChimeMeetingRoom(input: {
  appointmentId: string;
  patientId: string;
  patientName: string;
  clinicianName?: string | null;
  scheduledAt?: string | null;
  durationMinutes?: number;
  enableRecording?: boolean;
}): Promise<ChimeMeetingPayload> {
  const externalMeetingId = `altrixs-${input.appointmentId}`.slice(0, 64);
  const expiresAt = new Date(
    Date.now() + Math.max(15, Math.min(90, input.durationMinutes || 50)) * 60 * 1000
  ).toISOString();

  if (!isChimeLive()) {
    const meetingId = `demo-chime-${input.appointmentId.slice(0, 12)}`;
    return {
      meetingId,
      externalMeetingId,
      mediaRegion: chimeRegion(),
      meeting: {
        MeetingId: meetingId,
        ExternalMeetingId: externalMeetingId,
        MediaRegion: chimeRegion(),
        demoMode: true,
      },
      attendee: {
        AttendeeId: `demo-attendee-${Date.now()}`,
        ExternalUserId: input.clinicianName || 'clinician',
        JoinToken: `demo-join-${Date.now()}`,
      },
      joinToken: `demo-join-${Date.now()}`,
      expiresAt,
      provider: 'chime',
      demoMode: true,
    };
  }

  try {
    const { CreateMeetingCommand, CreateAttendeeCommand } = await import(
      '@aws-sdk/client-chime-sdk-meetings'
    );
    const client = await chimeClient();
    const meetingRes = await client.send(
      new CreateMeetingCommand({
        ClientRequestToken: `${input.appointmentId}-${Date.now()}`,
        ExternalMeetingId: externalMeetingId,
        MediaRegion: chimeRegion(),
        MeetingHostId: input.patientId,
        NotificationsConfiguration: {},
      })
    );
    const meeting = meetingRes.Meeting;
    if (!meeting?.MeetingId) {
      throw new Error('Chime CreateMeeting returned no MeetingId');
    }
    const attendeeRes = await client.send(
      new CreateAttendeeCommand({
        MeetingId: meeting.MeetingId,
        ExternalUserId: (input.clinicianName || 'clinician').slice(0, 64),
      })
    );
    const attendee = attendeeRes.Attendee;
    if (!attendee?.JoinToken) {
      throw new Error('Chime CreateAttendee returned no JoinToken');
    }
    return {
      meetingId: meeting.MeetingId,
      externalMeetingId,
      mediaRegion: meeting.MediaRegion || chimeRegion(),
      meeting: meeting as unknown as Record<string, unknown>,
      attendee: attendee as unknown as Record<string, unknown>,
      joinToken: attendee.JoinToken,
      expiresAt,
      provider: 'chime',
      demoMode: false,
    };
  } catch (err) {
    console.error('[chime] create meeting failed', err);
    throw new Error(
      err instanceof Error ? err.message : 'Amazon Chime meeting could not be created'
    );
  }
}

export async function createChimeAttendee(input: {
  meetingId: string;
  externalUserId: string;
}): Promise<{ attendee: Record<string, unknown>; joinToken: string; demoMode: boolean }> {
  if (!isChimeLive() || input.meetingId.startsWith('demo-chime-')) {
    const joinToken = `demo-join-${Date.now()}`;
    return {
      attendee: {
        AttendeeId: `demo-attendee-${Date.now()}`,
        ExternalUserId: input.externalUserId.slice(0, 64),
        JoinToken: joinToken,
      },
      joinToken,
      demoMode: true,
    };
  }
  const { CreateAttendeeCommand } = await import('@aws-sdk/client-chime-sdk-meetings');
  const client = await chimeClient();
  const attendeeRes = await client.send(
    new CreateAttendeeCommand({
      MeetingId: input.meetingId,
      ExternalUserId: input.externalUserId.slice(0, 64),
    })
  );
  const attendee = attendeeRes.Attendee;
  if (!attendee?.JoinToken) {
    throw new Error('Chime CreateAttendee returned no JoinToken');
  }
  return {
    attendee: attendee as unknown as Record<string, unknown>,
    joinToken: attendee.JoinToken,
    demoMode: false,
  };
}

export async function deleteChimeMeeting(meetingId: string): Promise<void> {
  if (!isChimeLive() || meetingId.startsWith('demo-chime-')) return;
  try {
    const { DeleteMeetingCommand } = await import('@aws-sdk/client-chime-sdk-meetings');
    const client = await chimeClient();
    await client.send(new DeleteMeetingCommand({ MeetingId: meetingId }));
  } catch (err) {
    console.warn('[chime] delete meeting failed', err);
  }
}

function metaFromRoom(room: ChimeMeetingPayload): TelehealthMeta {
  return {
    provider: 'chime',
    chimeMeetingId: room.meetingId,
    chimeExternalMeetingId: room.externalMeetingId,
    chimeMeeting: room.meeting,
    chimeExpiresAt: room.expiresAt,
  };
}

/** Persist Chime meeting on Appointment.notes or TelehealthSession.notesSummary. */
export async function persistChimeMeeting(
  sessionId: string,
  room: ChimeMeetingPayload
): Promise<void> {
  const chimeMeta = metaFromRoom(room);

  const appointment = await prisma.appointment.findFirst({
    where: { id: sessionId, isVirtual: true },
    select: { id: true, notes: true },
  });
  if (appointment) {
    const prev = parseTelehealthMeta(appointment.notes);
    await prisma.appointment.update({
      where: { id: appointment.id },
      data: {
        notes: writeTelehealthMeta(appointment.notes, { ...prev, ...chimeMeta }),
      },
    });
    return;
  }

  const session = await prisma.telehealthSession.findFirst({
    where: { id: sessionId },
    select: { id: true, notesSummary: true },
  });
  if (session) {
    const prev = parseTelehealthMeta(session.notesSummary);
    await prisma.telehealthSession.update({
      where: { id: session.id },
      data: {
        roomId: room.meetingId,
        chimeMeetingId: room.meetingId,
        chimeData: (room.meeting || null) as any,
        status: 'IN_PROGRESS',
        notesSummary: writeTelehealthMeta(session.notesSummary, { ...prev, ...chimeMeta }),
      },
    });
  }
}

export async function loadStoredChimeMeeting(
  sessionId: string
): Promise<{ meetingId: string; meeting: Record<string, unknown>; expiresAt?: string } | null> {
  const appointment = await prisma.appointment.findFirst({
    where: { id: sessionId },
    select: { notes: true },
  });
  if (appointment) {
    const meta = parseTelehealthMeta(appointment.notes);
    if (meta.chimeMeetingId && meta.chimeMeeting) {
      return {
        meetingId: meta.chimeMeetingId,
        meeting: meta.chimeMeeting,
        expiresAt: meta.chimeExpiresAt,
      };
    }
  }

  const session = await prisma.telehealthSession.findFirst({
    where: { id: sessionId },
    select: { roomId: true, chimeMeetingId: true, chimeData: true, notesSummary: true },
  });
  if (session) {
    if (session.chimeMeetingId && session.chimeData) {
      return {
        meetingId: session.chimeMeetingId,
        meeting: session.chimeData as Record<string, unknown>,
      };
    }
    const meta = parseTelehealthMeta(session.notesSummary);
    if (meta.chimeMeetingId && meta.chimeMeeting) {
      return {
        meetingId: meta.chimeMeetingId,
        meeting: meta.chimeMeeting,
        expiresAt: meta.chimeExpiresAt,
      };
    }
    if (session.roomId?.startsWith('demo-chime-') || session.roomId) {
      /* roomId alone is not enough without Meeting blob */
    }
  }
  return null;
}

/**
 * Reuse an active Chime meeting if stored; otherwise create a new one.
 * Always returns a fresh attendee JoinToken for the caller.
 */
export async function getOrCreateChimeRoom(input: {
  appointmentId: string;
  patientId: string;
  patientName: string;
  clinicianName?: string | null;
  scheduledAt?: string | null;
  durationMinutes?: number;
  externalUserId: string;
}): Promise<ChimeMeetingPayload> {
  const stored = await loadStoredChimeMeeting(input.appointmentId);
  if (stored) {
    const expired =
      stored.expiresAt && new Date(stored.expiresAt).getTime() < Date.now() - 60_000;
    if (!expired) {
      try {
        const { attendee, joinToken, demoMode } = await createChimeAttendee({
          meetingId: stored.meetingId,
          externalUserId: input.externalUserId,
        });
        return {
          meetingId: stored.meetingId,
          externalMeetingId: `altrixs-${input.appointmentId}`.slice(0, 64),
          mediaRegion: String(stored.meeting.MediaRegion || chimeRegion()),
          meeting: stored.meeting,
          attendee,
          joinToken,
          expiresAt: stored.expiresAt || new Date(Date.now() + 50 * 60_000).toISOString(),
          provider: 'chime',
          demoMode,
        };
      } catch (err) {
        console.warn('[chime] reuse meeting failed — creating new', err);
      }
    }
  }

  const room = await createChimeMeetingRoom({
    appointmentId: input.appointmentId,
    patientId: input.patientId,
    patientName: input.patientName,
    clinicianName: input.clinicianName,
    scheduledAt: input.scheduledAt,
    durationMinutes: input.durationMinutes,
  });
  await persistChimeMeeting(input.appointmentId, room);
  return room;
}
