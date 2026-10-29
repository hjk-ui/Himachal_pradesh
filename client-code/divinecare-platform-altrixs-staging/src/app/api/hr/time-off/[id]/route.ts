import { NextResponse } from 'next/server';
import { z } from 'zod';
import { SCHEDULE_INTEGRATION, decideTimeOff } from '@/lib/hr/timeOff';
import { auditHr, hrGate, hrJsonError, hrServerError } from '@/lib/hr/server';

export const runtime = 'nodejs';

const bodySchema = z.object({ decision: z.enum(['approved', 'denied', 'cancelled']), note: z.string().trim().max(300).optional().nullable() });

/**
 * PATCH /api/hr/time-off/[id]: the supervisor or HR approves / denies; the requester (or approver)
 * cancels. Approval counts the clinician's booked appointments in the window (number only).
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await hrGate('staff');
  if (g.ok === false) return g.response;
  const { id } = await ctx.params;
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return hrJsonError('Invalid request', 400);
  }
  try {
    const result = await decideTimeOff(g.ctx, id, body.decision, body.note);
    if (!result.ok) {
      if (result.status === 403) await auditHr(g.ctx, req, 'UPDATE', 'hrTimeOffRequest', id, { decision: body.decision }, 'DENIED');
      return hrJsonError(result.error, result.status);
    }
    await auditHr(g.ctx, req, 'UPDATE', 'hrTimeOffRequest', id, { decision: body.decision, staffUserId: result.userId, scheduleConflicts: result.scheduleConflicts });
    return NextResponse.json({
      success: true,
      scheduleConflicts: result.scheduleConflicts,
      balance: result.balance,
      negativeBalance: result.negativeBalance,
      scheduleIntegration: SCHEDULE_INTEGRATION,
    });
  } catch (err) {
    return hrServerError('time off decide', err);
  }
}
