import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { canAccessClientAppointments } from '@/lib/clients/orgScope';
import { isCaseloadRole } from '@/types/roles';
import { createTelehealthJoinToken } from '@/lib/telehealth/join-token';
import { parseTelehealthMeta, writeTelehealthMeta } from '@/lib/telehealth/meta';
import { createGoogleMeet, isGoogleMeetConfigured } from '@/lib/telehealth/googleMeet';
import { createZoomMeeting, isZoomConfigured } from '@/lib/telehealth/zoom';
import { sendToUser } from '@/lib/notifications/pushService';
import { auditPhiAccess } from '@/lib/audit/requestMeta';

export const runtime = 'nodejs';

const bodySchema = z.object({
  appointmentId: z.string().min(1).max(128),
  provider: z.enum(['zoom', 'google', 'in_app', 'chime']).optional(),
});

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (
    !canAccessClientAppointments(gate.role) ||
    !canAccessPath(gate.role, '/dashboard/telehealth')
  ) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { appointmentId, provider } = bodySchema.parse(await req.json());
    const appointment = await prisma.appointment.findFirst({
      where: {
        id: appointmentId,
        isVirtual: true,
        OR: [
          { client: { location: { organizationId: gate.organizationId } } },
          { clinician: { organizationId: gate.organizationId } },
        ],
      },
      select: {
        id: true,
        clientId: true,
        clinicianId: true,
        status: true,
        startsAt: true,
        notes: true,
        client: { select: { name: true } },
      },
    });
    if (!appointment) {
      return NextResponse.json({ success: false, error: 'Appointment not found' }, { status: 404 });
    }
    if (appointment.status === 'CANCELLED' || appointment.status === 'COMPLETED') {
      return NextResponse.json(
        { success: false, error: 'This visit cannot be started' },
        { status: 400 }
      );
    }
    if (
      isCaseloadRole(gate.role) &&
      appointment.clinicianId &&
      appointment.clinicianId !== gate.userId
    ) {
      await auditPhiAccess({
        gate,
        req,
        action: 'CREATE',
        resourceType: 'telehealthJoinLink',
        resourceId: appointment.id,
        patientId: appointment.clientId,
        outcome: 'DENIED',
        metadata: { reason: 'not-assigned-clinician' },
      });
      return NextResponse.json({ success: false, error: 'Not your appointment' }, { status: 403 });
    }

    const token = createTelehealthJoinToken({
      appointmentId: appointment.id,
      clientId: appointment.clientId,
      expiresInMinutes: 180,
    });

    let meta = parseTelehealthMeta(appointment.notes);
    if (provider) meta = { ...meta, provider };
    let meetingError: string | null = null;
    // Default is in-app video; Zoom only when the appointment explicitly chose it
    const chosen = meta.provider || 'in_app';

    if (chosen === 'zoom' && !meta.zoomJoinUrl) {
      if (!isZoomConfigured()) {
        meetingError = 'Zoom is not configured';
      } else {
        try {
          const meeting = await createZoomMeeting({
            topic: `Altrixs visit — ${appointment.client.name}`,
            startAt: appointment.startsAt,
          });
          meta = {
            ...meta,
            provider: 'zoom',
            zoomMeetingId: meeting.meetingId,
            zoomJoinUrl: meeting.joinUrl,
            zoomStartUrl: meeting.startUrl,
          };
        } catch (err) {
          meetingError = err instanceof Error ? err.message : 'Zoom meeting could not start';
        }
      }
    }

    if (chosen === 'google' && !meta.googleMeetJoinUrl) {
      if (!(await isGoogleMeetConfigured())) {
        meetingError = 'Google Meet not configured';
      } else {
        try {
          const meeting = await createGoogleMeet({
            topic: `Altrixs visit — ${appointment.client.name}`,
            startAt: appointment.startsAt,
          });
          meta = {
            ...meta,
            provider: 'google',
            googleEventId: meeting.eventId,
            googleMeetJoinUrl: meeting.joinUrl,
          };
        } catch (err) {
          meetingError = err instanceof Error ? err.message : 'Google Meet could not start';
        }
      }
    }

    if (JSON.stringify(meta) !== JSON.stringify(parseTelehealthMeta(appointment.notes))) {
      await prisma.appointment.update({
        where: { id: appointment.id },
        data: { notes: writeTelehealthMeta(appointment.notes, meta) },
      });
    }

    void sendToUser(appointment.clientId, {
      type: 'telehealth_call',
      title: 'Your telehealth visit is starting',
      body: `${gate.session.user.name || 'Your clinician'} has opened the video session. Tap to join.`,
      data: {
        type: 'telehealth_call',
        provider: 'chime',
        joinToken: token,
        sessionId: appointment.id,
        doctorName: gate.session.user.name || 'Clinician',
      },
    }).catch((err) => {
      console.warn('[FCM] Telehealth push notification failed:', err);
    });

    await auditPhiAccess({
      gate,
      req,
      action: 'CREATE',
      resourceType: 'telehealthJoinLink',
      resourceId: appointment.id,
      patientId: appointment.clientId,
      metadata: {
        provider: meta.provider || chosen,
        meetingError: Boolean(meetingError),
        pushQueued: true,
        expiresInMinutes: 180,
      },
    });

    return NextResponse.json({
      success: true,
      token,
      appointmentId: appointment.id,
      clientId: appointment.clientId,
      provider: meta.provider || chosen,
      zoomConfigured: isZoomConfigured(),
      googleMeetConfigured: await isGoogleMeetConfigured(),
      zoomJoinUrl: meta.zoomJoinUrl || null,
      zoomStartUrl: meta.zoomStartUrl || null,
      googleMeetJoinUrl: meta.googleMeetJoinUrl || null,
      zoomError: meetingError,
      meetingError,
    });
  } catch (err: unknown) {
    const message = err instanceof z.ZodError ? 'Invalid request' : (err as Error).message;
    return NextResponse.json(
      { success: false, error: message || 'Could not create join link' },
      { status: 400 }
    );
  }
}
