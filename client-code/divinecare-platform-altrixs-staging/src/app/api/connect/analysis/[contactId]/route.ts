import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { getCallAnalysis } from '@/lib/connect/service';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { auditPhiAccess } from '@/lib/audit/requestMeta';

type Params = { params: Promise<{ contactId: string }> };

export async function GET(request: Request, { params }: Params) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessPath(gate.role, '/dashboard/communications')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const { contactId } = await params;
  // Org + the caller's client scope (caseload / care team for caseload roles)
  const call = await getCallAnalysis(
    gate.organizationId,
    contactId,
    clientAccessWhere({ organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role }),
  );
  if (!call) return NextResponse.json({ success: false, error: 'Contact not found' }, { status: 404 });
  await auditPhiAccess({ gate, req: request, action: 'READ', resourceType: 'connectCallAnalysis', resourceId: call.id, patientId: call.clientId });

  return NextResponse.json({
    success: true,
    contactId,
    analysis: call.analysis ?? call.analysisJson ?? null,
    call,
    demoMode: call.demoMode || Boolean((call.analysis as { demoMode?: boolean } | null)?.demoMode),
  });
}
