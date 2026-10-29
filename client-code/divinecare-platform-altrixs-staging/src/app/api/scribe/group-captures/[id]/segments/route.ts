import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { appendGroupSegmentsIfOpen, findGroupCapture } from '@/lib/scribe/groupStore';
import { jsonError, scribeGate } from '../../../_lib/gate';

export const runtime = 'nodejs';

const segmentSchema = z.object({
  seq: z.number().int().min(0).max(100000),
  speakerLabel: z.string().trim().min(1).max(80),
  startMs: z.number().min(0).max(24 * 3600 * 1000),
  endMs: z.number().min(0).max(24 * 3600 * 1000),
  text: z.string().trim().min(1).max(4000),
});
const postSchema = z.object({ segments: z.array(segmentSchema).min(1).max(200) });

/** POST — append finalized group transcript turns (idempotent by seq). Only the capturing clinician. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await scribeGate();
  if (g.ok === false) return g.response;
  const { id } = await ctx.params;
  let body: z.infer<typeof postSchema>;
  try {
    body = postSchema.parse(await req.json());
  } catch {
    return jsonError(400, 'Invalid segments');
  }
  const cap = await findGroupCapture(g.actor, id);
  if (!cap) return jsonError(404, 'Capture not found');
  if (cap.clinicianId !== g.actor.userId) return jsonError(403, 'Only the capturing clinician can add transcript');
  const added = await appendGroupSegmentsIfOpen(cap, body.segments);
  if (added === null) return jsonError(409, 'This capture is not accepting transcript.');
  await auditPhiAccess({ gate: g.gate, req, action: 'WRITE', resourceType: 'scribeGroupTranscript', resourceId: cap.id, metadata: { segments: added } });
  return NextResponse.json({ success: true, added });
}
