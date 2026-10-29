import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { getOrCreateChimeRoom } from '@/lib/telehealth/chime';
import { createTelehealthJoinToken } from '@/lib/telehealth/join-token';
import { sendToUser } from '@/lib/notifications/pushService';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { prisma } from '@/lib/db/prisma';

import { getAppBaseUrl } from '@/lib/staff/invite';
import { sendSms } from '@/lib/sms/send';
import { sendTelehealthJoinEmail } from '@/lib/telehealth/email';

export const runtime = 'nodejs';

const bodySchema = z.object({
  appointmentId: z.string().min(1).max(128),
  patientId: z.string().min(1).max(128),
  patientName: z.string().min(1).max(200),
  clinicianName: z.string().max(200).optional().nullable(),
  scheduledAt: z.string().max(64).optional().nullable(),
  durationMinutes: z.number().int().min(15).max(90).optional(),
  enableRecording: z.boolean().optional(),
});

/** POST /api/telehealth/room — create or rejoin Chime meeting (+ clinician attendee) */
export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/telehealth')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = bodySchema.parse(await req.json());
    const visit = await prisma.appointment.findFirst({
      where: { id: body.appointmentId, organizationId: gate.organizationId },
      select: { clinicianId: true },
    });
    const visitSession = visit
      ? null
      : await prisma.telehealthSession.findFirst({
          where: {
            organizationId: gate.organizationId,
            OR: [{ id: body.appointmentId }, { appointmentId: body.appointmentId }],
          },
          select: { clinicianId: true },
        });
    const visitClinicianId = visit?.clinicianId || visitSession?.clinicianId;
    if (!visitClinicianId || visitClinicianId !== gate.userId) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }
    const room = await getOrCreateChimeRoom({
      ...body,
      externalUserId: (body.clinicianName || gate.session.user.name || 'clinician').slice(0, 64),
    });

    await writeAuditLog({
      action: 'telehealth.chime.create',
      actorUserId: gate.userId,
      organizationId: gate.organizationId,
      resourceType: 'ChimeMeeting',
      resourceId: room.meetingId,
      metadata: {
        appointmentId: body.appointmentId,
        patientId: body.patientId,
        demoMode: room.demoMode,
      },
    });

    // Patient mobile join token + FCM (works for both Appointment and TelehealthSession records)
    let patientJoinToken: string | null = null;
    let patientJoinUrl: string | null = null;
    const appointment = await prisma.appointment.findFirst({
      where: { id: body.appointmentId, isVirtual: true, clientId: body.patientId },
      select: { id: true, clientId: true },
    });
    if (appointment) {
      patientJoinToken = createTelehealthJoinToken({
        appointmentId: appointment.id,
        clientId: appointment.clientId,
        expiresInMinutes: 180,
      });
    } else {
      const session = await prisma.telehealthSession.findFirst({
        where: {
          OR: [
            { id: body.appointmentId },
            { appointmentId: body.appointmentId },
          ],
          clientId: body.patientId,
        },
        select: { id: true, clientId: true },
      });
      if (session) {
        patientJoinToken = createTelehealthJoinToken({
          appointmentId: session.id,
          clientId: session.clientId,
          expiresInMinutes: 180,
        });
      }
    }

    if (patientJoinToken) {
      patientJoinUrl = `${getAppBaseUrl()}/telehealth/join/${encodeURIComponent(patientJoinToken)}`;
      await prisma.telehealthSession.updateMany({
        where: {
          OR: [
            { id: body.appointmentId },
            { appointmentId: body.appointmentId },
          ],
        },
        data: {
          chimeMeetingId: room.meetingId,
          chimeExternalMeetingId: room.externalMeetingId,
          chimeMediaRegion: room.mediaRegion,
          chimeData: (room.meeting || null) as any,
          clinicianAttendeeId: (room.attendee as any)?.AttendeeId,
          clinicianJoinToken: room.joinToken,
          joinToken: patientJoinToken,
          joinUrl: patientJoinUrl,
          status: 'IN_PROGRESS',
        },
      });

      const docName = gate.session.user.name || 'Your Clinician';
      let timingLabel = 'starting now';
      if (body.scheduledAt) {
        try {
          const schedDate = new Date(body.scheduledAt);
          const timeStr = schedDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          timingLabel = `scheduled at ${timeStr}`;
        } catch {
          /* fallback */
        }
      }
      const durationStr = body.durationMinutes ? ` (${body.durationMinutes} min)` : '';

      void sendToUser(body.patientId, {
        type: 'telehealth_call',
        title: `Dr. ${docName} is calling for your video visit`,
        body: `Your telehealth session ${timingLabel}${durationStr} is live now. Tap to join your doctor.`,
        data: {
          type: 'telehealth_call',
          provider: 'chime',
          joinToken: patientJoinToken,
          joinUrl: patientJoinUrl,
          sessionId: body.appointmentId,
          meetingId: room.meetingId,
          doctorName: docName,
          scheduledAt: body.scheduledAt || '',
          durationMinutes: String(body.durationMinutes || 50),
        },
      }).catch((err) => {
        console.warn('[FCM] Telehealth call push failed:', err);
      });

      // Auto-SMS & Auto-Email Dispatch (Zero copy-paste needed in real world)
      void (async () => {
        try {
          const clientRec = await prisma.client.findUnique({
            where: { id: body.patientId },
            select: { name: true, phone: true, email: true },
          });

          if (clientRec?.phone) {
            await sendSms({
              to: clientRec.phone,
              clientId: body.patientId,
              body: `Altrixs: your clinician has started your virtual visit (${timingLabel}). Tap to join: ${patientJoinUrl}`,
              context: 'telehealth_call_start',
            });
          }

          if (clientRec?.email) {
            await sendTelehealthJoinEmail({
              to: clientRec.email,
              clientName: clientRec.name || body.patientName,
              clinicianName: gate.session.user.name || 'Your Clinician',
              sessionDate: new Date(),
              startTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              platform: 'chime',
              joinUrl: patientJoinUrl,
              extraNotes: 'Your doctor is currently waiting in the virtual examination room.',
            });
          }
        } catch (dispatchErr) {
          console.warn('[Telehealth] Auto SMS/Email dispatch note:', dispatchErr);
        }
      })();
    }

    return NextResponse.json(
      {
        success: true,
        meetingId: room.meetingId,
        externalMeetingId: room.externalMeetingId,
        mediaRegion: room.mediaRegion,
        meeting: room.meeting,
        attendee: room.attendee,
        /** Chime attendee JoinToken for the clinician (web SDK). */
        joinToken: room.joinToken,
        /** Patient deep-link / FCM token for /api/telehealth/join/:token */
        patientJoinToken,
        /** Full patient join web URL for sharing directly. */
        patientJoinUrl,
        expiresAt: room.expiresAt,
        provider: 'chime' as const,
        demoMode: room.demoMode,
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: 'Invalid room payload' }, { status: 400 });
    }
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'Could not create Chime room',
      },
      { status: 500 }
    );
  }
}
