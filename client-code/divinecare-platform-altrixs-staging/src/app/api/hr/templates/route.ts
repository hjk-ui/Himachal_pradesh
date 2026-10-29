import { NextResponse } from 'next/server';
import { z } from 'zod';
import { listTemplates, saveTemplate } from '@/lib/hr/checklists';
import { auditHr, hrGate, hrJsonError, hrServerError } from '@/lib/hr/server';

export const runtime = 'nodejs';

/** GET /api/hr/templates: onboarding / offboarding templates (built-in + practice-defined). */
export async function GET() {
  const g = await hrGate('admin');
  if (g.ok === false) return g.response;
  try {
    return NextResponse.json({ success: true, templates: await listTemplates(g.ctx.organizationId) });
  } catch (err) {
    return hrServerError('templates', err);
  }
}

const itemSchema = z.object({
  key: z.string().trim().max(60).default(''),
  label: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(60),
  ownerType: z.enum(['hr', 'manager', 'employee', 'admin', 'clinical_director', 'it']),
  dueOffsetDays: z.number().int().min(-120).max(365).optional(),
  dueBusinessDays: z.number().int().min(0).max(60).optional(),
  requiresAck: z.boolean().optional(),
  requiresUpload: z.boolean().optional(),
  systemAction: z.string().trim().max(40).optional(),
  policyKind: z.string().trim().max(40).optional(),
  clinicalOnly: z.boolean().optional(),
  licensedOnly: z.boolean().optional(),
  prescriberOnly: z.boolean().optional(),
  workerTypes: z.array(z.string().max(12)).max(3).optional(),
  roles: z.array(z.string().max(40)).max(20).optional(),
  help: z.string().trim().max(300).optional(),
});

const putSchema = z.object({
  id: z.string().max(128).optional().nullable(),
  kind: z.enum(['onboarding', 'offboarding']),
  name: z.string().trim().min(1).max(120),
  roles: z.array(z.string().max(40)).max(20).default([]),
  items: z.array(itemSchema).min(1).max(80),
  active: z.boolean().optional(),
});

/** PUT /api/hr/templates: create or update a practice template (copy of the built-in to edit). */
export async function PUT(req: Request) {
  const g = await hrGate('admin');
  if (g.ok === false) return g.response;
  let body: z.infer<typeof putSchema>;
  try {
    body = putSchema.parse(await req.json());
  } catch {
    return hrJsonError('Check the template items', 400);
  }
  try {
    const result = await saveTemplate(g.ctx, body);
    if (!result.ok) return hrJsonError(result.error, result.status);
    await auditHr(g.ctx, req, body.id ? 'UPDATE' : 'CREATE', 'hrChecklistTemplate', result.id, { kind: body.kind, items: body.items.length });
    return NextResponse.json({ success: true, id: result.id });
  } catch (err) {
    return hrServerError('template save', err);
  }
}
