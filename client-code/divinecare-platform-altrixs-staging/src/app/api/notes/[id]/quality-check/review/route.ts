import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { cosignProgressNote } from '@/lib/notes/workflow-store';
import { loadQualityContext } from '@/lib/ai/noteQuality/load';
import { checkQualityAccess } from '@/lib/ai/noteQuality/access';
import { recordQualityReview } from '@/lib/ai/noteQuality/reviewStore';

export const runtime = 'nodejs';

const paramsSchema = z.object({ id: z.string().min(1).max(128) });
const findingSchema = z.object({
  id: z.string().min(1).max(80),
  label: z.string().min(1).max(120),
  status: z.enum(['warn', 'fail']),
  fix: z.string().max(400).nullable(),
});
const bodySchema = z.object({
  /** return = send back to the author with the checklist; cosign = co-sign anyway, findings recorded */
  action: z.enum(['return', 'cosign']),
  comment: z.string().trim().max(4000).optional(),
  /** The warn / fail items the supervisor saw */
  findings: z.array(findingSchema).max(60).default([]),
});

/**
 * POST /api/notes/[id]/quality-check/review — the supervisor's decision on a checked note.
 * "Return to author" records the checklist for the author (the signed note is not reopened; the
 * author corrects it with an addendum). "Co-sign" co-signs exactly like /api/ehr/notes/[id]/cosign
 * and records the findings and comment. The note text is never changed.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });

  const params = paramsSchema.safeParse(await ctx.params);
  const parsed = bodySchema.safeParse((await req.json().catch(() => null)) ?? null);
  if (!params.success || !parsed.success) {
    return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
  }
  const { id } = params.data;
  const { action } = parsed.data;
  const findings = parsed.data.findings.map((f) => ({ id: f.id, label: f.label, status: f.status, fix: f.fix ?? null }));
  const comment = parsed.data.comment ? parsed.data.comment : null;

  const loaded = await loadQualityContext({ noteId: id, organizationId: gate.organizationId, mode: 'cosign' });
  if (loaded.ok === false) return NextResponse.json({ success: false, error: loaded.error }, { status: loaded.status });
  const { clientId, authorIds, facts } = loaded.ctx;

  const access = await checkQualityAccess({
    organizationId: gate.organizationId,
    userId: gate.userId,
    role: gate.role,
    mode: 'cosign',
    clientId,
    authorIds,
    path: `/api/notes/${id}/quality-check/review`,
  });
  if (access.ok === false) {
    await auditPhiAccess({ gate, req, action: action === 'return' ? 'NOTE_QUALITY_RETURN' : 'NOTE_COSIGN', resourceType: 'progressNote', resourceId: id, patientId: clientId, outcome: 'DENIED', metadata: { reason: access.reason } });
    return NextResponse.json(access.body ?? { success: false, error: access.error }, { status: access.status });
  }

  const reviewer = await prisma.user.findUnique({ where: { id: gate.userId }, select: { name: true, email: true } });
  const reviewerName = reviewer?.name?.trim() || reviewer?.email || null;
  const failCount = findings.filter((f) => f.status === 'fail').length;

  if (action === 'return') {
    if (!facts.workflow || facts.workflow.status === 'DRAFT') {
      return NextResponse.json({ success: false, error: 'Only signed notes awaiting co-signature can be returned.' }, { status: 409 });
    }
    if (findings.length === 0 && !comment) {
      return NextResponse.json({ success: false, error: 'Add a comment or keep at least one checklist item to return the note.' }, { status: 400 });
    }
    const saved = await recordQualityReview({ organizationId: gate.organizationId, noteId: id, clientId, reviewerId: gate.userId, reviewerName, action: 'RETURNED', comment, findings });
    await auditPhiAccess({
      gate,
      req,
      action: 'NOTE_QUALITY_RETURN',
      resourceType: 'progressNote',
      resourceId: id,
      patientId: clientId,
      metadata: { reviewId: saved.id, findingCount: findings.length, failCount, hasComment: comment !== null },
    });
    return NextResponse.json({ success: true, action: 'RETURNED', reviewId: saved.id, createdAt: saved.createdAt });
  }

  // checkQualityAccess above already ran the co-sign scope + Part 2 (assertClientPhiAccess) checks
  const result = await cosignProgressNote({ noteId: id, organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role, comment, phiAccessChecked: true });
  if (result.ok === false) {
    if (result.reason) {
      await auditPhiAccess({ gate, req, action: 'NOTE_COSIGN', resourceType: 'progressNote', resourceId: id, patientId: clientId, outcome: 'DENIED', metadata: { reason: result.reason } });
    }
    return NextResponse.json({ success: false, error: result.error }, { status: result.status });
  }
  const saved = await recordQualityReview({ organizationId: gate.organizationId, noteId: id, clientId, reviewerId: gate.userId, reviewerName, action: 'COSIGNED', comment, findings }).catch(
    (e) => {
      console.error('[noteQuality] co-signed, but the checklist record failed', e);
      return null;
    }
  );
  await auditPhiAccess({
    gate,
    req,
    action: 'NOTE_COSIGN',
    resourceType: 'progressNote',
    resourceId: id,
    patientId: result.clientId,
    metadata: { cosignerUserId: gate.userId, cosignBasis: result.basis, hasComment: comment !== null, qualityReviewId: saved?.id ?? null, findingCount: findings.length, failCount },
  });
  return NextResponse.json({
    success: true,
    action: 'COSIGNED',
    cosignedAt: result.cosignedAt,
    cosignedByName: result.cosignedByName,
    supervisorComment: result.supervisorComment,
  });
}
