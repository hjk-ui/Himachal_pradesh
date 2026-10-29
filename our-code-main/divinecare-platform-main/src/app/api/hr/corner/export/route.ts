import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { buildStaffCsv, canAccessHrCorner, getHrCorner } from '@/lib/hr/corner';

export const runtime = 'nodejs';

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessHrCorner(gate.role) || !canAccessPath(gate.role, '/dashboard/hr')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const data = await getHrCorner(gate.organizationId);
  if ('schemaReady' in data && data.schemaReady === false) {
    return NextResponse.json({ success: false, error: data.error }, { status: 503 });
  }
  const csv = buildStaffCsv(data.employees);
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="hr-staff-report.csv"',
    },
  });
}
