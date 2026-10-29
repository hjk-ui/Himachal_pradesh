import { planCareSchema } from '@/lib/ehr/planCareSchema';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import {
  canAccessTreatmentPlans,
  createTreatmentPlan,
  listTreatmentPlans,
  TREATMENT_PLAN_STATUSES,
} from '@/lib/ehr/treatmentPlans';

export const runtime = 'nodejs';

const goalSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  text: z.string().trim().max(500),
  targetDate: z.string().trim().max(32).optional().default(''),
  objectives: z.array(z.string().trim().max(400)).max(20).optional().default([]),
  interventions: z.array(z.string().trim().max(200)).max(20).optional().default([]),
  progress: z.number().min(0).max(100).optional().default(0),
});

const createSchema = z.object({
  clientId: z.string().min(1).max(128),
  title: z.string().trim().min(1).max(240),
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
});

export async function GET(req: Request) {
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
    const url = new URL(req.url);
    const clientId = url.searchParams.get('clientId') || undefined;
    const plans = await listTreatmentPlans(
      {
        organizationId: gate.organizationId,
        actorUserId: gate.userId,
        actorRole: gate.role,
      },
      clientId
    );
    return NextResponse.json({ success: true, plans });
  } catch (err) {
    console.error('[treatment-plans GET]', err);
    return NextResponse.json(
      { success: false, error: 'Could not load treatment plans' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
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
    const body = createSchema.parse(await req.json());
    const result = await createTreatmentPlan(
      {
        organizationId: gate.organizationId,
        actorUserId: gate.userId,
        actorRole: gate.role,
      },
      {
        ...body,
        goals: body.goals?.map((g, i) => ({
          id: g.id || `G${i + 1}`,
          text: g.text,
          targetDate: g.targetDate,
          objectives: g.objectives.filter(Boolean),
          interventions: g.interventions.filter(Boolean),
          progress: g.progress,
        })),
      }
    );
    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }
    return NextResponse.json({ success: true, plan: result.plan }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof z.ZodError ? 'Invalid treatment plan' : (err as Error).message;
    return NextResponse.json(
      { success: false, error: message || 'Could not create treatment plan' },
      { status: 400 }
    );
  }
}
