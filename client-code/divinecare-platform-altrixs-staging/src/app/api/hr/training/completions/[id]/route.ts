import { NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyCompletion } from '@/lib/hr/training';
import { auditHr, hrGate, hrJsonError, hrServerError } from '@/lib/hr/server';

export const runtime = 'nodejs';

const bodySchema = z.object({ decision: z.enum(['verified', 'rejected']) });

/** PATCH: HR verifies (or rejects) a self-reported training completion. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await hrGate('credentialing');
  if (g.ok === false) return g.response;
  const { id } = await ctx.params;
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return hrJsonError('Invalid request', 400);
  }
  try {
    const result = await verifyCompletion(g.ctx, id, body.decision);
    if (!result.ok) return hrJsonError(result.error, result.status);
    await auditHr(g.ctx, req, 'UPDATE', 'hrTrainingCompletion', id, { decision: body.decision, staffUserId: result.userId });
    return NextResponse.json({ success: true });
  } catch (err) {
    return hrServerError('training verify', err);
  }
}
