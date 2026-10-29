import { NextResponse } from 'next/server';
import { z } from 'zod';
import { listChecklists, listTemplates, startChecklist } from '@/lib/hr/checklists';
import { auditHr, hrGate, hrJsonError, hrServerError, loadRoster, practiceTodayFor } from '@/lib/hr/server';

export const runtime = 'nodejs';

/** GET /api/hr/checklists?kind=onboarding|offboarding&status=active: HR + leadership. */
export async function GET(req: Request) {
  const g = await hrGate('admin');
  if (g.ok === false) return g.response;
  try {
    const sp = new URL(req.url).searchParams;
    const kind = sp.get('kind') === 'offboarding' ? 'offboarding' : 'onboarding';
    const status = sp.get('status') || undefined;
    const today = await practiceTodayFor(g.ctx.organizationId);
    const [checklists, templates, roster] = await Promise.all([
      listChecklists(g.ctx.organizationId, { kind, status, today }),
      listTemplates(g.ctx.organizationId, kind),
      loadRoster(g.ctx.organizationId),
    ]);
    await auditHr(g.ctx, req, 'LIST', 'hrChecklist', null, { kind, count: checklists.length });
    return NextResponse.json({
      success: true,
      today,
      viewer: { userId: g.ctx.userId, role: g.ctx.role },
      checklists,
      templates: templates.map((t) => ({ id: t.id, name: t.name, roles: t.roles, builtIn: t.builtIn, itemCount: t.items.length })),
      people: roster.map((p) => ({ userId: p.userId, name: p.name, role: p.role, hrStatus: p.hrStatus, hireDate: p.hireDate })),
    });
  } catch (err) {
    return hrServerError('checklists', err);
  }
}

const startSchema = z.object({
  userId: z.string().min(1).max(128),
  kind: z.enum(['onboarding', 'offboarding']),
  startOn: z.string().trim().length(10),
  templateId: z.string().max(128).optional().nullable(),
  separationType: z.enum(['voluntary', 'involuntary', 'retirement', 'end_of_contract', 'other']).optional().nullable(),
});

/** POST /api/hr/checklists: start onboarding (start date) or offboarding (last day). Audited. */
export async function POST(req: Request) {
  const g = await hrGate('admin');
  if (g.ok === false) return g.response;
  let body: z.infer<typeof startSchema>;
  try {
    body = startSchema.parse(await req.json());
  } catch {
    return hrJsonError('Choose a person and a date', 400);
  }
  if (body.kind === 'offboarding' && body.userId === g.ctx.userId) return hrJsonError('Another HR team member must start your offboarding', 403);
  try {
    const result = await startChecklist(g.ctx, body);
    if (!result.ok) return hrJsonError(result.error, result.status);
    await auditHr(g.ctx, req, 'CREATE', 'hrChecklist', result.id, {
      kind: body.kind,
      staffUserId: body.userId,
      tasks: result.taskCount,
      assignedClientCount: (result.meta as { assignedClientCount?: number } | null)?.assignedClientCount ?? null,
    });
    return NextResponse.json({ success: true, id: result.id, taskCount: result.taskCount }, { status: 201 });
  } catch (err) {
    return hrServerError('checklist start', err);
  }
}
