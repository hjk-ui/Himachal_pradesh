import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireDiagnosisAccess } from '@/lib/diagnoses/route-gate';
import { updateDiagnosis } from '@/lib/diagnoses/list';
import { DIAGNOSIS_COPY } from '@/lib/diagnoses/copy';
import { DIAGNOSIS_STATUSES } from '@/lib/diagnoses/types';

export const runtime = 'nodejs';

const paramsSchema = z.object({ id: z.string().min(1).max(128), dxId: z.string().min(1).max(128) });

const patchSchema = z
  .object({
    /** Accepted only so a changed code can be rejected with the exact copy. */
    code: z.string().trim().max(12).optional(),
    description: z.string().trim().min(1).max(300).optional(),
    dsm5Name: z.string().trim().max(200).optional().nullable(),
    status: z.enum(DIAGNOSIS_STATUSES).optional(),
    isPrimary: z.boolean().optional(),
    onsetDate: z.string().trim().max(10).optional().nullable(),
    resolvedDate: z.string().trim().max(10).optional().nullable(),
    needsCoding: z.boolean().optional(),
  })
  .strict();

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string; dxId: string }> }) {
  const { id, dxId } = paramsSchema.parse(await ctx.params);
  const gate = await requireDiagnosisAccess(id, 'write');
  if (gate.ok === false) return gate.response;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Invalid diagnosis update' }, { status: 400 });
  }
  const result = await updateDiagnosis(gate.actor, id, dxId, parsed.data);
  if (result.ok === false) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
  return NextResponse.json({ success: true, diagnosis: result.value });
}

/** Diagnoses are never deleted. */
export async function DELETE() {
  return NextResponse.json(
    { success: false, error: DIAGNOSIS_COPY.noDelete },
    { status: 405, headers: { Allow: 'PATCH' } }
  );
}
