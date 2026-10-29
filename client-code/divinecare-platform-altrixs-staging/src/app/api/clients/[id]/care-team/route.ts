import { NextResponse } from 'next/server';
import { invalidateCaseloadScopedCaches } from '@/lib/perf/cache';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { canAccessClientRoster, canEditClientProfile, canManageCareTeam, CARE_TEAM_CHANGE_DENIED } from '@/lib/clients/orgScope';
import { findOrgProvider, findScopedClient } from '@/lib/clients/teamAccess';

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
    const { id: requestedId } = await ctx.params;
    if (!canAccessClientRoster(gate.role)) {
      await auditPhiAccess({ gate, req, action: 'LIST', resourceType: 'careTeam', patientId: requestedId, outcome: 'DENIED', metadata: { reason: 'role_not_permitted' } });
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }
    const scoped = await findScopedClient(gate, requestedId);
    if (!scoped) {
      await auditPhiAccess({ gate, req, action: 'LIST', resourceType: 'careTeam', patientId: requestedId, outcome: 'DENIED', metadata: { reason: 'client_not_found' } });
      return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });
    }
    const id = scoped.id;

    const members = await prisma.clientTreatmentTeamMember.findMany({
      where: { clientId: id },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });

    if (members.length > 0) {
      await auditPhiAccess({ gate, req, action: 'LIST', resourceType: 'careTeam', resourceId: id, patientId: id, metadata: { count: members.length, source: 'treatmentTeamMember' } });
      return NextResponse.json({ success: true, team: members });
    }

    // Fallback: check client treatmentTeam JSON
    const client = await prisma.client.findUnique({
      where: { id },
      select: { treatmentTeam: true },
    });

    await auditPhiAccess({
      gate,
      req,
      action: 'LIST',
      resourceType: 'careTeam',
      resourceId: id,
      patientId: id,
      metadata: { count: Array.isArray(client?.treatmentTeam) ? client.treatmentTeam.length : 0, source: 'clientJson' },
    });

    return NextResponse.json({
      success: true,
      team: Array.isArray(client?.treatmentTeam) ? client.treatmentTeam : [],
    });
  } catch (err: unknown) {
    console.error('[api/clients/[id]/care-team GET] error:', err);
    return NextResponse.json(
      { success: false, error: 'Could not fetch care team' },
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
    const { id: requestedId } = await ctx.params;
    if (!canEditClientProfile(gate.role)) {
      await auditPhiAccess({ gate, req, action: 'CREATE', resourceType: 'careTeamMember', patientId: requestedId, outcome: 'DENIED', metadata: { reason: 'role_not_permitted' } });
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }
    const scoped = await findScopedClient(gate, requestedId);
    if (!scoped) {
      await auditPhiAccess({ gate, req, action: 'CREATE', resourceType: 'careTeamMember', patientId: requestedId, outcome: 'DENIED', metadata: { reason: 'client_not_found' } });
      return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });
    }
    // Only the primary clinician or leadership changes the team (membership grants chart access)
    if (!canManageCareTeam({ role: gate.role, userId: gate.userId, organizationId: gate.organizationId }, scoped)) {
      await auditPhiAccess({ gate, req, action: 'CREATE', resourceType: 'careTeamMember', patientId: scoped.id, outcome: 'DENIED', metadata: { reason: 'not_primary_or_leadership' } });
      return NextResponse.json({ success: false, error: CARE_TEAM_CHANGE_DENIED }, { status: 403 });
    }
    const clientId = scoped.id;
    const body = await req.json().catch(() => ({}));

    // Team members must be staff of the caller's organization.
    const requestedProviderId = String(body.providerId || body.id || '').trim();
    const provider = await findOrgProvider(gate.organizationId, requestedProviderId);
    if (!provider) {
      await auditPhiAccess({ gate, req, action: 'CREATE', resourceType: 'careTeamMember', patientId: clientId, outcome: 'DENIED', metadata: { reason: 'provider_not_in_org', providerId: requestedProviderId || null } });
      return NextResponse.json(
        { success: false, error: 'Provider not found in your organization' },
        { status: 400 }
      );
    }

    // One row per provider per client (team membership grants chart access; no duplicates)
    const existing = await prisma.clientTreatmentTeamMember.findFirst({
      where: { clientId, providerId: provider.id },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json(
        { success: false, error: 'This provider is already on the care team' },
        { status: 409 }
      );
    }

    const member = await prisma.clientTreatmentTeamMember.create({
      data: {
        clientId,
        providerId: provider.id,
        name: provider.name || body.name || 'Provider',
        role: body.role || 'Therapist',
        credentials: body.credentials || null,
        isPrimary: Boolean(body.isPrimary || body.primary),
        assignedBy: gate.userId,
      },
    });

    // Also sync client.treatmentTeam JSON for backward compatibility
    const allMembers = await prisma.clientTreatmentTeamMember.findMany({
      where: { clientId },
    });
    await prisma.client.update({
      where: { id: clientId },
      data: {
        treatmentTeam: allMembers.map((m) => ({
          id: m.providerId || m.id,
          name: m.name,
          role: m.role,
          credentials: m.credentials,
          primary: m.isPrimary,
        })),
      },
    }).catch(() => undefined);

    await auditPhiAccess({
      gate,
      req,
      action: 'CREATE',
      resourceType: 'careTeamMember',
      resourceId: member.id,
      patientId: clientId,
      metadata: { providerId: member.providerId, teamRole: member.role, isPrimary: member.isPrimary },
    });

    // Team membership opens the chart now; drop cached caseload lists / home / inbox for this org
    invalidateCaseloadScopedCaches(gate.organizationId);
    return NextResponse.json({ success: true, member }, { status: 201 });
  } catch (err: unknown) {
    console.error('[api/clients/[id]/care-team POST] error:', err);
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
    const { id: requestedId } = await ctx.params;
    const { searchParams } = new URL(req.url);
    const memberId = searchParams.get('memberId') || searchParams.get('id');

    if (!canEditClientProfile(gate.role)) {
      await auditPhiAccess({ gate, req, action: 'DELETE', resourceType: 'careTeamMember', resourceId: memberId, patientId: requestedId, outcome: 'DENIED', metadata: { reason: 'role_not_permitted' } });
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }
    const scoped = await findScopedClient(gate, requestedId);
    if (!scoped) {
      await auditPhiAccess({ gate, req, action: 'DELETE', resourceType: 'careTeamMember', resourceId: memberId, patientId: requestedId, outcome: 'DENIED', metadata: { reason: 'client_not_found' } });
      return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });
    }
    // Only the primary clinician or leadership changes the team (membership grants chart access)
    if (!canManageCareTeam({ role: gate.role, userId: gate.userId, organizationId: gate.organizationId }, scoped)) {
      await auditPhiAccess({ gate, req, action: 'DELETE', resourceType: 'careTeamMember', resourceId: memberId, patientId: scoped.id, outcome: 'DENIED', metadata: { reason: 'not_primary_or_leadership' } });
      return NextResponse.json({ success: false, error: CARE_TEAM_CHANGE_DENIED }, { status: 403 });
    }
    const clientId = scoped.id;

    if (memberId) {
      const removed = await prisma.clientTreatmentTeamMember.deleteMany({
        where: {
          clientId,
          OR: [{ id: memberId }, { providerId: memberId }],
        },
      });

      const remaining = await prisma.clientTreatmentTeamMember.findMany({
        where: { clientId },
      });
      await prisma.client.update({
        where: { id: clientId },
        data: {
          treatmentTeam: remaining.map((m) => ({
            id: m.providerId || m.id,
            name: m.name,
            role: m.role,
            credentials: m.credentials,
            primary: m.isPrimary,
          })),
        },
      }).catch(() => undefined);

      await auditPhiAccess({
        gate,
        req,
        action: 'DELETE',
        resourceType: 'careTeamMember',
        resourceId: memberId,
        patientId: clientId,
        metadata: { count: removed.count },
      });
    }

    invalidateCaseloadScopedCaches(gate.organizationId);
    return NextResponse.json({ success: true, message: 'Removed team member' });
  } catch (err: unknown) {
    console.error('[api/clients/[id]/care-team DELETE] error:', err);
    return NextResponse.json(
      { success: false, error: 'Could not remove team member' },
      { status: 500 }
    );
  }
}
