import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import {
  createRiskAlert,
  listRiskAlerts,
  summarizeRiskAlerts,
} from '@/lib/alerts/manage';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { maskAlertsForViewer } from '@/lib/alerts/lockedMask';

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

  if (!canAccessPath(gate.role, '/dashboard/alerts', gate.capabilities)) {
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

    const [rawAlerts, summary] = await Promise.all([
      listRiskAlerts({ ...ctx, unreviewed }),
      summarizeRiskAlerts(ctx),
    ]);
    // Part 2 / VIP clients the viewer may not open: severity / type kept, description blanked, alias name
    const alerts = await maskAlertsForViewer(gate, rawAlerts);

    await auditPhiAccess({
      gate,
      req,
      action: 'LIST',
      resourceType: 'riskAlert',
      metadata: {
        count: alerts.length,
        masked: alerts.filter((a) => a.protected).length,
        filters: { unreviewed },
        alertIds: alerts.slice(0, 50).map((a) => a.id),
        clientIds: [...new Set(alerts.map((a) => a.clientId))].slice(0, 50),
      },
    });

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
  if (!canAccessPath(gate.role, '/dashboard/alerts', gate.capabilities)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = createSchema.parse(await req.json());
    const result = await createRiskAlert({
      organizationId: gate.organizationId,
      ...body,
    });
    if (result.ok === false) {
      if (result.status === 403 || result.status === 404) {
        await auditPhiAccess({ gate, req, action: 'CREATE', resourceType: 'riskAlert', resourceId: body.clientId, patientId: body.clientId, outcome: 'DENIED', metadata: { status: result.status } });
      }
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }
    await auditPhiAccess({
      gate,
      req,
      action: 'CREATE',
      resourceType: 'riskAlert',
      resourceId: result.alert.id,
      patientId: result.alert.clientId,
      metadata: { type: body.type, severity: body.severity, source: body.source ?? null },
    });
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
