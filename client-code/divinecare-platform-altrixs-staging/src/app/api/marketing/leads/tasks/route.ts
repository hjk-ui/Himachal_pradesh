import { z } from 'zod';
import { bad, fromResult, marketingGate, ok, serverError } from '@/lib/marketing/http';
import { addLeadTask, completeTask, listOpenTasks } from '@/lib/marketing/leadService';
import { prisma } from '@/lib/db/prisma';
import { clinicalTermsIn } from '@/lib/marketing/leads';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const g = await marketingGate('leads');
  if (!g.ok) return g.res;
  try {
    const mine = new URL(req.url).searchParams.get('mine') === '1';
    return ok({ tasks: await listOpenTasks(g.gate.organizationId, mine ? g.gate.userId : undefined) });
  } catch (err) {
    return serverError('tasks GET', err);
  }
}

const createSchema = z.object({
  leadId: z.string().max(64).nullable().optional(),
  title: z.string().trim().min(2).max(200),
  dueAt: z.string().max(40).nullable().optional(),
  assignedToId: z.string().max(64).nullable().optional(),
});

export async function POST(req: Request) {
  const g = await marketingGate('leads');
  if (!g.ok) return g.res;
  try {
    const b = createSchema.parse(await req.json());
    if (clinicalTermsIn(b.title).length) return bad('Keep clinical details out of tasks (minimum necessary).');
    if (b.leadId) {
      const l = await prisma.marketingLead.findFirst({ where: { id: b.leadId, organizationId: g.gate.organizationId }, select: { id: true } });
      if (!l) return bad('Lead not found.', 404);
    }
    const t = await addLeadTask(g.gate.organizationId, b.leadId ?? null, b, g.gate.actor);
    return ok({ taskId: t.id }, 201);
  } catch (err) {
    return serverError('tasks POST', err);
  }
}

export async function PATCH(req: Request) {
  const g = await marketingGate('leads');
  if (!g.ok) return g.res;
  try {
    const b = z.object({ id: z.string().min(1).max(64), done: z.boolean() }).parse(await req.json());
    return fromResult(await completeTask(g.gate.organizationId, b.id, b.done, g.gate.actor), () => ok());
  } catch (err) {
    return serverError('tasks PATCH', err);
  }
}
