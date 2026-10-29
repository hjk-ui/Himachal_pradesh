import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';

export const runtime = 'nodejs';

const ResolveSchema = z.object({
  resolutionNote: z.string().min(1, 'Resolution note is required'),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await requireOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const { id } = await params;

  try {
    const json = await req.json();
    const parsed = ResolveSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid resolution payload', issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const alert = await prisma.teamAlert.findFirst({
      where: {
        id,
        organizationId: ctx.organizationId,
      },
    });

    if (!alert) {
      return NextResponse.json({ error: 'Alert not found' }, { status: 404 });
    }

    const updated = await prisma.teamAlert.update({
      where: { id },
      data: {
        resolved: true,
        resolvedAt: new Date(),
        resolvedById: ctx.userId,
        resolutionNote: parsed.data.resolutionNote,
      },
      include: {
        client: { select: { id: true, name: true } },
        targetUser: { select: { id: true, name: true, role: true } },
        authorUser: { select: { id: true, name: true, role: true } },
        resolvedBy: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json({
      alert: {
        id: updated.id,
        senderName: updated.authorUser?.name || 'Staff Clinician',
        senderRole: updated.authorUser?.role || 'Clinician',
        taggedClinician: updated.targetUser?.name || 'Care Team Member',
        clientName: updated.client?.name || 'Client',
        clientId: updated.clientId,
        urgency: updated.urgency,
        noteType: updated.noteType,
        concernText: updated.message,
        createdAt: updated.createdAt.toISOString(),
        status: 'Resolved' as const,
        resolvedAt: updated.resolvedAt?.toISOString(),
        resolvedBy: updated.resolvedBy?.name,
        resolutionNote: updated.resolutionNote,
      },
    });
  } catch (err) {
    console.error('Failed to resolve team alert:', err);
    return NextResponse.json({ error: 'Failed to resolve team alert' }, { status: 500 });
  }
}
