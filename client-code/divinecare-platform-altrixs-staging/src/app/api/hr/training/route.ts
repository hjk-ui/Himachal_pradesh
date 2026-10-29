import { NextResponse } from 'next/server';
import { z } from 'zod';
import { recordCompletion, trainingMatrix } from '@/lib/hr/training';
import { auditHr, hrGate, hrJsonError, hrServerError } from '@/lib/hr/server';
import { isCredentialingRole } from '@/lib/hr/standard';

export const runtime = 'nodejs';

/** GET /api/hr/training: requirement matrix, compliance %, CEU progress, completions waiting for review. */
export async function GET(req: Request) {
  const g = await hrGate('credentialing');
  if (g.ok === false) return g.response;
  try {
    const data = await trainingMatrix(g.ctx.organizationId);
    await auditHr(g.ctx, req, 'LIST', 'hrTraining', null, { rows: data.rows.length });
    return NextResponse.json({ success: true, ...data });
  } catch (err) {
    return hrServerError('training', err);
  }
}

const completionSchema = z.object({
  userId: z.string().min(1).max(128),
  requirementId: z.string().max(128).optional().nullable(),
  title: z.string().trim().max(200).optional().nullable(),
  completedOn: z.string().trim().length(10),
  expiresOn: z.string().trim().max(10).optional().nullable(),
  hours: z.number().min(0).max(500).optional().nullable(),
  ceuEligible: z.boolean().optional(),
  credentialId: z.string().max(128).optional().nullable(),
  provider: z.string().trim().max(160).optional().nullable(),
  certificateNumber: z.string().trim().max(80).optional().nullable(),
  certificateDocumentId: z.string().max(128).optional().nullable(),
});

/**
 * POST /api/hr/training: record a completion. HR / leadership / OM record verified completions
 * for anyone; any staff member can self-report their own (pending HR review).
 */
export async function POST(req: Request) {
  const g = await hrGate('staff');
  if (g.ok === false) return g.response;
  let body: z.infer<typeof completionSchema>;
  try {
    body = completionSchema.parse(await req.json());
  } catch {
    return hrJsonError('Check the training details', 400);
  }
  try {
    const selfService = !isCredentialingRole(g.ctx.role);
    const result = await recordCompletion(g.ctx, body, { selfService });
    if (!result.ok) return hrJsonError(result.error, result.status);
    await auditHr(g.ctx, req, 'CREATE', 'hrTrainingCompletion', result.id, { staffUserId: body.userId, selfService, ceu: Boolean(body.ceuEligible) });
    return NextResponse.json({ success: true, id: result.id }, { status: 201 });
  } catch (err) {
    return hrServerError('training record', err);
  }
}
