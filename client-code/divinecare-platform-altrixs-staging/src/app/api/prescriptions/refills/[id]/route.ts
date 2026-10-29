import { NextRequest, NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { canWritePrescriptions } from '@/lib/prescriptions/access';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const { id } = await params;

    if (!canWritePrescriptions(gate.role)) {
      await auditPhiAccess({
        gate, req, action: 'UPDATE', resourceType: 'refillRequest', resourceId: id,
        outcome: 'DENIED', metadata: { reason: 'role_not_permitted' },
      });
      return NextResponse.json(
        { success: false, error: 'Only prescribers can decide refill requests.' },
        { status: 403 }
      );
    }

    // Pharmacy renewal requests arrive through DrFirst and are answered in Rcopia (Surescripts
    // RxRenewalResponse). A decision recorded here never reached the pharmacy, so it is refused.
    return NextResponse.json(
      {
        success: false,
        code: 'RESPOND_IN_DRFIRST',
        error: 'Renewal requests are answered in DrFirst so the pharmacy receives the response. Open DrFirst messages.',
      },
      { status: 410 }
    );

  } catch (err: unknown) {
    console.error('[API /api/prescriptions/refills/[id] POST] error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to process refill request' },
      { status: 500 }
    );
  }
}
