import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { buildStaffCsv, canAccessHrCorner, getHrCorner } from '@/lib/hr/corner';
import { auditPhiAccess } from '@/lib/audit/requestMeta';

export const runtime = 'nodejs';

export async function GET(req: Request) {
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
  await auditPhiAccess({ gate, req, action: 'EXPORT', resourceType: 'staffReport', metadata: { format: 'csv', count: data.employees.length } });
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="hr-staff-report.csv"',
    },
  });
}
