import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getPublicIntakeInvite } from '@/lib/intake/manage';

export const runtime = 'nodejs';

const paramsSchema = z.object({ token: z.string().min(8).max(128) });

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = paramsSchema.parse(await ctx.params);
    const result = await getPublicIntakeInvite(token);
    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }
    return NextResponse.json({
      success: true,
      alreadyCompleted: result.alreadyCompleted,
      invite: result.invite,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Invalid intake link' },
      { status: 400 }
    );
  }
}
