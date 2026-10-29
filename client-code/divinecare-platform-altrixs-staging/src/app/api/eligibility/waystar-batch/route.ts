import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { canAccessEligibility } from '@/lib/eligibility/manage';
import { requestWaystarEligibility, waystarEligibilityAvailable } from '@/lib/eligibility/waystar';
import { ELIGIBILITY_SERVICE_TYPES } from '@/lib/billing/waystarInbound/codes';
import { auditPhiAccess } from '@/lib/audit/requestMeta';

export const runtime = 'nodejs';

const bodySchema = z.object({
  requests: z
    .array(
      z.object({
        clientId: z.string().min(1).max(128),
        payerName: z.string().trim().max(120).optional().nullable(),
        memberId: z.string().trim().max(80).optional().nullable(),
        dos: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
        payerId: z.string().trim().regex(/^[A-Za-z0-9-]{2,15}$/).optional().nullable(),
        serviceTypes: z.array(z.enum(ELIGIBILITY_SERVICE_TYPES)).max(6).optional(),
      })
    )
    .min(1)
    .max(99),
});

/** Several eligibility checks in ONE Waystar 270 (e.g. tomorrow's schedule). Answers arrive as 271s. */
export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessEligibility(gate.role) || !canAccessPath(gate.role, '/dashboard/ehr/eligibility')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  if (!waystarEligibilityAvailable()) {
    return NextResponse.json({ success: false, error: 'Waystar SFTP eligibility is not active on this server' }, { status: 503 });
  }
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid eligibility batch' }, { status: 400 });
  }
  try {
    const result = await requestWaystarEligibility({ organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role }, body.requests);
    await auditPhiAccess({
      gate, req, action: 'SUBMIT', resourceType: 'eligibilityCheck', resourceId: result.batch?.batchId ?? null,
      outcome: result.sent ? 'SUCCESS' : 'FAILURE',
      metadata: { clearinghouse: 'Waystar', mode: 'batch', count: body.requests.length, sent: result.sent, failed: result.failed.length, checkIds: result.checkIds.slice(0, 50) },
    });
    return NextResponse.json({ success: true, ...result }, { status: 201 });
  } catch (err) {
    console.error('[eligibility waystar-batch]', err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: 'Could not send the eligibility batch' }, { status: 500 });
  }
}
