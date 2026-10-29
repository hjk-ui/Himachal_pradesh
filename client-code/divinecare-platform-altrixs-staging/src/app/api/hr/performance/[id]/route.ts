import { NextResponse } from 'next/server';
import { z } from 'zod';
import { updateReview, type ReviewAction } from '@/lib/hr/performance';
import { auditHr, hrGate, hrJsonError, hrServerError } from '@/lib/hr/server';

export const runtime = 'nodejs';

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('self_submit'), selfReview: z.string().trim().min(1).max(10000) }),
  z.object({
    action: z.literal('save_manager'),
    managerNotes: z.string().max(10000).optional().nullable(),
    managerReview: z.string().max(20000).optional().nullable(),
    overallRating: z.enum(['exceeds', 'meets', 'partially_meets', 'does_not_meet']).optional().nullable(),
    aiDraftUsed: z.boolean().optional(),
  }),
  z.object({ action: z.literal('refresh_metrics') }),
  z.object({ action: z.literal('manager_sign') }),
  z.object({ action: z.literal('acknowledge'), employeeComment: z.string().trim().max(4000).optional().nullable() }),
  z.object({ action: z.literal('reassign'), reviewerId: z.string().max(128).nullable(), dueOn: z.string().trim().max(10).optional().nullable() }),
]);

/** PATCH /api/hr/performance/[id]: self review, manager draft / sign, employee acknowledgment, metrics. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await hrGate('staff');
  if (g.ok === false) return g.response;
  const { id } = await ctx.params;
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return hrJsonError('Invalid review update', 400);
  }
  try {
    const result = await updateReview(g.ctx, id, body as ReviewAction);
    if (!result.ok) {
      if (result.status === 403) await auditHr(g.ctx, req, 'UPDATE', 'hrPerformanceReview', id, { action: body.action }, 'DENIED');
      return hrJsonError(result.error, result.status);
    }
    await auditHr(g.ctx, req, 'UPDATE', 'hrPerformanceReview', id, { action: body.action, staffUserId: result.userId });
    return NextResponse.json({ success: true });
  } catch (err) {
    return hrServerError('review update', err);
  }
}
