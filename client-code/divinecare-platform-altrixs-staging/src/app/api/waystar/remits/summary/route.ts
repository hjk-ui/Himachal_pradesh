import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessClaims } from '@/lib/billing/claims';

export const dynamic = 'force-dynamic';

/**
 * Retired. ?key= read ANY object in the Waystar staging bucket (every organization's 835s, and
 * any other key) with no organization scope. Remittances are listed per organization by
 * GET /api/waystar/inbound (Billing > Clearinghouse) and reviewed via /api/waystar/remits/review.
 */
export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessClaims(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  return NextResponse.json(
    {
      success: false,
      error: 'This endpoint is retired. Remittances are listed per organization on Billing > Clearinghouse (GET /api/waystar/inbound).',
      replacement: '/api/waystar/inbound',
    },
    { status: 410 }
  );
}
