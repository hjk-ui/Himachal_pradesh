import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { clientByIdWhere } from '@/lib/clients/orgScope';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { canAccessPath } from '@/lib/auth/roleAccess';

export const runtime = 'nodejs';

/** Same roles that can open the Alerts page (where team alerts are triaged). */
const ALERTS_PATH = '/dashboard/alerts';

const CreateTeamAlertSchema = z.object({
  clientId: z.string().min(1, 'Client ID is required'),
  targetUserId: z.string().min(1, 'Target clinician ID is required'),
  urgency: z.enum(['Urgent', 'Routine', 'FYI']).default('Routine'),
  noteType: z.string().default('Clinical Concern'),
  message: z.string().min(1, 'Message / concern text is required'),
});

export async function GET(req: Request) {
  const ctx = await requireOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }
  if (!canAccessPath(ctx.role, ALERTS_PATH, ctx.capabilities)) {
    await auditPhiAccess({ gate: ctx, req, action: 'LIST', resourceType: 'teamAlert', outcome: 'DENIED', metadata: { reason: 'role_not_permitted' } });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const alerts = await prisma.teamAlert.findMany({
      where: { organizationId: ctx.organizationId },
      include: {
        client: { select: { id: true, name: true } },
        targetUser: { select: { id: true, name: true, role: true } },
        authorUser: { select: { id: true, name: true, role: true } },
        resolvedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // No auto-seeding: this org holds real patient data, so fabricated alerts must never be written.

    const payload = alerts.map((a) => ({
      id: a.id,
      senderName: a.authorUser?.name || 'Staff Clinician',
      senderRole: a.authorUser?.role || 'Clinician',
      taggedClinician: a.targetUser?.name || 'Care Team Member',
      clientName: a.client?.name || 'Client',
      clientId: a.clientId,
      urgency: a.urgency,
      noteType: a.noteType,
      concernText: a.message,
      createdAt: a.createdAt.toISOString(),
      status: a.resolved ? ('Resolved' as const) : ('Open' as const),
      resolvedAt: a.resolvedAt ? a.resolvedAt.toISOString() : undefined,
      resolvedBy: a.resolvedBy?.name || undefined,
      resolutionNote: a.resolutionNote || undefined,
    }));

    await auditPhiAccess({
      gate: ctx,
      req,
      action: 'LIST',
      resourceType: 'teamAlert',
      metadata: {
        count: alerts.length,
        alertIds: alerts.slice(0, 50).map((a) => a.id),
        clientIds: [...new Set(alerts.map((a) => a.clientId))].slice(0, 50),
      },
    });

    return NextResponse.json({ alerts: payload });
  } catch (err) {
    console.error('Failed to get team alerts:', err);
    return NextResponse.json({ error: 'Failed to retrieve team alerts' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const ctx = await requireOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }
  if (!canAccessPath(ctx.role, ALERTS_PATH, ctx.capabilities)) {
    await auditPhiAccess({ gate: ctx, req, action: 'CREATE', resourceType: 'teamAlert', outcome: 'DENIED', metadata: { reason: 'role_not_permitted' } });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const json = await req.json();
    const parsed = CreateTeamAlertSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid alert payload', issues: parsed.error.issues },
        { status: 400 }
      );
    }

    // Both the client and the tagged clinician must belong to the caller's organization
    const [client, target] = await Promise.all([
      prisma.client.findFirst({ where: clientByIdWhere(parsed.data.clientId, ctx.organizationId), select: { id: true } }),
      prisma.user.findFirst({ where: { id: parsed.data.targetUserId, organizationId: ctx.organizationId }, select: { id: true } }),
    ]);
    if (!client || !target) {
      await auditPhiAccess({ gate: ctx, req, action: 'CREATE', resourceType: 'teamAlert', resourceId: parsed.data.clientId, patientId: parsed.data.clientId, outcome: 'DENIED', metadata: { reason: !client ? 'client_not_found' : 'target_not_found' } });
      return NextResponse.json({ error: 'Client or clinician not found in this organization' }, { status: 404 });
    }

    const newAlert = await prisma.teamAlert.create({
      data: {
        organizationId: ctx.organizationId,
        clientId: client.id,
        targetUserId: target.id,
        authorUserId: ctx.userId,
        urgency: parsed.data.urgency,
        noteType: parsed.data.noteType,
        message: parsed.data.message,
        resolved: false,
      },
      include: {
        client: { select: { id: true, name: true } },
        targetUser: { select: { id: true, name: true, role: true } },
        authorUser: { select: { id: true, name: true, role: true } },
      },
    });

    await auditPhiAccess({
      gate: ctx,
      req,
      action: 'CREATE',
      resourceType: 'teamAlert',
      resourceId: newAlert.id,
      patientId: newAlert.clientId,
      metadata: { targetUserId: newAlert.targetUserId, urgency: newAlert.urgency, noteType: newAlert.noteType },
    });

    return NextResponse.json({
      alert: {
        id: newAlert.id,
        senderName: newAlert.authorUser?.name || 'Staff Clinician',
        senderRole: newAlert.authorUser?.role || 'Clinician',
        taggedClinician: newAlert.targetUser?.name || 'Care Team Member',
        clientName: newAlert.client?.name || 'Client',
        clientId: newAlert.clientId,
        urgency: newAlert.urgency,
        noteType: newAlert.noteType,
        concernText: newAlert.message,
        createdAt: newAlert.createdAt.toISOString(),
        status: 'Open',
      },
    }, { status: 201 });
  } catch (err) {
    console.error('Failed to create team alert:', err);
    return NextResponse.json({ error: 'Failed to create team alert' }, { status: 500 });
  }
}
