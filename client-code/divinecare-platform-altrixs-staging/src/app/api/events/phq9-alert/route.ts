import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { recordClinicalEvent } from '@/lib/clinical/events';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';

const schema = z.object({
  clientId: z.string().min(1),
  clientName: z.string().min(1),
  score: z.number(),
  threshold: z.number(),
  clinicianId: z.string().optional(),
});

export async function POST(request: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessPath(gate.role, '/dashboard/ehr/assessments')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = schema.parse(await request.json());
    const { event, demoMode } = await recordClinicalEvent({
      organizationId: gate.organizationId,
      eventType: 'phq9-alert',
      clientId: body.clientId,
      clientName: body.clientName,
      createdById: gate.userId,
      payload: {
        score: body.score,
        threshold: body.threshold,
        clinicianId: body.clinicianId ?? gate.userId,
      },
    });

    await writeAuditLog({
      action: 'clinical.phq9_alert',
      actorUserId: gate.userId,
      organizationId: gate.organizationId,
      resourceType: 'ClinicalEvent',
      resourceId: event.id,
      metadata: { clientId: body.clientId, score: body.score, demoMode },
    });

    return NextResponse.json({ success: true, event, demoMode }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: 'Invalid phq9-alert payload' }, { status: 400 });
    }
    console.error('[events/phq9-alert]', err);
    return NextResponse.json({ success: false, error: 'Could not record PHQ-9 alert' }, { status: 500 });
  }
}
