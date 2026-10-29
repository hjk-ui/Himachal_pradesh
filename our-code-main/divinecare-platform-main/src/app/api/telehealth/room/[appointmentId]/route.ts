import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import {
  deleteChimeMeeting,
  getOrCreateChimeRoom,
  isChimeLive,
} from '@/lib/telehealth/chime';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { canAccessClientChartNotes } from '@/lib/clients/orgScope';
import { canPrescribe } from '@/types/roles';
import { recordPhiAudit } from '@/lib/audit/phiAudit';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';

export const runtime = 'nodejs';

/**
 * GET /api/telehealth/room/:appointmentId
 * Returns Meeting + Attendee JoinToken for the caller (reuses stored meeting if active).
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ appointmentId: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/telehealth')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { appointmentId } = await ctx.params;
    const appointment = await prisma.appointment.findFirst({
      where: { id: appointmentId },
      select: { id: true, clinicianId: true, clientId: true, organizationId: true },
    });
    if (!appointment || (appointment.organizationId && appointment.organizationId !== gate.organizationId)) {
      return NextResponse.json({ success: false, error: 'Visit not found' }, { status: 404 });
    }
    const isVisitClinician = appointment.clinicianId === gate.userId;
    const clinical = canAccessClientChartNotes(gate.role) || canPrescribe(gate.role);
    let allowed = isVisitClinician;
    if (!allowed && clinical && appointment.clientId) {
      const client = await prisma.client.findFirst({
        where: {
          id: appointment.clientId,
          ...clientAccessWhere({
            organizationId: gate.organizationId,
            actorUserId: gate.userId,
            actorRole: gate.role,
          }),
        },
        select: { id: true },
      });
      allowed = Boolean(client);
    }
    if (!allowed) {
      await recordPhiAudit({
        organizationId: gate.organizationId,
        actorUserId: gate.userId,
        actorRole: gate.role,
        action: 'telehealth.room',
        resourceType: 'appointment',
        resourceId: appointmentId,
        patientId: appointment.clientId,
        outcome: 'DENIED',
      });
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }
    const room = await getOrCreateChimeRoom({
      appointmentId,
      patientId: appointmentId,
      patientName: 'Patient',
      clinicianName: gate.session.user.name || 'Clinician',
      durationMinutes: 50,
      externalUserId: (gate.session.user.name || 'clinician').slice(0, 64),
    });

    await writeAuditLog({
      action: 'telehealth.chime.join',
      actorUserId: gate.userId,
      organizationId: gate.organizationId,
      resourceType: 'ChimeMeeting',
      resourceId: room.meetingId,
      metadata: { appointmentId, demoMode: room.demoMode },
    });

    return NextResponse.json({
      success: true,
      meetingId: room.meetingId,
      meeting: room.meeting,
      attendee: room.attendee,
      joinToken: room.joinToken,
      expiresAt: room.expiresAt,
      provider: 'chime' as const,
      demoMode: room.demoMode || !isChimeLive(),
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'Could not join Chime room',
      },
      { status: 500 }
    );
  }
}

/** PATCH /api/telehealth/room/:appointmentId — end meeting */
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ appointmentId: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/telehealth')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const { appointmentId } = await ctx.params;
  let meetingId: string | undefined;
  try {
    const body = (await req.json().catch(() => ({}))) as { meetingId?: string };
    meetingId = body.meetingId;
  } catch {
    /* */
  }

  if (meetingId) {
    await deleteChimeMeeting(meetingId);
  }

  await writeAuditLog({
    action: 'telehealth.chime.end',
    actorUserId: gate.userId,
    organizationId: gate.organizationId,
    resourceType: 'ChimeMeeting',
    resourceId: meetingId || appointmentId,
    metadata: { appointmentId, demoMode: !isChimeLive() },
  });

  return NextResponse.json({
    success: true,
    appointmentId,
    meetingId: meetingId || null,
    ended: true,
    demoMode: !isChimeLive(),
    transcriptionStatus: 'NO_RECORDING' as const,
  });
}
