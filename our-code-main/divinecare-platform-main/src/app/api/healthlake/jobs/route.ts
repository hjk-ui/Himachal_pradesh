import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { listHealthLakeJobs } from '@/lib/aws/healthlake';

export const runtime = 'nodejs';

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/ehr/healthlake')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const jobs = await listHealthLakeJobs(gate.organizationId);
  return NextResponse.json({ success: true, jobs });
}
