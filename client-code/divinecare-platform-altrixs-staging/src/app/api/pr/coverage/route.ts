import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPr, createPrCoverage } from '@/lib/pr/manage';

export const runtime = 'nodejs';

const schema = z.object({
  outlet: z.string().trim().min(2).max(160),
  medium: z.string().trim().min(2).max(80),
  headline: z.string().trim().min(4).max(400),
  date: z.string().trim().min(8).max(12),
  sentiment: z.enum(['positive', 'neutral', 'negative']),
  url: z.string().trim().max(500).optional(),
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
    const result = await createPrCoverage(gate.organizationId, body);
    return NextResponse.json({ success: true, coverage: result.coverage }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof z.ZodError ? 'Please complete the coverage form.' : (err as Error).message;
    return NextResponse.json({ success: false, error: message || 'Could not add coverage' }, { status: 400 });
  }
}
