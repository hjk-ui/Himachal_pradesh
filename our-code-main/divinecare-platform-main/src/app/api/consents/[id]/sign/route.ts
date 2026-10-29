import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessConsents, signConsent } from '@/lib/consents/manage';

export const runtime = 'nodejs';

const paramsSchema = z.object({ id: z.string().min(1).max(128) });
const bodySchema = z.object({
  signedByName: z.string().trim().max(120).optional().nullable(),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessConsents(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { id } = paramsSchema.parse(await ctx.params);
    const body = bodySchema.parse(await req.json().catch(() => ({})));
    const result = await signConsent(gate.organizationId, id, body);
    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }
    return NextResponse.json({ success: true, consent: result.consent });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Could not sign consent' },
      { status: 400 }
    );
  }
}
