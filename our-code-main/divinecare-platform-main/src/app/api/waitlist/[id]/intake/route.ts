import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessWaitlist } from '@/lib/waitlist/manage';
import { convertWaitlistToIntake } from '@/lib/intake/manage';

export const runtime = 'nodejs';

const paramsSchema = z.object({ id: z.string().min(1).max(128) });

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessWaitlist(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { id } = paramsSchema.parse(await ctx.params);
    const result = await convertWaitlistToIntake(gate.organizationId, id, gate.userId);
    if (result.ok === false) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }
    return NextResponse.json({
      success: true,
      invite: result.invite,
      reused: 'reused' in result ? Boolean(result.reused) : false,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Could not create intake from waitlist' },
      { status: 400 }
    );
  }
}
