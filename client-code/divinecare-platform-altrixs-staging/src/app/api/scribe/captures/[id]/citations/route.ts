import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { findCapture } from '@/lib/scribe/store';
import { jsonError, scribeGate } from '../../../_lib/gate';

export const runtime = 'nodejs';

const bodySchema = z.object({ draftId: z.string().min(1).max(128), cites: z.number().int().min(0).max(50) });

/** POST — audit that the clinician opened a sentence's transcript citations (ids / counts only). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await scribeGate();
  if (g.ok === false) return g.response;
  const { id } = await ctx.params;
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return jsonError(400, 'Invalid request');
  }
  const cap = await findCapture(g.actor, id);
  if (!cap) return jsonError(404, 'Capture not found');
  await auditPhiAccess({
    gate: g.gate,
    req,
    action: 'SCRIBE_CITATION_VIEW',
    resourceType: 'scribeDraft',
    resourceId: body.draftId,
    patientId: cap.clientId,
    metadata: { captureId: cap.id, cites: body.cites },
  });
  return NextResponse.json({ success: true });
}
