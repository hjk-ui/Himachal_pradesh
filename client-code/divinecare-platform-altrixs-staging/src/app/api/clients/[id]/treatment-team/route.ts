import { NextResponse } from 'next/server';
import { invalidateCaseloadScopedCaches } from '@/lib/perf/cache';
import { requireOrgContext } from '@/lib/auth/tenant';
import {
  addTeamMember,
  removeTeamMember,
  getClientTreatmentTeam,
} from '@/services/treatmentTeamService';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { canAccessClientRoster, canEditClientProfile, canManageCareTeam, CARE_TEAM_CHANGE_DENIED } from '@/lib/clients/orgScope';
import { findOrgProvider, findScopedClient, teamRuleMessage } from '@/lib/clients/teamAccess';

export const runtime = 'nodejs';

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const { id } = await ctx.params;
    if (!canAccessClientRoster(gate.role)) {
      await auditPhiAccess({ gate, req, action: 'LIST', resourceType: 'treatmentTeamMember', patientId: id, outcome: 'DENIED', metadata: { reason: 'role_not_permitted' } });
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }
    const client = await findScopedClient(gate, id);
    if (!client) {
      await auditPhiAccess({ gate, req, action: 'LIST', resourceType: 'treatmentTeamMember', patientId: id, outcome: 'DENIED', metadata: { reason: 'client_not_found' } });
      return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });
    }
    const team = await getClientTreatmentTeam(client.id);
    await auditPhiAccess({ gate, req, action: 'LIST', resourceType: 'treatmentTeamMember', resourceId: client.id, patientId: client.id, metadata: { count: team.length } });
    return NextResponse.json({ success: true, team });
  } catch (err: unknown) {
    console.error('[api/clients/[id]/treatment-team GET] error:', err);
    return NextResponse.json(
      { success: false, error: 'Could not fetch treatment team' },
      { status: 500 }
    );
  }
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const { id } = await ctx.params;
    if (!canEditClientProfile(gate.role)) {
      await auditPhiAccess({ gate, req, action: 'CREATE', resourceType: 'treatmentTeamMember', patientId: id, outcome: 'DENIED', metadata: { reason: 'role_not_permitted' } });
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }
    const client = await findScopedClient(gate, id);
    if (!client) {
      await auditPhiAccess({ gate, req, action: 'CREATE', resourceType: 'treatmentTeamMember', patientId: id, outcome: 'DENIED', metadata: { reason: 'client_not_found' } });
      return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });
    }
    // Only the primary clinician or leadership changes the team (membership grants chart access)
    if (!canManageCareTeam({ role: gate.role, userId: gate.userId, organizationId: gate.organizationId }, client)) {
      await auditPhiAccess({ gate, req, action: 'CREATE', resourceType: 'treatmentTeamMember', patientId: client.id, outcome: 'DENIED', metadata: { reason: 'not_primary_or_leadership' } });
      return NextResponse.json({ success: false, error: CARE_TEAM_CHANGE_DENIED }, { status: 403 });
    }
    const clientId = client.id;
    const body = await req.json().catch(() => ({}));

    const requestedProviderId = String(body.providerId || body.id || '').trim();
    if (!requestedProviderId) {
      return NextResponse.json(
        { success: false, error: 'Provider ID is required' },
        { status: 400 }
      );
    }

    // Team members must be staff of the caller's organization.
    const provider = await findOrgProvider(gate.organizationId, requestedProviderId);
    if (!provider) {
      await auditPhiAccess({ gate, req, action: 'CREATE', resourceType: 'treatmentTeamMember', patientId: clientId, outcome: 'DENIED', metadata: { reason: 'provider_not_in_org', providerId: requestedProviderId } });
      return NextResponse.json(
        { success: false, error: 'Provider not found in your organization' },
        { status: 400 }
      );
    }

    const member = await addTeamMember({
      clientId,
      providerId: provider.id,
      name: provider.name || body.name || 'Provider',
      role: body.role || 'Therapist',
      credentials: body.credentials || null,
      isPrimary: Boolean(body.isPrimary || body.primary),
      avatarColor: body.avatarColor || body.color || null,
      initials: body.initials || null,
      assignedBy: gate.userId,
    });

    await auditPhiAccess({
      gate,
      req,
      action: 'CREATE',
      resourceType: 'treatmentTeamMember',
      resourceId: (member as { id?: string } | null)?.id ?? null,
      patientId: clientId,
      metadata: { providerId: provider.id, teamRole: body.role || 'Therapist', isPrimary: Boolean(body.isPrimary || body.primary) },
    });

    // Team membership opens the chart now; drop cached caseload lists / home / inbox for this org
    invalidateCaseloadScopedCaches(gate.organizationId);
    return NextResponse.json({ success: true, member }, { status: 201 });
  } catch (err: unknown) {
    const rule = teamRuleMessage(err);
    if (rule) return NextResponse.json({ success: false, error: rule }, { status: 400 });
    console.error('[api/clients/[id]/treatment-team POST] error:', err);
    return NextResponse.json(
      { success: false, error: 'Could not add team member' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const { id } = await ctx.params;
    const { searchParams } = new URL(req.url);
    const providerId = searchParams.get('providerId') || searchParams.get('id');

    if (!providerId) {
      return NextResponse.json(
        { success: false, error: 'Provider ID is required' },
        { status: 400 }
      );
    }
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
    console.error('[api/clients/[id]/treatment-team DELETE] error:', err);
    return NextResponse.json(
      { success: false, error: 'Could not remove team member' },
      { status: 500 }
    );
  }
}
