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
  } catch (err: unknown) {
    // Public caller: details stay in server logs.
    console.error('[intake/public GET]', err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: 'Invalid intake link' }, { status: 400 });
  }
}
