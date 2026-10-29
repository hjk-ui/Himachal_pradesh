import { NextResponse } from 'next/server';
import { invalidateCaseloadScopedCaches } from '@/lib/perf/cache';
import { requireOrgContext } from '@/lib/auth/tenant';
import { removeTeamMember } from '@/services/treatmentTeamService';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { canEditClientProfile, canManageCareTeam, CARE_TEAM_CHANGE_DENIED } from '@/lib/clients/orgScope';
import { findScopedClient, teamRuleMessage } from '@/lib/clients/teamAccess';

export const runtime = 'nodejs';

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string; providerId: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const { id, providerId } = await ctx.params;
    if (!canEditClientProfile(gate.role)) {
      await auditPhiAccess({ gate, req, action: 'DELETE', resourceType: 'treatmentTeamMember', resourceId: providerId, patientId: id, outcome: 'DENIED', metadata: { reason: 'role_not_permitted' } });
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }
    const client = await findScopedClient(gate, id);
    if (!client) {
      await auditPhiAccess({ gate, req, action: 'DELETE', resourceType: 'treatmentTeamMember', resourceId: providerId, patientId: id, outcome: 'DENIED', metadata: { reason: 'client_not_found' } });
      return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });
    }
    // Only the primary clinician or leadership changes the team (membership grants chart access)
    if (!canManageCareTeam({ role: gate.role, userId: gate.userId, organizationId: gate.organizationId }, client)) {
      await auditPhiAccess({ gate, req, action: 'DELETE', resourceType: 'treatmentTeamMember', resourceId: providerId, patientId: client.id, outcome: 'DENIED', metadata: { reason: 'not_primary_or_leadership' } });
      return NextResponse.json({ success: false, error: CARE_TEAM_CHANGE_DENIED }, { status: 403 });
    }
    const res = await removeTeamMember({ clientId: client.id, providerId });
    invalidateCaseloadScopedCaches(gate.organizationId);
    await auditPhiAccess({ gate, req, action: 'DELETE', resourceType: 'treatmentTeamMember', resourceId: providerId, patientId: client.id });
    return NextResponse.json(res);
  } catch (err: unknown) {
    const rule = teamRuleMessage(err);
    if (rule) return NextResponse.json({ success: false, error: rule }, { status: 400 });
    console.error('[api/clients/[id]/treatment-team/[providerId] DELETE] error:', err);
    return NextResponse.json(
      { success: false, error: 'Could not remove team member' },
      { status: 500 }
    );
  }
}
