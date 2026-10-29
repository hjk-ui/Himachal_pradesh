import { NextResponse } from 'next/server';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { findGroupCapture, groupCaptureView, loadGroupSegments, speakerSummary } from '@/lib/scribe/groupStore';
import { jsonError, scribeGate } from '../../_lib/gate';

export const runtime = 'nodejs';

/** GET — group capture, speaker labels (turn counts + a short sample) for the mapping step, and the draft. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await scribeGate();
  if (g.ok === false) return g.response;
  const { id } = await ctx.params;
  const cap = await findGroupCapture(g.actor, id);
  if (!cap) return jsonError(404, 'Capture not found');
  const segments = cap.transcriptPurgedAt ? [] : await loadGroupSegments(cap.id);
  await auditPhiAccess({ gate: g.gate, req, action: 'READ', resourceType: 'scribeGroupCapture', resourceId: cap.id, metadata: { segments: segments.length } });
  return NextResponse.json(
    { success: true, capture: groupCaptureView(cap), speakers: speakerSummary(segments), lines: segments.length },
    { headers: { 'Cache-Control': 'private, no-store' } }
  );
}
