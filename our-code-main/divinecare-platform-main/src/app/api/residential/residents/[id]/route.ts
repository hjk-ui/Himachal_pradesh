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
    const resident = await prisma.residentialResident.findUnique({
      where: { id },
      include: {
        shiftNotes: { orderBy: { shiftDate: 'desc' } },
      },
    });

    if (!resident) {
      return NextResponse.json({ success: false, error: 'Resident not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, resident });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Error fetching resident' },
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

    const updated = await prisma.residentialResident.update({
      where: { id },
      data: {
        room: body.room ?? undefined,
        counselor: body.counselor ?? undefined,
        phase: body.phase ?? undefined,
        txPlanStatus: body.txPlanStatus ?? undefined,
        orientationDone: body.orientationDone !== undefined ? Boolean(body.orientationDone) : undefined,
        paUnitsRemaining: body.paUnitsRemaining !== undefined ? Number(body.paUnitsRemaining) : undefined,
        lastCsrDate: body.lastCsrDate ? new Date(body.lastCsrDate) : undefined,
        nextCsrDate: body.nextCsrDate ? new Date(body.nextCsrDate) : undefined,
        active: body.active !== undefined ? Boolean(body.active) : undefined,
      },
    });

    return NextResponse.json({ success: true, resident: updated });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Error updating resident' },
      { status: 500 }
    );
  }
}
