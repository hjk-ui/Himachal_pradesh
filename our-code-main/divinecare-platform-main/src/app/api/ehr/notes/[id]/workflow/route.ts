import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { updateProgressNoteWorkflow } from '@/lib/notes/workflow-store';

export const runtime = 'nodejs';

const paramsSchema = z.object({
  id: z.string().min(1).max(128),
});

const bodySchema = z.object({
  status: z.enum(['Signed', 'Locked']),
  lateEntryReason: z.string().trim().max(2000).optional().nullable(),
  /** Words after the fixed risk attestation prefix (TRANSCRIPT_RISK gate). */
  riskAttestationReason: z.string().max(1200).optional().nullable(),
});

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/ehr/notes')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const { id } = paramsSchema.parse(await ctx.params);
  const body = bodySchema.parse(await req.json());

  const result = await updateProgressNoteWorkflow({
    noteId: id,
    organizationId: gate.organizationId,
    actorUserId: gate.userId,
    actorRole: gate.role,
    status: body.status,
    lateEntryReason: body.lateEntryReason,
    riskAttestationReason: body.riskAttestationReason,
  });

  if (!result.ok) {
    const errorResult = result as { ok: false; status: number; error: string; code?: string };
    return NextResponse.json(
      { success: false, error: errorResult.error, ...(errorResult.code ? { code: errorResult.code } : {}) },
      { status: errorResult.status }
    );
  }

  return NextResponse.json({
    success: true,
    status: result.status,
    snapshot: result.snapshot,
    exceptionLabel: result.exceptionLabel ?? null,
  });
}
