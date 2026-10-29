import { NextResponse } from 'next/server';
import { requireFullAdmin } from '@/lib/auth/requireAdmin';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { loadUnusualAccess } from '@/lib/audit/monitoring';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/audit-log/unusual — read-only unusual-access review (rule-based, see
 * src/lib/audit/unusualAccessRules.ts). Leadership only (requireFullAdmin).
 */
export async function GET(req: Request) {
  const gate = await requireFullAdmin();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  try {
    const report = await loadUnusualAccess({
      organizationId: gate.organizationId,
      userId: gate.userId,
      role: gate.role,
    });
    await auditPhiAccess({
      gate,
      req,
      action: 'READ',
      resourceType: 'auditLogMonitoring',
      metadata: {
        highVolume: report.highVolume.length,
        afterHours: report.afterHours.length,
        protectedAccess: report.protectedAccess.length,
        breakGlass: report.breakGlass.length,
        denied: report.denied.length,
      },
    });
    return NextResponse.json({ success: true, ...report });
  } catch (err) {
    console.error('[admin audit-log unusual GET]', err instanceof Error ? err.name : 'error');
    return NextResponse.json({ success: false, error: 'Could not load unusual-access review' }, { status: 500 });
  }
}
