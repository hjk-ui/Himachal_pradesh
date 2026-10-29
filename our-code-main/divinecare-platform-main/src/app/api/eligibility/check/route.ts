import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { canAccessEligibility, runEligibilityCheck } from '@/lib/eligibility/manage';

export const runtime = 'nodejs';

const bodySchema = z.object({
  clientId: z.string().min(1).max(128),
  payerName: z.string().trim().max(120).optional().nullable(),
  memberId: z.string().trim().max(80).optional().nullable(),
  dos: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
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
    });
    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }
    return NextResponse.json(
      { success: true, check: result.check, mode: result.mode },
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
