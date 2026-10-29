import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { linkPatientOnPurpose } from '@/lib/prescribing/linkChart';

export const runtime = 'nodejs';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  const { id } = await ctx.params;
  const result = await linkPatientOnPurpose(
    { organizationId: gate.organizationId, userId: gate.userId, role: gate.role },
    id
  );
  if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
  return NextResponse.json({ success: true, ...result });
}
