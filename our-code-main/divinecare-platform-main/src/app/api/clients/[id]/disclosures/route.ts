import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { listDisclosures, recordDisclosure } from '@/lib/privacy/disclosures';

export const runtime = 'nodejs';

const bodySchema = z.object({
  recipient: z.string().trim().min(1).max(200),
  purpose: z.string().trim().min(1).max(500),
  disclosedAt: z.string().trim().max(40).optional().nullable(),
});

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  const { id } = await ctx.params;
  const result = await listDisclosures(
    { organizationId: gate.organizationId, userId: gate.userId, role: gate.role },
    id
  );
  if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
  return NextResponse.json({ success: true, disclosures: result.disclosures });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  const { id } = await ctx.params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Recipient and purpose are required' }, { status: 400 });
  }
  const result = await recordDisclosure(
    { organizationId: gate.organizationId, userId: gate.userId, role: gate.role },
    { clientId: id, ...parsed.data }
  );
  if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
  return NextResponse.json({ success: true, disclosure: result.disclosure }, { status: 201 });
}
