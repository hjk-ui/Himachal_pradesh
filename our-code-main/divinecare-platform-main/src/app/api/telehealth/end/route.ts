import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { canAccessClientAppointments } from '@/lib/clients/orgScope';
import { isCaseloadRole } from '@/types/roles';
import { pushSignal } from '@/lib/telehealth/signalStore';
import { deleteChimeMeeting } from '@/lib/telehealth/chime';
import { parseTelehealthMeta, writeTelehealthMeta } from '@/lib/telehealth/meta';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';

export const runtime = 'nodejs';

const bodySchema = z.object({
  appointmentId: z.string().min(1).max(128),
  meetingId: z.string().optional().nullable(),
  pos: z.enum(['02', '10']).optional().default('02'),
  cptModifier: z.string().optional().default('-95'),
});

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessClientAppointments(gate.role) || !canAccessPath(gate.role, '/dashboard/telehealth')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { appointmentId, meetingId, pos, cptModifier } = bodySchema.parse(await req.json());

    // 1. Try finding in Appointment table
    const appointment = await prisma.appointment.findFirst({
      where: {
        id: appointmentId,
        isVirtual: true,
        OR: [
          { client: { location: { organizationId: gate.organizationId } } },
          { clinician: { organizationId: gate.organizationId } },
        ],
      },
      select: { id: true, clinicianId: true, status: true, clientId: true, startsAt: true, notes: true },
    });

    if (appointment) {
      if (
        isCaseloadRole(gate.role) &&
        appointment.clinicianId &&
        appointment.clinicianId !== gate.userId
      ) {
        return NextResponse.json({ success: false, error: 'Not your appointment' }, { status: 403 });
      }

      // Calculate visit duration in minutes
      const startTime = new Date(appointment.startsAt).getTime();
      const now = Date.now();
      const elapsedMs = Math.max(60000, now - startTime);
      const durationMinutes = Math.max(1, Math.round(elapsedMs / 60000));

      // Extract meeting ID from body or appointment notes
      const existingMeta = parseTelehealthMeta(appointment.notes);
      const activeMeetingId = meetingId || existingMeta.chimeMeetingId;

      // Execute AWS Chime DeleteMeetingCommand
      if (activeMeetingId) {
        await deleteChimeMeeting(activeMeetingId);
      }

      // Update telehealth metadata with billing modifier -95 & POS 02/10
      const updatedMeta = {
        ...existingMeta,
        endedAt: new Date(now).toISOString(),
        durationMinutes,
        cptModifier,
        placeOfService: `POS ${pos}`,
        billingReady: true,
        transcriptionStatus: 'READY_FOR_SCRIBE',
      };

      const updatedNotes = writeTelehealthMeta(appointment.notes, updatedMeta);

      const updated = await prisma.appointment.update({
        where: { id: appointment.id },
        data: {
          status: 'COMPLETED',
          notes: updatedNotes,
        },
        select: { id: true, status: true, clientId: true },
      });

      // Update pending claim if one is linked to this appointment
      try {
        const linkedClaim = await prisma.claim.findFirst({
          where: { appointmentId: appointment.id },
        });
        if (linkedClaim) {
          const currentSub = (linkedClaim.submissionData as Record<string, unknown>) || {};
          await prisma.claim.update({
            where: { id: linkedClaim.id },
            data: {
              submissionData: {
                ...currentSub,
                cptModifier,
                placeOfService: `POS ${pos}`,
                durationMinutes,
                telehealthCompleted: true,
              },
            },
          });
        }
      } catch (claimErr) {
        console.warn('[billing] could not update linked claim:', claimErr);
      }

      pushSignal(appointment.id, {
        from: 'staff',
        type: 'hangup',
        data: { ended: true, durationMinutes },
      });

      await writeAuditLog({
        action: 'telehealth.chime.end',
        actorUserId: gate.userId,
        organizationId: gate.organizationId,
        resourceType: 'Appointment',
        resourceId: appointment.id,
        metadata: {
          meetingId: activeMeetingId,
          durationMinutes,
          cptModifier,
          placeOfService: `POS ${pos}`,
        },
      });

      return NextResponse.json({
        success: true,
        appointmentId: updated.id,
        status: 'COMPLETED',
        clientId: updated.clientId,
        durationMinutes,
        billing: {
          cptModifier,
          placeOfService: `POS ${pos}`,
          status: 'ATTACHED',
        },
        scribe: {
          ready: true,
          scribeUrl: `/dashboard/scribe?clientId=${updated.clientId}&appointmentId=${updated.id}`,
          soapDraftUrl: `/dashboard/medical/visits`,
        },
      });
    }

    // 2. Fallback: check TelehealthSession table
    const session = await prisma.telehealthSession.findFirst({
      where: {
        OR: [
          { id: appointmentId },
          { appointmentId: appointmentId },
        ],
        organizationId: gate.organizationId,
      },
      select: { id: true, clinicianId: true, status: true, clientId: true, durationMin: true, notesSummary: true, createdAt: true },
    });

    if (session) {
      const startTimeMs = new Date(session.createdAt).getTime();
      const nowMs = Date.now();
      const elapsedMs = Math.max(60000, nowMs - startTimeMs);
      const actualDuration = Math.max(1, Math.round(elapsedMs / 60000));

      const existingMeta = parseTelehealthMeta(session.notesSummary);
      const activeMeetingId = meetingId || existingMeta.chimeMeetingId;
      if (activeMeetingId) {
        await deleteChimeMeeting(activeMeetingId);
      }

      const updatedMeta = {
        ...existingMeta,
        endedAt: new Date().toISOString(),
        durationMinutes: actualDuration,
        cptModifier,
        placeOfService: `POS ${pos}`,
        billingReady: true,
      };

      const updated = await prisma.telehealthSession.update({
        where: { id: session.id },
        data: {
          status: 'COMPLETED',
          pos,
          cptModifier,
          durationMin: actualDuration,
          durationMinutes: actualDuration,
          notesSummary: writeTelehealthMeta(session.notesSummary, updatedMeta),
        },
        select: { id: true, status: true, clientId: true },
      });


      await writeAuditLog({
        action: 'telehealth.chime.end',
        actorUserId: gate.userId,
        organizationId: gate.organizationId,
        resourceType: 'TelehealthSession',
        resourceId: session.id,
        metadata: {
          meetingId: activeMeetingId,
          durationMinutes: actualDuration,
          cptModifier,
          placeOfService: `POS ${pos}`,
        },
      });

      return NextResponse.json({
        success: true,
        appointmentId: updated.id,
        status: 'COMPLETED',
        clientId: updated.clientId,
        durationMinutes: actualDuration,
        billing: {
          cptModifier,
          placeOfService: `POS ${pos}`,
          status: 'ATTACHED',
        },
        scribe: {
          ready: true,
          scribeUrl: `/dashboard/scribe?clientId=${updated.clientId}&appointmentId=${updated.id}`,
          soapDraftUrl: `/dashboard/ehr/notes?clientId=${updated.clientId}`,
        },
      });
    }

    return NextResponse.json({ success: false, error: 'Appointment not found' }, { status: 404 });
  } catch (err: unknown) {
    const message = err instanceof z.ZodError ? 'Invalid request' : (err as Error).message;
    return NextResponse.json({ success: false, error: message || 'Could not end session' }, { status: 400 });
  }
}
