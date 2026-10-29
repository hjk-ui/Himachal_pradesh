import type { Role } from '@prisma/client';
import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import {
  buildArExportCsv,
  canAccessArControl,
  getArControlSnapshot,
} from '@/lib/billing/arControl';
import { auditPhiAccess } from '@/lib/audit/requestMeta';

export const runtime = 'nodejs';

function actorFrom(gate: { organizationId: string; userId: string; role: Role }) {
  return { organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role };
}

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessArControl(gate.role) || !canAccessPath(gate.role, '/dashboard/billing/ar-control')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  try {
    const snapshot = await getArControlSnapshot(actorFrom(gate));
    const csv = buildArExportCsv(snapshot);
    await auditPhiAccess({ gate, req, action: 'EXPORT', resourceType: 'arWorklist', metadata: { format: 'csv' } });
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="ar-worklist-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (err) {
    console.error('[billing ar export]', err);
    return NextResponse.json({ success: false, error: 'Could not export A/R worklist' }, { status: 500 });
  }
}
