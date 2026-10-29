import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { listPhiAudit } from '@/lib/audit/phiAudit';

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/admin/audit')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  try {
    const rows = await listPhiAudit(gate.organizationId);
    return NextResponse.json({ success: true, rows });
  } catch (err) {
    console.error('[admin audit GET]', err);
    return NextResponse.json({ success: false, error: 'Could not load the audit log' }, { status: 500 });
  }
}
