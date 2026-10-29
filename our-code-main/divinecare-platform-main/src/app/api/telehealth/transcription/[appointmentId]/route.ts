import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { loadStoredChimeMeeting, isChimeLive } from '@/lib/telehealth/chime';

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
      'Session recording / Transcribe Medical is not enabled yet. Use Generate Note without transcript, or enable CHIME_RECORDINGS_BUCKET + MediaCapturePipeline later.',
  });
}
