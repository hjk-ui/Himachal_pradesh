import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { removeTeamMember } from '@/services/treatmentTeamService';

export const runtime = 'nodejs';

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string; providerId: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const { id: clientId, providerId } = await ctx.params;
    const res = await removeTeamMember({ clientId, providerId });
    return NextResponse.json(res);
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not remove team member' },
      { status: 400 }
    );
  }
}
