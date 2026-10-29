import { NextResponse } from 'next/server';
import { z } from 'zod';
import { listRequirements, loadSuggestedRequirements, saveRequirement } from '@/lib/hr/training';
import { auditHr, hrGate, hrJsonError, hrServerError } from '@/lib/hr/server';

export const runtime = 'nodejs';

export async function GET() {
  const g = await hrGate('staff');
  if (g.ok === false) return g.response;
  try {
    return NextResponse.json({ success: true, requirements: await listRequirements(g.ctx.organizationId) });
  } catch (err) {
    return hrServerError('requirements', err);
  }
}

const putSchema = z.object({
  id: z.string().max(128).optional().nullable(),
  key: z.string().trim().max(60).optional(),
  name: z.string().trim().min(1).max(160),
  category: z.enum(['compliance', 'clinical', 'safety', 'other']),
  frequencyMonths: z.number().int().min(1).max(120).nullable(),
  roles: z.array(z.string().max(40)).max(20),
  dueWithinDaysOfHire: z.number().int().min(0).max(365).nullable(),
  active: z.boolean(),
  policyNote: z.string().trim().max(300).optional().nullable(),
});

/** PUT: create / edit a required training (frequency and roles are practice policy). */
export async function PUT(req: Request) {
  const g = await hrGate('credentialing');
  if (g.ok === false) return g.response;
  let body: z.infer<typeof putSchema>;
  try {
    body = putSchema.parse(await req.json());
  } catch {
    return hrJsonError('Check the requirement', 400);
  }
  try {
    const result = await saveRequirement(g.ctx, body as Parameters<typeof saveRequirement>[1]);
    if (!result.ok) return hrJsonError(result.error, result.status);
    await auditHr(g.ctx, req, body.id ? 'UPDATE' : 'CREATE', 'hrTrainingRequirement', result.id, { frequencyMonths: body.frequencyMonths, roles: body.roles.length });
    return NextResponse.json({ success: true, id: result.id });
  } catch (err) {
    return hrServerError('requirement save', err);
  }
}

/** POST { action: 'load_suggested' }: add the suggested requirement list (keys not already present). */
export async function POST(req: Request) {
  const g = await hrGate('credentialing');
  if (g.ok === false) return g.response;
  try {
    const body = (await req.json().catch(() => ({}))) as { action?: string };
    if (body.action !== 'load_suggested') return hrJsonError('Unknown action', 400);
    const added = await loadSuggestedRequirements(g.ctx);
    await auditHr(g.ctx, req, 'CREATE', 'hrTrainingRequirement', null, { suggestedAdded: added });
    return NextResponse.json({ success: true, added });
  } catch (err) {
    return hrServerError('requirements suggested', err);
  }
}
