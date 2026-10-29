import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import {
  deleteChimeMeeting,
  getOrCreateChimeRoom,
  isChimeLive,
} from '@/lib/telehealth/chime';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { prisma } from '@/lib/db/prisma';
import { canAccessClientAppointments, clientOrgFilter } from '@/lib/clients/orgScope';
import { gateClientRoute } from '@/lib/clients/clientRouteGate';

/**
 * The appointment must be in the caller's org, and the caller must be its clinician or have
 * appointment + chart access to the client (org, Part 2, caseload / care team). Denials audited.
 */
async function appointmentAccess(
  gate: { organizationId: string; userId: string; role: string },
  appointmentId: string,
  action: string,
): Promise<{ ok: true } | { ok: false; status: 403 | 404; error: string }> {
  const appt = await prisma.appointment.findFirst({
    where: {
      id: appointmentId,
      OR: [{ organizationId: gate.organizationId }, { client: clientOrgFilter(gate.organizationId) }],
    },
    select: { id: true, clientId: true, clinicianId: true },
  });
  let reason: string | null = null;
  if (!appt) reason = 'appointment_not_found';
  else if (appt.clinicianId !== gate.userId) {
    const access = await gateClientRoute({
      organizationId: gate.organizationId,
      userId: gate.userId,
      role: gate.role,
      clientId: appt.clientId,
      path: '/api/telehealth/room',
      roleAllowed: canAccessClientAppointments(gate.role),
    });
    if (access.ok === false) reason = access.reason;
  }
  if (!reason) return { ok: true };
  await writeAuditLog({
    action,
    actorUserId: gate.userId,
    actorRole: gate.role,
    organizationId: gate.organizationId,
    resourceType: 'ChimeMeeting',
    resourceId: appointmentId,
    patientId: appt?.clientId ?? null,
    outcome: 'DENIED',
    metadata: { reason },
  });
  return appt ? { ok: false, status: 403, error: 'Forbidden' } : { ok: false, status: 404, error: 'Appointment not found' };
}

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
    const allowed = await appointmentAccess(gate, appointmentId, 'telehealth.chime.join');
    if (allowed.ok === false) {
      return NextResponse.json({ success: false, error: allowed.error }, { status: allowed.status });
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
  const allowed = await appointmentAccess(gate, appointmentId, 'telehealth.chime.end');
  if (allowed.ok === false) {
    return NextResponse.json({ success: false, error: allowed.error }, { status: allowed.status });
  }
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
