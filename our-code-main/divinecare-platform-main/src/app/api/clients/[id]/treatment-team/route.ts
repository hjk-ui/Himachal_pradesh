import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import {
  addTeamMember,
  removeTeamMember,
  getClientTreatmentTeam,
} from '@/services/treatmentTeamService';

export const runtime = 'nodejs';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const { id } = await ctx.params;
    const team = await getClientTreatmentTeam(id);
    return NextResponse.json({ success: true, team });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not fetch treatment team' },
      { status: 500 }
    );
  }
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const { id: clientId } = await ctx.params;
    const body = await req.json();

    if (!body.providerId && !body.id && !body.name) {
      return NextResponse.json(
        { success: false, error: 'Provider ID and name are required' },
        { status: 400 }
      );
    }

    const member = await addTeamMember({
      clientId,
      providerId: body.providerId || body.id || `prov-${Date.now()}`,
      name: body.name,
      role: body.role || 'Therapist',
      credentials: body.credentials || null,
      isPrimary: Boolean(body.isPrimary || body.primary),
      avatarColor: body.avatarColor || body.color || null,
      initials: body.initials || null,
      assignedBy: gate.session?.user?.id || null,
    });

    return NextResponse.json({ success: true, member }, { status: 201 });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not add team member' },
      { status: 400 }
    );
  }
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const { id: clientId } = await ctx.params;
    const { searchParams } = new URL(req.url);
    const providerId = searchParams.get('providerId') || searchParams.get('id');

    if (!providerId) {
      return NextResponse.json(
        { success: false, error: 'Provider ID is required' },
        { status: 400 }
      );
    }

    const res = await removeTeamMember({ clientId, providerId });
    return NextResponse.json(res);
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not remove team member' },
      { status: 400 }
    );
  }
}
