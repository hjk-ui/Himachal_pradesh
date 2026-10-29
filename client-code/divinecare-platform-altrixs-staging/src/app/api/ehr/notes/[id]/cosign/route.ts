import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { cosignProgressNote } from '@/lib/notes/workflow-store';
import { auditPhiAccess } from '@/lib/audit/requestMeta';

export const runtime = 'nodejs';

const paramsSchema = z.object({
  id: z.string().min(1).max(128),
});

const bodySchema = z.object({
  comment: z.string().trim().max(4000).optional(),
});

/** POST /api/ehr/notes/[id]/cosign — supervisor co-signature on a signed or locked note. */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/ehr/supervisor-review', gate.capabilities)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const params = paramsSchema.safeParse(await ctx.params);
  const parsed = bodySchema.safeParse((await req.json().catch(() => ({}))) ?? {});
  if (!params.success || !parsed.success) {
    return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
  }
  const { id } = params.data;
  const comment = parsed.data.comment ? parsed.data.comment : null;

  const result = await cosignProgressNote({
    noteId: id,
    organizationId: gate.organizationId,
    actorUserId: gate.userId,
    actorRole: gate.role,
    comment,
  });

  if (result.ok === false) {
    // Authority / Part 2 denials are audited (who tried to co-sign whose note)
    if (result.reason) {
      await auditPhiAccess({
        gate,
        req,
        action: 'NOTE_COSIGN',
        resourceType: 'progressNote',
        resourceId: id,
        patientId: result.clientId ?? null,
        outcome: 'DENIED',
        metadata: { reason: result.reason },
      });
    }
    return NextResponse.json(
      result.canRequestBreakGlass
        ? { success: false, error: result.error, canRequestBreakGlass: true }
        : { success: false, error: result.error },
      { status: result.status }
    );
  }

  await auditPhiAccess({
    gate,
    req,
    action: 'NOTE_COSIGN',
    resourceType: 'progressNote',
    resourceId: id,
    patientId: result.clientId,
    metadata: { cosignerUserId: gate.userId, hasComment: comment !== null, cosignBasis: result.basis },
  });

  return NextResponse.json({
    success: true,
    cosignedAt: result.cosignedAt,
    cosignedByName: result.cosignedByName,
    supervisorComment: result.supervisorComment,
  });
}
