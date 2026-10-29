import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import {
  createRiskAlert,
  listRiskAlerts,
  summarizeRiskAlerts,
} from '@/lib/alerts/manage';

export const runtime = 'nodejs';

const createSchema = z.object({
  clientId: z.string().min(1),
  type: z.enum(['crisis_keywords', 'low_mood', 'high_stress']),
  severity: z.enum(['high', 'medium', 'low']),
  description: z.string().trim().min(3).max(2000),
  mood: z.number().int().min(0).max(10).optional().nullable(),
  stress: z.number().int().min(0).max(10).optional().nullable(),
  source: z.enum(['check_in', 'journal', 'assessment']).optional(),
  sourceId: z.string().optional().nullable(),
  clinicianId: z.string().optional().nullable(),
  clientName: z.string().optional().nullable(),
});

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  if (!canAccessPath(gate.role, '/dashboard/alerts')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const unreviewedParam = searchParams.get('unreviewed');
    let unreviewed: boolean | null = null;
    if (unreviewedParam === 'true' || unreviewedParam === '1') unreviewed = true;
    if (unreviewedParam === 'false' || unreviewedParam === '0') unreviewed = false;

    const ctx = {
      organizationId: gate.organizationId,
      actorUserId: gate.userId,
      actorRole: gate.role,
    };

    const [alerts, summary] = await Promise.all([
      listRiskAlerts({ ...ctx, unreviewed }),
      summarizeRiskAlerts(ctx),
    ]);

    return NextResponse.json({ success: true, alerts, summary });
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    console.error('[risk-alerts GET]', err);
    if (code === 'P1001') {
      return NextResponse.json(
        { success: false, error: 'Database connection is temporarily unavailable. Please try again.' },
        { status: 503 }
      );
    }
    return NextResponse.json({ success: false, error: 'Failed to load risk alerts' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/alerts')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = createSchema.parse(await req.json());
    const result = await createRiskAlert({
      organizationId: gate.organizationId,
      ...body,
    });
    if (result.ok === false) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json({ success: true, alert: result.alert }, { status: 201 });
  } catch (err: unknown) {
    const message =
      err instanceof z.ZodError
        ? 'Invalid risk alert payload'
        : err instanceof Error
          ? err.message
          : 'Could not create risk alert';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
