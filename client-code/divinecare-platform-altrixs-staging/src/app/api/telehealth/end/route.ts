import { after, NextResponse } from 'next/server';
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
import { auditRequestMeta } from '@/lib/audit/requestMeta';
import { sendCompletedVisitToRcopia } from '@/app/api/drfirst/_lib/officeVisit';
import { resolveTelehealthPos } from '@/lib/telehealth/pos';
import { loadPracticeSettings } from '@/lib/practice/store';
import { triggerAutopayAfterVisitStatus } from '@/lib/patientPayments/visitTrigger';

export const runtime = 'nodejs';

const bodySchema = z.object({
  appointmentId: z.string().min(1).max(128),
  meetingId: z.string().optional().nullable(),
  /** Staff-entered POS, used only when the patient's check-in location is missing. Never defaulted. */
  pos: z.string().max(8).optional().nullable(),
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
      select: { id: true, clinicianId: true, status: true, clientId: true, startsAt: true, notes: true, patientLocationType: true, audioOnly: true },
    });

    const practice = await loadPracticeSettings(gate.organizationId);

    if (appointment) {
      // Same helper as the in-call end-session: patient's check-in location, else staff entry, else null (hold).
      const linkedSession = await prisma.telehealthSession.findFirst({
        where: { appointmentId: appointment.id, organizationId: gate.organizationId },
        select: { patientLocationType: true },
      });
      const posResult = resolveTelehealthPos({
        patientLocationType: appointment.patientLocationType ?? linkedSession?.patientLocationType ?? null,
        staffPos: pos,
        settings: practice,
      });
      const placeOfService = posResult.pos;
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
        placeOfService: placeOfService ?? undefined,
        billingReady: Boolean(placeOfService),
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
      // AutoPay copay / self-pay fee for the completed visit (background, idempotent)
      after(() => triggerAutopayAfterVisitStatus(updated.id, 'COMPLETED', { userId: gate.userId, role: String(gate.role) }));

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
                ...(placeOfService ? { placeOfService } : {}),
                placeOfServiceSource: posResult.source,
                audioOnly: appointment.audioOnly,
                durationMinutes,
                telehealthCompleted: true,
              },
            },
          });
        }
      } catch (claimErr) {
        console.warn('[billing] could not update linked claim:', claimErr);
      }

      // DrFirst-linked client: record the completed visit in Rcopia (after the response; never blocks the hang-up)
      const visitMeta = auditRequestMeta(req);
      after(() => sendCompletedVisitToRcopia(appointment.id, {
        userId: gate.userId, role: String(gate.role), organizationId: gate.organizationId,
        ipAddress: visitMeta.ipAddress, userAgent: visitMeta.userAgent,
      }));

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
          placeOfService,
          placeOfServiceSource: posResult.source,
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
          placeOfService,
          placeOfServiceSource: posResult.source,
          /** No POS without the patient's location: billing must ask before the claim goes out. */
          status: placeOfService ? 'ATTACHED' : 'NEEDS_PLACE_OF_SERVICE',
        },
        scribe: {
          ready: true,
          scribeUrl: `/dashboard/ehr/notes?clientId=${updated.clientId}&appointmentId=${updated.id}&guide=1&telehealth=1&scribe=1`,
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
      select: { id: true, clinicianId: true, status: true, clientId: true, durationMin: true, notesSummary: true, createdAt: true, patientLocationType: true, appointmentId: true },
    });

    if (session) {
      const posResult = resolveTelehealthPos({
        patientLocationType: session.patientLocationType,
        staffPos: pos,
        settings: practice,
      });
      const placeOfService = posResult.pos;
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
        placeOfService: placeOfService ?? undefined,
        billingReady: Boolean(placeOfService),
      };

      const updated = await prisma.telehealthSession.update({
        where: { id: session.id },
        data: {
          status: 'COMPLETED',
          ...(placeOfService ? { pos: placeOfService } : {}),
          cptModifier,
          durationMin: actualDuration,
          durationMinutes: actualDuration,
          notesSummary: writeTelehealthMeta(session.notesSummary, updatedMeta),
        },
        select: { id: true, status: true, clientId: true },
      });
      // Linked appointment: AutoPay decides from that appointment's current status (background, idempotent)
      after(() => triggerAutopayAfterVisitStatus(session.appointmentId, null, { userId: gate.userId, role: String(gate.role) }));

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
          placeOfService,
          placeOfServiceSource: posResult.source,
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
          placeOfService,
          placeOfServiceSource: posResult.source,
          status: placeOfService ? 'ATTACHED' : 'NEEDS_PLACE_OF_SERVICE',
        },
        scribe: {
          ready: true,
          scribeUrl: `/dashboard/ehr/notes?clientId=${updated.clientId}&appointmentId=${updated.id}&guide=1&telehealth=1&scribe=1`,
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
