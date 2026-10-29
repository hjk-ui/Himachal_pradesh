import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { recordClinicalEvent } from '@/lib/clinical/events';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';

const schema = z.object({
  clientId: z.string().min(1),
  clientName: z.string().min(1),
  riskLevel: z.enum(['low', 'moderate', 'high', 'critical', 'imminent']),
  keywords: z.array(z.string()).optional(),
});

export async function POST(request: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (
    !canAccessPath(gate.role, '/dashboard/ehr/assessments/cssrs') &&
    !canAccessPath(gate.role, '/dashboard/ehr/assessments')
  ) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = schema.parse(await request.json());
    const riskLevel = body.riskLevel === 'imminent' ? 'critical' : body.riskLevel;
    const { event, demoMode } = await recordClinicalEvent({
      organizationId: gate.organizationId,
      eventType: 'crisis-flag',
      clientId: body.clientId,
      clientName: body.clientName,
      createdById: gate.userId,
      payload: {
        riskLevel,
        sourceRiskLevel: body.riskLevel,
        keywords: body.keywords ?? [],
      },
    });

    await writeAuditLog({
      action: 'clinical.crisis_flag',
      actorUserId: gate.userId,
      organizationId: gate.organizationId,
      resourceType: 'ClinicalEvent',
      resourceId: event.id,
      metadata: { clientId: body.clientId, riskLevel: body.riskLevel, demoMode },
    });

    return NextResponse.json({ success: true, event, demoMode }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: 'Invalid crisis-flag payload' }, { status: 400 });
    }
    console.error('[events/crisis-flag]', err);
    return NextResponse.json({ success: false, error: 'Could not record crisis flag' }, { status: 500 });
  }
}
