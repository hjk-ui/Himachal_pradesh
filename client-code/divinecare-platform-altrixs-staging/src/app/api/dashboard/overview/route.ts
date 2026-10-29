import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { getDashboardOverview } from '@/lib/dashboard/getOverview';

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const data = await getDashboardOverview(gate.organizationId);
    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error('[dashboard/overview]', err);
    return NextResponse.json(
      { success: false, error: 'Failed to load dashboard' },
      { status: 500 }
    );
  }
}
