import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { auditHr, hrGate, hrJsonError, hrServerError } from '@/lib/hr/server';
import { isHrAdminRole, ymd } from '@/lib/hr/standard';

export const runtime = 'nodejs';

/** GET /api/hr/tasks?audience=hr|mine: in-app HR reminders (the HR queue, or the viewer's own). */
export async function GET(req: Request) {
  const g = await hrGate('staff');
  if (g.ok === false) return g.response;
  const audience = new URL(req.url).searchParams.get('audience') === 'hr' ? 'hr' : 'mine';
  if (audience === 'hr' && !isHrAdminRole(g.ctx.role)) return hrJsonError('Forbidden', 403);
  try {
    const rows = await prisma.hrTask.findMany({
      where:
        audience === 'hr'
          ? { organizationId: g.ctx.organizationId, audience: 'hr', status: 'open' }
          : { organizationId: g.ctx.organizationId, assigneeUserId: g.ctx.userId, status: 'open' },
      orderBy: [{ dueOn: 'asc' }],
      take: 200,
    });
    return NextResponse.json({
      success: true,
      tasks: rows.map((t) => ({
        id: t.id,
        kind: t.kind,
        title: t.title,
        detail: t.detail,
        dueOn: ymd(t.dueOn),
        severity: t.severity,
        href: t.href,
        subjectUserId: t.subjectUserId,
      })),
    });
  } catch (err) {
    return hrServerError('tasks', err);
  }
}

const patchSchema = z.object({ id: z.string().min(1).max(128), status: z.enum(['open', 'done', 'dismissed']) });

/** PATCH /api/hr/tasks: mark a reminder done or dismissed (HR for HR reminders; the assignee for theirs). */
export async function PATCH(req: Request) {
  const g = await hrGate('staff');
  if (g.ok === false) return g.response;
  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await req.json());
  } catch {
    return hrJsonError('Invalid request', 400);
  }
  try {
    const task = await prisma.hrTask.findFirst({ where: { id: body.id, organizationId: g.ctx.organizationId } });
    if (!task) return hrJsonError('Reminder not found', 404);
    const allowed = task.audience === 'hr' ? isHrAdminRole(g.ctx.role) : task.assigneeUserId === g.ctx.userId;
    if (!allowed) return hrJsonError('Forbidden', 403);
    await prisma.hrTask.update({
      where: { id: task.id },
      data: { status: body.status, completedById: g.ctx.userId, resolvedAt: body.status === 'open' ? null : new Date() },
    });
    await auditHr(g.ctx, req, 'UPDATE', 'hrTask', task.id, { status: body.status, kind: task.kind });
    return NextResponse.json({ success: true });
  } catch (err) {
    return hrServerError('task update', err);
  }
}
