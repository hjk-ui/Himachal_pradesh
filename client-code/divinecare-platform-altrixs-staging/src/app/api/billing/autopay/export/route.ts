import type { Role } from '@prisma/client';
import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { canReadLedger, listAutopay } from '@/lib/billing/ledger';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { autopayDetails } from '../autopayDetails';
import { buildAutopayCsv } from '@/components/billing/autopay/autopayLogic';

export const runtime = 'nodejs';

/** CSV of AutoPay enrollments (enrolled clients only). Card columns are brand, last 4 and expiry only. */
export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canReadLedger(gate.role) || !canAccessPath(gate.role, '/dashboard/billing/autopay')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  try {
    const actor = { organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role as Role };
    const data = await listAutopay(actor);
    const enrolled = data.enrollments.filter((e) => e.enrollmentId);
    const details = await autopayDetails(gate.organizationId, enrolled.map((e) => e.clientId));
    const rows = enrolled.map((e) => ({ ...e, ...(details.get(e.clientId) ?? { mrn: null, card: null, lastCharge: null }) }));
    const timeZone = await getPracticeTimeZone(gate.organizationId);
    const csv = buildAutopayCsv(rows, timeZone);
    await auditPhiAccess({
      gate, req, action: 'EXPORT', resourceType: 'autopayEnrollment',
      metadata: { format: 'csv', count: rows.length },
    });
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="autopay-enrollments-${new Date().toISOString().slice(0, 10)}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[billing autopay export]', err);
    return NextResponse.json({ success: false, error: 'Could not export AutoPay enrollments' }, { status: 500 });
  }
}
