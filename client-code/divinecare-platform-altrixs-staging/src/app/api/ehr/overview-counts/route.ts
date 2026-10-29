import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { canSeeBhDiagnoses } from '@/lib/clients/chartSectionAccess';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { summarizeDiagnoses } from '@/lib/clients/diagnosisOverviewCore';

export const runtime = 'nodejs';

/**
 * GET /api/ehr/overview-counts — EHR hub tiles counted on the server from the Prisma tables
 * (clinical assessment records, refill requests, eligibility checks, chart diagnoses), scoped to
 * the clients the caller may see. Counts only; no PHI in the response. null = not visible to the role.
 */
export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessPath(gate.role, '/dashboard/ehr')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  try {
    const clientWhere = clientAccessWhere({ organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role });
    const seeDx = canSeeBhDiagnoses(gate.role);
    const [assessments, pendingRefills, pendingEligibility, dxRows] = await Promise.all([
      prisma.clinicalAssessmentRecord.count({ where: { organizationId: gate.organizationId, client: clientWhere } }),
      prisma.ehrRefillRequest.count({ where: { status: 'Pending', client: clientWhere } }),
      prisma.eligibilityCheck.count({ where: { organizationId: gate.organizationId, status: 'PENDING', client: clientWhere } }),
      seeDx
        ? prisma.client.findMany({
            where: { AND: [clientWhere, { status: 'ACTIVE' }] },
            select: { id: true, primaryDiagnosisCode: true, primaryDiagnosis: true, secondaryDiagnoses: true },
          })
        : Promise.resolve(null),
    ]);
    const data = {
      assessments,
      pendingRefills,
      pendingEligibility,
      uniqueDx: dxRows ? summarizeDiagnoses(dxRows).uniqueCodes : null,
    };
    await auditPhiAccess({ gate, req, action: 'READ', resourceType: 'ehrOverviewCounts', metadata: { countsOnly: true } });
    return NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    console.error('[ehr/overview-counts]', err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: 'Could not load EHR counts' }, { status: 500 });
  }
}
