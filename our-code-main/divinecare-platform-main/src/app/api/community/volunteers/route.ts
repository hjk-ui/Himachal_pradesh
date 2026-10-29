import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessCommunity, createCommunityVolunteer } from '@/lib/community/manage';

export const runtime = 'nodejs';

const schema = z.object({
  name: z.string().trim().min(2).max(120),
  role: z.string().trim().min(1).max(80),
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
    const result = await createCommunityVolunteer(gate.organizationId, body);
    return NextResponse.json({ success: true, volunteer: result.volunteer }, { status: 201 });
  } catch (err: unknown) {
    const message =
      err instanceof z.ZodError ? 'Volunteer name and role are required.' : (err as Error).message;
    return NextResponse.json(
      { success: false, error: message || 'Could not add volunteer' },
      { status: 400 }
    );
  }
}
