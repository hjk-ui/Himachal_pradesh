import { NextResponse } from 'next/server';
import { z } from 'zod';
import { saveGoal } from '@/lib/hr/performance';
import { auditHr, hrGate, hrJsonError, hrServerError, loadRoster } from '@/lib/hr/server';
import { isHrAdminRole } from '@/lib/hr/standard';

export const runtime = 'nodejs';

const bodySchema = z.object({
  id: z.string().max(128).optional().nullable(),
  userId: z.string().min(1).max(128),
  title: z.string().trim().max(200).optional(),
  description: z.string().trim().max(2000).optional().nullable(),
  dueOn: z.string().trim().max(10).optional().nullable(),
  status: z.enum(['not_started', 'on_track', 'at_risk', 'complete', 'dropped']).optional(),
  progressPct: z.number().min(0).max(100).optional(),
});

/** POST /api/hr/goals: add or update a goal (the employee, their manager, or HR). */
export async function POST(req: Request) {
  const g = await hrGate('staff');
  if (g.ok === false) return g.response;
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return hrJsonError('Check the goal', 400);
  }
  try {
    const roster = await loadRoster(g.ctx.organizationId);
    const canEditFor = (userId: string) => {
      if (isHrAdminRole(g.ctx.role) || userId === g.ctx.userId) return true;
      const p = roster.find((r) => r.userId === userId);
      return Boolean(p && (p.managerUserId === g.ctx.userId || p.clinicalSupervisorUserId === g.ctx.userId));
    };
    const result = await saveGoal(g.ctx, body, canEditFor);
    if (!result.ok) return hrJsonError(result.error, result.status);
    await auditHr(g.ctx, req, body.id ? 'UPDATE' : 'CREATE', 'hrGoal', result.id, { staffUserId: body.userId });
    return NextResponse.json({ success: true, id: result.id });
  } catch (err) {
    return hrServerError('goal save', err);
  }
}
