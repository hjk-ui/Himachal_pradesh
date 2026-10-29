import type { Role } from '@prisma/client';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { canAccessClaimScrubber, submitScrubbedClaim } from '@/lib/billing/claimScrubber';
import { canMutateClaims } from '@/lib/billing/claims';
import { auditPhiAccess } from '@/lib/audit/requestMeta';

export const runtime = 'nodejs';

function actorFrom(gate: { organizationId: string; userId: string; role: Role }) {
  return { organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role };
}

const bodySchema = z.object({
  claimId: z.string().min(1).max(128),
});

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (
    !canAccessClaimScrubber(gate.role) ||
    !canAccessPath(gate.role, '/dashboard/billing/claim-scrubber')
  ) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  // Submitting to the clearinghouse is billing core work; Office Manager reads the scrubber only
  if (!canMutateClaims(gate.role)) {
    await auditPhiAccess({
      gate, req, action: 'SUBMIT', resourceType: 'claim', outcome: 'DENIED',
      metadata: { reason: 'cannot_mutate_claims', view: 'claim_scrubber' },
    });
    return NextResponse.json({ success: false, error: 'Only billing staff can submit claims' }, { status: 403 });
  }
  try {
    const body = bodySchema.parse(await req.json());
    const result = await submitScrubbedClaim(actorFrom(gate), body.claimId);
    if (!result.ok) {
      return NextResponse.json(
        {
          success: false,
          error: result.error,
          demoMode: 'demoMode' in result ? result.demoMode : undefined,
          scrubStatus: 'scrubStatus' in result ? result.scrubStatus : undefined,
        },
        { status: result.status }
      );
    }
    return NextResponse.json({
      success: true,
      demoMode: false,
      trackingId: result.trackingId,
      claimCh: result.claimCh,
      message: 'Claim submitted to clearinghouse.',
    });
  } catch (err: unknown) {
    const message = err instanceof z.ZodError ? 'Invalid submit request' : (err as Error).message;
    return NextResponse.json({ success: false, error: message || 'Submit failed' }, { status: 400 });
  }
}
