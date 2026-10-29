import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { getBillingOverview } from '@/lib/billing/overview';

export const runtime = 'nodejs';

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  if (
    gate.role !== 'ADMIN' &&
    gate.role !== 'DIRECTOR' &&
    gate.role !== 'PRACTICE_DIRECTOR' &&
    gate.role !== 'BILLING'
  ) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const overview = await getBillingOverview(gate.organizationId);
    return NextResponse.json({ success: true, overview });
  } catch (err) {
    console.error('[billing overview]', err);
    return NextResponse.json(
      { success: false, error: 'Failed to load billing overview' },
      { status: 500 }
    );
  }
}
