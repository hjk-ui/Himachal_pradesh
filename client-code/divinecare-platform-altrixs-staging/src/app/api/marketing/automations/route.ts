import { z } from 'zod';
import { fromResult, marketingGate, ok, serverError } from '@/lib/marketing/http';
import { listWorkflows, saveWorkflow, setWorkflowActive } from '@/lib/marketing/hubService';
import { installRecipe, processDueRuns } from '@/lib/marketing/automationService';
import { STEP_TYPES, TRIGGER_TYPES } from '@/lib/marketing/automation';
import { LEAD_SOURCES, LEAD_STAGES } from '@/lib/marketing/constants';

export const runtime = 'nodejs';

export async function GET() {
  const g = await marketingGate('hub');
  if (!g.ok) return g.res;
  try {
    return ok({ ...(await listWorkflows(g.gate.organizationId)), triggerTypes: TRIGGER_TYPES, stepTypes: STEP_TYPES, stages: LEAD_STAGES, sources: LEAD_SOURCES });
  } catch (err) {
    return serverError('automations GET', err);
  }
}

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('save'), id: z.string().max(64).optional(), name: z.string().trim().min(2).max(120), trigger: z.unknown(), steps: z.unknown(), active: z.boolean().optional() }),
  z.object({ action: z.literal('install'), recipeKey: z.string().max(60) }),
  z.object({ action: z.literal('toggle'), id: z.string().max(64), active: z.boolean() }),
  z.object({ action: z.literal('delete'), id: z.string().max(64) }),
  z.object({ action: z.literal('run_due') }),
]);

export async function POST(req: Request) {
  const g = await marketingGate('hub');
  if (!g.ok) return g.res;
  try {
    const b = schema.parse(await req.json());
    const org = g.gate.organizationId;
    if (b.action === 'save') return fromResult(await saveWorkflow(org, b, g.gate.actor), () => ok());
    if (b.action === 'install') return fromResult(await installRecipe(org, b.recipeKey, g.gate.userId), () => ok());
    if (b.action === 'toggle') return fromResult(await setWorkflowActive(org, b.id, b.active), () => ok());
    if (b.action === 'delete') return fromResult(await setWorkflowActive(org, b.id, null), () => ok());
    return ok({ result: await processDueRuns({ organizationId: org }) });
  } catch (err) {
    return serverError('automations POST', err);
  }
}
