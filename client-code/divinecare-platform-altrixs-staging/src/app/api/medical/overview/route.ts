import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { loadPrimaryCareOverview, MEDICAL_OVERVIEW_PATH } from '@/lib/medical/primaryCareOverview';
import { prismaOverviewSource } from '@/lib/medical/primaryCareOverviewDb';
import { isCaseloadScoped } from '@/lib/auth/medicalDirector';

export const runtime = 'nodejs';

/**
 * GET /api/medical/overview — the Primary care overview (/dashboard/medical): today's
 * primary-care appointments (practice clock), work queue counts and the panel summary, scoped
 * like the Primary care patients roster (org + care team / caseload). Same role rule as the page.
 */
export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, MEDICAL_OVERVIEW_PATH)) {
    await auditPhiAccess({ gate, req, action: 'LIST', resourceType: 'medicalOverview', outcome: 'DENIED', metadata: { reason: 'role_not_permitted' } });
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const viewer = { organizationId: gate.organizationId, userId: gate.userId, role: gate.role, isCaseload: isCaseloadScoped({ role: gate.role, userId: gate.userId, organizationId: gate.organizationId }) };
    const access = clientAccessWhere({ organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role });
    const timeZone = await getPracticeTimeZone(gate.organizationId);
    const overview = await loadPrimaryCareOverview(prismaOverviewSource(viewer), viewer, access, { timeZone });

    await auditPhiAccess({
      gate,
      req,
      action: 'LIST',
      resourceType: 'medicalOverview',
      metadata: {
        scope: overview.scope,
        date: overview.date,
        todayCount: overview.today.total,
        maskedCount: overview.today.rows.filter((r) => r.locked).length,
        queues: Object.fromEntries(overview.queues.map((q) => [q.key, q.count])),
        panelActive: overview.panel.active,
        // Patients named in Today (protected rows are listed without a client id)
        clientIds: overview.today.rows.map((r) => r.clientId).filter(Boolean).slice(0, 50),
      },
    });

    return NextResponse.json({ success: true, ...overview });
  } catch (err: unknown) {
    console.error('[medical/overview] GET failed', err instanceof Error ? err.name : 'error');
    return NextResponse.json({ success: false, error: 'Could not load the primary care overview' }, { status: 500 });
  }
}
