import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessCommunity, createCommunityPartner } from '@/lib/community/manage';

export const runtime = 'nodejs';

const schema = z.object({
  name: z.string().trim().min(2).max(160),
  category: z.enum(['Government', 'Faith', 'Education', 'Nonprofit', 'Corporate']),
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
    const body = schema.parse(await req.json());
    const result = await createCommunityPartner(gate.organizationId, body);
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json({ success: true, partner: result.partner }, { status: 201 });
  } catch (err: unknown) {
    const message =
      err instanceof z.ZodError ? 'Partner name and category are required.' : (err as Error).message;
    return NextResponse.json({ success: false, error: message || 'Could not add partner' }, { status: 400 });
  }
}
