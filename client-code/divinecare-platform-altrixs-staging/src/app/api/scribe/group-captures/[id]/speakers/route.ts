import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { GROUP_CLINICIAN, GROUP_UNATTRIBUTED, memberSpeakerValue } from '@/lib/scribe/group';
import { findGroupCapture, groupCaptureView, groupMembersOf } from '@/lib/scribe/groupStore';
import { jsonError, scribeGate } from '../../../_lib/gate';

export const runtime = 'nodejs';

const bodySchema = z.object({ map: z.record(z.string().trim().min(1).max(80), z.string().max(160)) });

/**
 * PATCH — quick mapping step: each speaker label → the clinician, one member present
 * ("member:<clientId>", members of this capture only) or unattributed (never used).
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await scribeGate();
  if (g.ok === false) return g.response;
  const { id } = await ctx.params;
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return jsonError(400, 'Invalid speaker mapping');
  }
  const cap = await findGroupCapture(g.actor, id);
  if (!cap) return jsonError(404, 'Capture not found');
  if (cap.clinicianId !== g.actor.userId) return jsonError(403, 'Only the capturing clinician can map speakers');
  const allowed = new Set([GROUP_CLINICIAN, GROUP_UNATTRIBUTED, ...groupMembersOf(cap).map((m) => memberSpeakerValue(m.clientId))]);
  const map: Record<string, string> = {};
  for (const [label, v] of Object.entries(body.map)) {
    if (!allowed.has(v)) return jsonError(422, 'A speaker was mapped to someone who is not in this capture.');
    map[label] = v;
  }
  const updated = await prisma.scribeGroupCapture.update({ where: { id: cap.id }, data: { speakerMap: map } });
  await auditPhiAccess({ gate: g.gate, req, action: 'WRITE', resourceType: 'scribeSpeakerMap', resourceId: cap.id, metadata: { labels: Object.keys(map).length } });
  return NextResponse.json({ success: true, capture: groupCaptureView(updated) });
}
