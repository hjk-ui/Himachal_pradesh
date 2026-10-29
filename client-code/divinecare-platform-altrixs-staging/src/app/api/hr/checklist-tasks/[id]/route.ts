import { NextResponse } from 'next/server';
import { z } from 'zod';
import { updateChecklistTask } from '@/lib/hr/checklists';
import { auditHr, hrGate, hrJsonError, hrServerError } from '@/lib/hr/server';

export const runtime = 'nodejs';

const patchSchema = z.object({
  status: z.enum(['open', 'done', 'skipped']).optional(),
  note: z.string().trim().max(1000).optional().nullable(),
  acknowledge: z.boolean().optional(),
  documentId: z.string().max(128).optional().nullable(),
  assigneeUserId: z.string().max(128).optional().nullable(),
  dueOn: z.string().trim().max(10).optional().nullable(),
  /** deactivate_user: administrators deactivate the Altrixs account from the task */
  performAction: z.boolean().optional(),
});

/**
 * PATCH /api/hr/checklist-tasks/[id]: complete / reopen / skip a task, acknowledge a policy,
 * attach an uploaded document. HR any task; staff their own employee tasks; assignees theirs.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await hrGate('staff');
  if (g.ok === false) return g.response;
  const { id } = await ctx.params;
  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await req.json());
  } catch {
    return hrJsonError('Invalid update', 400);
  }
  try {
    const result = await updateChecklistTask(g.ctx, id, body);
    if (!result.ok) {
      if (result.status === 403) await auditHr(g.ctx, req, 'UPDATE', 'hrChecklistTask', id, { reason: 'not_permitted' }, 'DENIED');
      return hrJsonError(result.error, result.status);
    }
    await auditHr(g.ctx, req, 'UPDATE', 'hrChecklistTask', id, {
      staffUserId: result.userId,
      status: body.status ?? null,
      acknowledged: Boolean(body.acknowledge),
      systemAction: result.systemAction,
      actionResult: result.actionResult,
    });
    return NextResponse.json({ success: true, actionResult: result.actionResult });
  } catch (err) {
    return hrServerError('checklist task', err);
  }
}
