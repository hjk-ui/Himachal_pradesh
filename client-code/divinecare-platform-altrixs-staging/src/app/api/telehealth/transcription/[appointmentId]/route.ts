import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { loadStoredChimeMeeting, isChimeLive } from '@/lib/telehealth/chime';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import type { Role } from '@prisma/client';

export const runtime = 'nodejs';

/**
 * GET /api/telehealth/transcription/:appointmentId
 * Recording → Transcribe Medical is optional; until MediaCapturePipeline is wired
 * we return an honest status (NO_RECORDING / PENDING / COMPLETED).
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

  const { appointmentId } = await ctx.params;
  // The id must be an appointment (or telehealth session) of the caller's org, for a client they can
  // see; loadStoredChimeMeeting itself looks up by bare id, so it is only called after this check.
  const client = clientAccessWhere({ organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role as Role });
  const [appointment, session] = await Promise.all([
    prisma.appointment.findFirst({ where: { id: appointmentId, organizationId: gate.organizationId, client }, select: { id: true } }),
    prisma.telehealthSession.findFirst({ where: { id: appointmentId, organizationId: gate.organizationId, client }, select: { id: true } }),
  ]);
  if (!appointment && !session) {
    return NextResponse.json({ success: false, error: 'Session not found' }, { status: 404 });
  }
  const stored = await loadStoredChimeMeeting(appointmentId);

  if (!stored) {
    return NextResponse.json({
      success: true,
      appointmentId,
      status: 'NO_RECORDING' as const,
      transcript: null,
      demoMode: !isChimeLive(),
      message: 'No Chime meeting on file for this session.',
    });
  }

  // Media capture / Transcribe Medical not enabled yet — honest status for UI polling
  return NextResponse.json({
    success: true,
    appointmentId,
    meetingId: stored.meetingId,
    status: 'NO_RECORDING' as const,
    transcript: null,
    demoMode: !isChimeLive(),
    message:
      'Session recording is not enabled. Use Generate Note without a transcript.',
  });
}
