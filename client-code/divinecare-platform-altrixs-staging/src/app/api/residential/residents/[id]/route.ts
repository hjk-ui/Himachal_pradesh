import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { findResidentInOrg } from '../../_scope';

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
    if (!(await findResidentInOrg(id, gate.organizationId))) {
      return NextResponse.json({ success: false, error: 'Resident not found' }, { status: 404 });
    }
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
    console.error('[api/residential/residents/[id] GET] error:', err);
    return NextResponse.json(
      { success: false, error: 'Error fetching resident' },
      { status: 500 }
    );
  }
}

const patchSchema = z.object({
  room: z.string().trim().min(1).max(40).optional(),
  counselor: z.string().trim().min(1).max(160).optional(),
  phase: z.string().trim().min(1).max(80).optional(),
  txPlanStatus: z.enum(['current', 'due', 'overdue']).optional(),
  orientationDone: z.boolean().optional(),
  paUnitsRemaining: z.number().int().min(0).max(10000).optional(),
  lastCsrDate: z.string().trim().min(8).max(40).optional(),
  nextCsrDate: z.string().trim().min(8).max(40).optional(),
  active: z.boolean().optional(),
});

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
    const parsed = patchSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'Invalid resident update' }, { status: 400 });
    }
    const body = parsed.data;
    if (!(await findResidentInOrg(id, gate.organizationId))) {
      return NextResponse.json({ success: false, error: 'Resident not found' }, { status: 404 });
    }

    const updated = await prisma.residentialResident.update({
      where: { id },
      data: {
        room: body.room,
        counselor: body.counselor,
        phase: body.phase,
        txPlanStatus: body.txPlanStatus,
        orientationDone: body.orientationDone,
        paUnitsRemaining: body.paUnitsRemaining,
        lastCsrDate: body.lastCsrDate ? new Date(body.lastCsrDate) : undefined,
        nextCsrDate: body.nextCsrDate ? new Date(body.nextCsrDate) : undefined,
        active: body.active,
      },
    });

    return NextResponse.json({ success: true, resident: updated });
  } catch (err: unknown) {
    console.error('[api/residential/residents/[id] PATCH] error:', err);
    return NextResponse.json(
      { success: false, error: 'Error updating resident' },
      { status: 500 }
    );
  }
}
