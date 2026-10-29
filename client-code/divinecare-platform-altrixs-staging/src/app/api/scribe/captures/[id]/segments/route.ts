import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { SPEAKER_ROLES } from '@/lib/scribe/diarization';
import { appendSegmentsIfOpen, findCapture, loadLines } from '@/lib/scribe/store';
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
const patchSchema = z.object({ speakerLabel: z.string().trim().min(1).max(80), role: z.enum(SPEAKER_ROLES) });

/** POST — append finalized transcript turns (idempotent by seq). Only the capturing clinician. */
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
  const cap = await findCapture(g.actor, id);
  if (!cap) return jsonError(404, 'Capture not found');
  if (cap.clinicianId !== g.actor.userId) return jsonError(403, 'Only the capturing clinician can add transcript');
  if (cap.consentWithdrawnAt || cap.transcriptPurgedAt || cap.status === 'discarded' || cap.status === 'ready') {
    return jsonError(409, 'This capture is not accepting transcript.');
  }
  // Re-checked under a lock on the capture row: a dismiss / withdraw that lands first wins
  const added = await appendSegmentsIfOpen(cap, body.segments);
  if (added === null) return jsonError(409, 'This capture is not accepting transcript.');
  await auditPhiAccess({
    gate: g.gate,
    req,
    action: 'WRITE',
    resourceType: 'scribeTranscript',
    resourceId: cap.id,
    patientId: cap.clientId,
    metadata: { segments: added },
  });
  return NextResponse.json({ success: true, added });
}

/** PATCH — clinician corrects one speaker label's role (Clinician / Client / Other). */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await scribeGate();
  if (g.ok === false) return g.response;
  const { id } = await ctx.params;
  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await req.json());
  } catch {
    return jsonError(400, 'Invalid speaker correction');
  }
  const cap = await findCapture(g.actor, id);
  if (!cap) return jsonError(404, 'Capture not found');
  if (cap.clinicianId !== g.actor.userId) return jsonError(403, 'Only the capturing clinician can relabel speakers');
  const map = { ...((cap.speakerMap as Record<string, string> | null) ?? {}), [body.speakerLabel]: body.role };
  const updated = await prisma.scribeCapture.update({ where: { id: cap.id }, data: { speakerMap: map } });
  const { lines, speakerMap } = await loadLines(updated);
  await auditPhiAccess({
    gate: g.gate,
    req,
    action: 'WRITE',
    resourceType: 'scribeSpeakerMap',
    resourceId: cap.id,
    patientId: cap.clientId,
    metadata: { role: body.role },
  });
  return NextResponse.json({ success: true, lines, speakerMap });
}
