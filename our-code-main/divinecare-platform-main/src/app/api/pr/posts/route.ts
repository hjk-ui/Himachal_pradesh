import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPr, createPrPost } from '@/lib/pr/manage';
import { PR_PLATFORMS } from '@/lib/pr/constants';

export const runtime = 'nodejs';

const schema = z.object({
  platform: z.enum(PR_PLATFORMS),
  content: z.string().trim().min(1).max(4000),
  date: z.string().trim().max(12).optional().default(''),
  time: z.string().trim().max(8).optional(),
  campaignId: z.string().trim().max(128).optional(),
  status: z.enum(['draft', 'scheduled']),
});

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPr(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = schema.parse(await req.json());
    if (body.status === 'scheduled' && !body.date) {
      return NextResponse.json({ success: false, error: 'Schedule date is required.' }, { status: 400 });
    }
    const result = await createPrPost(gate.organizationId, {
      platform: body.platform,
      content: body.content,
      date: body.date || new Date().toISOString().slice(0, 10),
      time: body.time,
      campaignId: body.campaignId,
      status: body.status,
    });
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json({ success: true, post: result.post }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof z.ZodError ? 'Please complete the post form.' : (err as Error).message;
    return NextResponse.json({ success: false, error: message || 'Could not save post' }, { status: 400 });
  }
}
