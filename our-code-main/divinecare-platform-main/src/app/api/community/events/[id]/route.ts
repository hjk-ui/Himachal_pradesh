import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessCommunity, updateCommunityEvent } from '@/lib/community/manage';

export const runtime = 'nodejs';

const paramsSchema = z.object({ id: z.string().min(1).max(128) });

const patchSchema = z.object({
  title: z.string().trim().min(2).max(200).optional(),
  eventType: z.string().trim().min(1).max(80).optional(),
  date: z.string().trim().min(8).max(12).optional(),
  startTime: z.string().trim().min(4).max(8).optional(),
  endTime: z.string().trim().min(4).max(8).optional(),
  locationName: z.string().trim().min(2).max(240).optional(),
  description: z.string().trim().max(4000).optional(),
  expectedAttendees: z.number().int().min(0).max(100000).optional(),
  volunteersNeeded: z.number().int().min(0).max(10000).optional(),
  volunteersSignedUp: z.number().int().min(0).max(10000).optional(),
  registeredCount: z.number().int().min(0).max(100000).optional(),
  status: z.enum(['upcoming', 'completed']).optional(),
  tags: z.array(z.string().trim().max(40)).max(12).optional(),
  isFeatured: z.boolean().optional(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessCommunity(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { id } = paramsSchema.parse(await ctx.params);
    const body = patchSchema.parse(await req.json());
    const result = await updateCommunityEvent(gate.organizationId, id, body);
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json({ success: true, event: result.event });
  } catch (err: unknown) {
    const message =
      err instanceof z.ZodError ? 'Invalid event update' : (err as Error).message;
    return NextResponse.json({ success: false, error: message || 'Could not update event' }, { status: 400 });
  }
}
