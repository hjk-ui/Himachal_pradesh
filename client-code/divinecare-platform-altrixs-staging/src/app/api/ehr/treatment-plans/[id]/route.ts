import { planCareSchema } from '@/lib/ehr/planCareSchema';
import type { Role } from '@prisma/client';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import {
  canAccessTreatmentPlans,
  getTreatmentPlan,
  TREATMENT_PLAN_STATUSES,
  updateTreatmentPlan,
} from '@/lib/ehr/treatmentPlans';

export const runtime = 'nodejs';

const paramsSchema = z.object({ id: z.string().min(1).max(128) });

const goalSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  text: z.string().trim().max(500),
  targetDate: z.string().trim().max(32).optional().default(''),
  objectives: z.array(z.string().trim().max(400)).max(20).optional().default([]),
  interventions: z.array(z.string().trim().max(200)).max(20).optional().default([]),
  progress: z.number().min(0).max(100).optional().default(0),
});

const patchSchema = z.object({
  title: z.string().trim().min(1).max(240).optional(),
  diagnosisCodes: z.array(z.string().trim().max(32)).max(12).optional(),
  status: z.enum(TREATMENT_PLAN_STATUSES).optional(),
  reviewDueAt: z.string().trim().max(40).optional().nullable(),
  clinicianId: z.string().min(1).max(128).optional().nullable(),
  strengths: z.string().trim().max(4000).optional().nullable(),
  presentingProblems: z.string().trim().max(4000).optional().nullable(),
  secondaryDx: z.string().trim().max(240).optional().nullable(),
  clientSigned: z.boolean().optional(),
  clinicalDetails: planCareSchema.optional(),
  goals: z.array(goalSchema).max(20).optional(),
  action: z.enum(['close']).optional(),
});

function actorFrom(gate: { organizationId: string; userId: string; role: Role }) {
  return {
    organizationId: gate.organizationId,
    actorUserId: gate.userId,
    actorRole: gate.role!,
  };
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (
    !canAccessTreatmentPlans(gate.role) ||
    !canAccessPath(gate.role, '/dashboard/ehr/treatment-plans')
  ) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { id } = paramsSchema.parse(await ctx.params);
    const result = await getTreatmentPlan(actorFrom(gate), id);
    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }
    return NextResponse.json({ success: true, plan: result.plan });
  } catch (err: unknown) {
    const message = err instanceof z.ZodError ? 'Invalid id' : (err as Error).message;
    return NextResponse.json({ success: false, error: message || 'Could not load plan' }, { status: 400 });
  }
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (
    !canAccessTreatmentPlans(gate.role) ||
    !canAccessPath(gate.role, '/dashboard/ehr/treatment-plans')
  ) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { id } = paramsSchema.parse(await ctx.params);
    const body = patchSchema.parse(await req.json());
    const actor = actorFrom(gate);

    const wantsClose = body.action === 'close' || body.status === 'CLOSED';
    const result = await updateTreatmentPlan(actor, id, {
      ...body,
      status: wantsClose ? 'CLOSED' : body.status,
      goals: body.goals?.map((g, i) => ({
        id: g.id || `G${i + 1}`,
        text: g.text,
        targetDate: g.targetDate,
        objectives: g.objectives.filter(Boolean),
        interventions: g.interventions.filter(Boolean),
        progress: g.progress,
      })),
    });
    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }
    return NextResponse.json({ success: true, plan: result.plan });
  } catch (err: unknown) {
    const message =
      err instanceof z.ZodError ? 'Invalid treatment plan update' : (err as Error).message;
    return NextResponse.json(
      { success: false, error: message || 'Could not update treatment plan' },
      { status: 400 }
    );
  }
}
