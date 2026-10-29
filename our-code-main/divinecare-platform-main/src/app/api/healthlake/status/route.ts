import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { getHealthLakeStatus } from '@/lib/aws/healthlake';

export const runtime = 'nodejs';

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/ehr/healthlake')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const status = await getHealthLakeStatus(gate.organizationId);
    return NextResponse.json({ success: true, ...status });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'HealthLake status failed';
    return NextResponse.json({ success: false, error: message, demoMode: false }, { status: 502 });
  }
}
