import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';

export const runtime = 'nodejs';

const CreateTeamAlertSchema = z.object({
  clientId: z.string().min(1, 'Client ID is required'),
  targetUserId: z.string().min(1, 'Target clinician ID is required'),
  urgency: z.enum(['Urgent', 'Routine', 'FYI']).default('Routine'),
  noteType: z.string().default('Clinical Concern'),
  message: z.string().min(1, 'Message / concern text is required'),
});

export async function GET() {
  const ctx = await requireOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  try {
    let alerts = await prisma.teamAlert.findMany({
      where: { organizationId: ctx.organizationId },
      include: {
        client: { select: { id: true, name: true } },
        targetUser: { select: { id: true, name: true, role: true } },
        authorUser: { select: { id: true, name: true, role: true } },
        resolvedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });


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

  try {
    const json = await req.json();
    const parsed = CreateTeamAlertSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid alert payload', issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const newAlert = await prisma.teamAlert.create({
      data: {
        organizationId: ctx.organizationId,
        clientId: parsed.data.clientId,
        targetUserId: parsed.data.targetUserId,
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
