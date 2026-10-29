import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { EVENT_TYPES } from '@/lib/community/constants';
import { canAccessCommunity, createCommunityEvent } from '@/lib/community/manage';

export const runtime = 'nodejs';

const createSchema = z.object({
  title: z.string().trim().min(2).max(200),
  eventType: z.string().trim().min(1).max(80),
  date: z.string().trim().min(8).max(12),
  startTime: z.string().trim().min(4).max(8),
  endTime: z.string().trim().min(4).max(8),
  locationName: z.string().trim().min(2).max(240),
  description: z.string().trim().max(4000).optional(),
  expectedAttendees: z.number().int().min(0).max(100000).optional(),
  volunteersNeeded: z.number().int().min(0).max(10000).optional(),
  tags: z.array(z.string().trim().max(40)).max(12).optional(),
});

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessCommunity(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = createSchema.parse(await req.json());
    const typeOk = (EVENT_TYPES as readonly string[]).includes(body.eventType) || body.eventType.length > 0;
    if (!typeOk) {
      return NextResponse.json({ success: false, error: 'Invalid event type' }, { status: 400 });
    }
    const result = await createCommunityEvent(gate.organizationId, body);
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json({ success: true, event: result.event }, { status: 201 });
  } catch (err: unknown) {
    const message =
      err instanceof z.ZodError ? 'Please complete the event form.' : (err as Error).message;
    return NextResponse.json({ success: false, error: message || 'Could not create event' }, { status: 400 });
  }
}
