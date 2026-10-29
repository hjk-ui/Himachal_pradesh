import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPr, createPrRelease } from '@/lib/pr/manage';

export const runtime = 'nodejs';

const schema = z.object({
  title: z.string().trim().min(4).max(240),
  body: z.string().trim().max(8000).optional(),
  date: z.string().trim().max(12).optional(),
  outlet: z.string().trim().max(240).optional(),
  status: z.enum(['draft', 'review', 'published']).optional(),
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
    const result = await createPrRelease(gate.organizationId, body);
    return NextResponse.json({ success: true, release: result.release }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof z.ZodError ? 'Please complete the release form.' : (err as Error).message;
    return NextResponse.json({ success: false, error: message || 'Could not save release' }, { status: 400 });
  }
}
