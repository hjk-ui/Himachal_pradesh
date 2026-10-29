import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { readTelehealthJoinToken } from '@/lib/telehealth/join-token';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { auditRequestMeta } from '@/lib/audit/requestMeta';
import { sessionDateYmd } from '@/lib/telehealth/practiceTiming';
import { checkInAppointmentData, checkInSessionData, parseTelehealthCheckIn } from '@/lib/telehealth/checkIn';

export const runtime = 'nodejs';

/**
 * Minimal public DTO for the join-link holder. Never return the TelehealthSession row:
 * it carries clinician/patient Chime join tokens, contact info, notes and recording URIs.
 */
function toCheckInDto(row: {
  status: string;
  sessionDate: Date;
  startTime: string;
  clinicianName: string | null;
}) {
  return {
    status: row.status,
    date: sessionDateYmd(row.sessionDate),
    startTime: row.startTime,
    clinicianName: row.clinicianName || 'Clinical staff',
  };
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ token: string }> }
) {
  try {
    const { token: rawToken } = await ctx.params;
    const token = decodeURIComponent(rawToken || '');
    // Only what the patient answered: consent checkbox, home/other, current state. Nothing defaulted.
    const parsed = parseTelehealthCheckIn(await req.json().catch(() => null));
    if ('error' in parsed) {
      return NextResponse.json({ success: false, error: parsed.error, field: parsed.field }, { status: 400 });
    }
    const body = parsed.value;

    // 1. Stored join token only (never the row id or appointmentId: those are not secrets).
    const lookupSelect = {
      id: true,
      clientId: true,
      organizationId: true,
      appointmentId: true,
      status: true,
    } as const;
    let session =
      token.length >= 16
        ? await prisma.telehealthSession.findFirst({
            where: { joinToken: token },
            select: lookupSelect,
          })
        : null;

    if (!session) {
      // 2. Signed HMAC token: must match BOTH the session and the client it was issued for.
      const payload = readTelehealthJoinToken(token);
      if (payload) {
        session = await prisma.telehealthSession.findFirst({
          where: {
            clientId: payload.clientId,
            OR: [{ id: payload.appointmentId }, { appointmentId: payload.appointmentId }],
          },
          select: lookupSelect,
        });
      }
    }

    if (!session) {
      return NextResponse.json({ success: false, error: 'Invalid or expired visit link' }, { status: 404 });
    }
    if (session.status === 'CANCELLED' || session.status === 'COMPLETED') {
      return NextResponse.json({ success: false, error: 'This visit is no longer available' }, { status: 410 });
    }

    const updated = await prisma.telehealthSession.update({
      where: { id: session.id },
      data: checkInSessionData(body),
      select: {
        status: true,
        sessionDate: true,
        startTime: true,
        clinicianName: true,
      },
    });

    await prisma.telehealthAuditLog.create({
      data: {
        sessionId: session.id,
        eventType: 'PATIENT_JOINED_LOBBY',
        performedBy: 'PATIENT',
        details: `Patient checked into virtual waiting lobby (${body.locationType}, ${body.locationState}). Informed consent signed.`,
      },
    });

    // Mirror the patient's answer onto the appointment so notes and claims derive POS from it.
    if (session.appointmentId) {
      await prisma.appointment.updateMany({
        where: { id: session.appointmentId, clientId: session.clientId ?? undefined },
        data: checkInAppointmentData(body),
      });
    }

    // Join-link holder (the patient, no portal session): ids/field names only.
    await writeAuditLog({
      action: 'TELEHEALTH_CHECK_IN',
      actorUserId: null,
      actorRole: 'PATIENT',
      organizationId: session.organizationId,
      resourceType: 'telehealthSession',
      resourceId: session.id,
      patientId: session.clientId,
      ...auditRequestMeta(req),
      metadata: {
        via: 'join-link',
        consentSigned: true,
        fields: ['clientConsentSigned', 'clientLocationState', 'patientLocationType', 'patientCheckedIn', 'patientCheckedInAt', 'status'],
      },
    });

    return NextResponse.json({
      success: true,
      session: toCheckInDto(updated),
      message: 'Checked into waiting lobby',
    });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: 'Invalid payload' }, { status: 400 });
    }
    // Public caller: details stay in server logs only.
    console.error('[telehealth/check-in] failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: 'Check-in failed' }, { status: 500 });
  }
}
