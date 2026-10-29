import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';

export const runtime = 'nodejs';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const { id } = await ctx.params;
    const participant = await prisma.aotParticipant.findUnique({
      where: { id },
    });

    if (!participant) {
      return NextResponse.json({ success: false, error: 'AOT Participant not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, participant });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Error fetching AOT participant' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const { id } = await ctx.params;
    const body = await req.json();

    const updated = await prisma.aotParticipant.update({
      where: { id },
      data: {
        status: body.status ?? undefined,
        county: body.county ?? undefined,
        diagnosis: body.diagnosis ?? undefined,
        petitionDate: body.petitionDate ? new Date(body.petitionDate) : undefined,
        hearingDate: body.hearingDate ? new Date(body.hearingDate) : undefined,
        orderStart: body.orderStart ? new Date(body.orderStart) : undefined,
        orderEnd: body.orderEnd ? new Date(body.orderEnd) : undefined,
        eligibilityData: body.eligibilityData ?? undefined,
        psychiatristAffidavit: body.psychiatristAffidavit ?? undefined,
        deadlines: body.deadlines ?? undefined,
        teamCadence: body.teamCadence ?? undefined,
        escalationEvents: body.escalationEvents ?? undefined,
      },
    });

    return NextResponse.json({ success: true, participant: updated });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Error updating AOT participant' },
      { status: 500 }
    );
  }
}
