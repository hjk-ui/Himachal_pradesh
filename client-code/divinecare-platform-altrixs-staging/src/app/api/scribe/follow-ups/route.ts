import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { FOLLOW_UP_HREF } from '@/lib/scribe/followUps';
import { FOLLOW_UP_KINDS } from '@/lib/scribe/draft';
import { findCapture } from '@/lib/scribe/store';
import { jsonError, scribeGate } from '../_lib/gate';

export const runtime = 'nodejs';

const postSchema = z.object({
  captureId: z.string().min(1).max(128),
  kind: z.enum(FOLLOW_UP_KINDS),
  title: z.string().trim().min(3).max(200),
  detail: z.string().trim().max(500).optional(),
});
const patchSchema = z.object({ id: z.string().min(1).max(128), status: z.enum(['DONE', 'DISMISSED', 'OPEN']) });

/** POST — the clinician accepts a suggested follow-up: it becomes a My To-Do item for them. */
export async function POST(req: Request) {
  const g = await scribeGate();
  if (g.ok === false) return g.response;
  let body: z.infer<typeof postSchema>;
  try {
    body = postSchema.parse(await req.json());
  } catch {
    return jsonError(400, 'Invalid follow-up');
  }
  const cap = await findCapture(g.actor, body.captureId);
  if (!cap) return jsonError(404, 'Capture not found');
  const row = await prisma.scribeFollowUp.create({
    data: {
      organizationId: g.actor.organizationId,
      sessionId: cap.id,
      clientId: cap.clientId,
      ownerId: g.actor.userId,
      kind: body.kind,
      title: body.title,
      detail: body.detail || null,
      href: FOLLOW_UP_HREF[body.kind](cap.clientId),
    },
  });
  await auditPhiAccess({ gate: g.gate, req, action: 'WRITE', resourceType: 'scribeFollowUp', resourceId: row.id, patientId: cap.clientId, metadata: { kind: body.kind } });
  return NextResponse.json({ success: true, followUp: { id: row.id, kind: row.kind, title: row.title, href: row.href, status: row.status } }, { status: 201 });
}

/** PATCH — mark one of your follow-ups done / dismissed / open. */
export async function PATCH(req: Request) {
  const g = await scribeGate();
  if (g.ok === false) return g.response;
  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await req.json());
  } catch {
    return jsonError(400, 'Invalid request');
  }
  const row = await prisma.scribeFollowUp.findFirst({ where: { id: body.id, organizationId: g.actor.organizationId, ownerId: g.actor.userId } });
  if (!row) return jsonError(404, 'Follow-up not found');
  await prisma.scribeFollowUp.update({ where: { id: row.id }, data: { status: body.status, completedAt: body.status === 'OPEN' ? null : new Date() } });
  await auditPhiAccess({ gate: g.gate, req, action: 'WRITE', resourceType: 'scribeFollowUp', resourceId: row.id, patientId: row.clientId, metadata: { status: body.status } });
  return NextResponse.json({ success: true });
}
