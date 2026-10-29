import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { getCaseloadCounts } from '@/lib/clients/caseload';
import { canAccessClientRoster } from '@/lib/clients/orgScope';

export const runtime = 'nodejs';

/** GET /api/clients/caseload-counts?locationId= — counts only (all / mine / unassigned). */
export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (gate.ok === false) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessClientRoster(gate.role)) {
    return NextResponse.json(
      { success: false, error: 'Not allowed to view clients' },
      { status: 403 }
    );
  }

  try {
    const locationId = new URL(req.url).searchParams.get('locationId');
    const counts = await getCaseloadCounts(
      { id: gate.userId, role: gate.role, organizationId: gate.organizationId },
      { locationId }
    );
    return NextResponse.json({ success: true, counts });
  } catch (err) {
    console.error('[clients caseload-counts]', err);
    return NextResponse.json(
      { success: false, error: 'Failed to load caseload counts' },
      { status: 500 }
    );
  }
}
