import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { canAccessEligibility, runEligibilityCheck } from '@/lib/eligibility/manage';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { ELIGIBILITY_SERVICE_TYPES } from '@/lib/billing/waystarInbound/codes';

export const runtime = 'nodejs';

const bodySchema = z.object({
  clientId: z.string().min(1).max(128),
  payerName: z.string().trim().max(120).optional().nullable(),
  memberId: z.string().trim().max(80).optional().nullable(),
  dos: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  /** waystar = batch 270 over SFTP (default when live); availity = real-time when configured */
  channel: z.enum(['waystar', 'availity']).optional().nullable(),
  payerId: z.string().trim().regex(/^[A-Za-z0-9-]{2,15}$/).optional().nullable(),
  serviceTypes: z.array(z.enum(ELIGIBILITY_SERVICE_TYPES)).max(6).optional(),
});

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (
    !canAccessEligibility(gate.role) ||
    !canAccessPath(gate.role, '/dashboard/ehr/eligibility')
  ) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = bodySchema.parse(await req.json());
    const result = await runEligibilityCheck({
      organizationId: gate.organizationId,
      actorUserId: gate.userId,
      actorRole: gate.role,
      clientId: body.clientId,
      payerName: body.payerName,
      memberId: body.memberId,
      dos: body.dos,
      channel: body.channel ?? null,
      payerId: body.payerId ?? null,
      serviceTypes: body.serviceTypes,
    });
    if (!result.ok) {
      if (result.status === 404) {
        await auditPhiAccess({
          gate, req, action: 'SUBMIT', resourceType: 'eligibilityCheck', patientId: body.clientId,
          outcome: 'DENIED', metadata: { reason: 'client_not_found' },
        });
      }
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }
    await auditPhiAccess({
      gate, req, action: 'SUBMIT', resourceType: 'eligibilityCheck', resourceId: result.check.id,
      patientId: result.check.clientId, outcome: result.check.status === 'ERROR' ? 'FAILURE' : 'SUCCESS',
      metadata: {
        payer: result.check.payerName, clearinghouse: result.channel === 'waystar' ? 'Waystar' : 'Availity', mode: result.mode,
        status: result.check.status, count: 1, ...(result.batch ? { batchId: result.batch.batchId } : {}),
      },
    });
    return NextResponse.json(
      { success: true, check: result.check, mode: result.mode, channel: result.channel, batch: result.batch },
      { status: 201 }
    );
  } catch (err: unknown) {
    const message = err instanceof z.ZodError ? 'Invalid eligibility request' : (err as Error).message;
    return NextResponse.json(
      { success: false, error: message || 'Could not run eligibility check' },
      { status: 400 }
    );
  }
}
