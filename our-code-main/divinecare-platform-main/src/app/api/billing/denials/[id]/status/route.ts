import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { canAccessDenials } from '@/lib/billing/ledger';

export const runtime = 'nodejs';

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessDenials(gate.role) || !canAccessPath(gate.role, '/dashboard/billing/denials')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { id: denialId } = await ctx.params;
    const body = await req.json();

    const status = body.status;
    if (!status) {
      return NextResponse.json({ success: false, error: 'status is required' }, { status: 400 });
    }

    // Try finding by id or claimId
    const existing = await prisma.claimDenial.findFirst({
      where: {
        OR: [{ id: denialId }, { claimId: denialId }],
      },
    });

    if (existing) {
      const updated = await prisma.claimDenial.update({
        where: { id: existing.id },
        data: {
          status: status.toUpperCase(),
          appealResolutionNote: body.resolutionNote || null,
          updatedAt: new Date(),
        },
      });

      return NextResponse.json({ success: true, denial: updated });
    }

    return NextResponse.json({
      success: true,
      message: `Status updated to ${status}`,
      denialId,
      status,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not update denial status' },
      { status: 500 }
    );
  }
}
