import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canChangeCareTeam, updateCareTeamMember } from '@/lib/clients/careTeam';

export const runtime = 'nodejs';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (gate.ok === false) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const { id } = await ctx.params;
    const members = await prisma.clientTreatmentTeamMember.findMany({
      where: { clientId: id },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });

    if (members.length > 0) {
      return NextResponse.json({ success: true, team: members });
    }

    // Fallback: check client treatmentTeam JSON
    const client = await prisma.client.findUnique({
      where: { id },
      select: { treatmentTeam: true },
    });

    return NextResponse.json({
      success: true,
      team: Array.isArray(client?.treatmentTeam) ? client.treatmentTeam : [],
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not fetch care team' },
      { status: 500 }
    );
  }
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (gate.ok === false) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const { id: clientId } = await ctx.params;
    const body = await req.json();

    const member = await prisma.clientTreatmentTeamMember.create({
      data: {
        clientId,
        providerId: body.providerId || body.id || null,
        name: body.name || 'Provider',
        role: body.role || 'Therapist',
        credentials: body.credentials || null,
        isPrimary: Boolean(body.isPrimary || body.primary),
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

    return NextResponse.json({ success: true, member }, { status: 201 });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not add team member' },
      { status: 500 }
    );
  }
}

const patchSchema = z.object({
  memberId: z.string().min(1),
  isPrimary: z.boolean().optional(),
  role: z.string().trim().min(1).max(60).optional(),
  credentials: z.string().trim().max(60).nullable().optional(),
});

/** PATCH — change a care-team member. Primary clinician or leadership only. */
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (gate.ok === false) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const { id: clientId } = await ctx.params;
    const allowed = await canChangeCareTeam(clientId, {
      id: gate.userId,
      role: gate.role,
      organizationId: gate.organizationId,
    });
    if (allowed.ok === false) {
      return NextResponse.json(
        { success: false, error: allowed.error, ...('code' in allowed ? { code: allowed.code } : {}) },
        { status: allowed.status }
      );
    }

    const body = patchSchema.parse(await req.json());
    const result = await updateCareTeamMember(clientId, body);
    if (result.ok === false) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json({ success: true, member: result.member });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid care team update' },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not update care team' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (gate.ok === false) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const { id: clientId } = await ctx.params;
    const { searchParams } = new URL(req.url);
    const memberId = searchParams.get('memberId') || searchParams.get('id');

    if (memberId) {
      await prisma.clientTreatmentTeamMember.deleteMany({
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
    }

    return NextResponse.json({ success: true, message: 'Removed team member' });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not remove team member' },
      { status: 500 }
    );
  }
}
