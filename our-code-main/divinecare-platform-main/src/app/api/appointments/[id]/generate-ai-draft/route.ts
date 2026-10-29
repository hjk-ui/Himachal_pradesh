import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { generateAiDraft } from '@/lib/appointments/manage';
import { canAccessClientAppointments } from '@/lib/clients/orgScope';

export const runtime = 'nodejs';

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  if (!canAccessClientAppointments(gate.role)) {
    return NextResponse.json(
      { success: false, error: 'Not allowed to update appointments' },
      { status: 403 }
    );
  }

  try {
    const { id } = await ctx.params;
    const result = await generateAiDraft(id, {
      id: gate.userId,
      role: gate.role,
      organizationId: gate.organizationId,
    });
    if (result.ok === false) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }
    return NextResponse.json({ success: true, appointment: result.appointment });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Could not generate AI draft';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
