import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessClaims } from '@/lib/billing/claims';

export const dynamic = 'force-dynamic';

/**
 * Retired. This pulled caller-chosen remote paths from the shared Waystar mailbox and recorded
 * them with no organization. Retrieval runs through POST /api/waystar/inbound (same work as the
 * cron job), which files each 835 / 999 / 277CA to the organization that owns the claims.
 */
export async function POST() {
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
      error: 'This endpoint is retired. Run a retrieval from Billing > Clearinghouse (POST /api/waystar/inbound).',
      replacement: '/api/waystar/inbound',
    },
    { status: 410 }
  );
}
