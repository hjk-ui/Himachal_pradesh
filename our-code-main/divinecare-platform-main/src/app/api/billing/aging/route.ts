import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { agingReport } from '@/lib/billing/aging';

export const runtime = 'nodejs';

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessPath(gate.role, '/dashboard/billing/collections') && !canAccessPath(gate.role, '/dashboard/billing/ar-control')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const result = await agingReport({ organizationId: gate.organizationId, role: gate.role });
  if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
  return NextResponse.json({ success: true, ...result });
}
