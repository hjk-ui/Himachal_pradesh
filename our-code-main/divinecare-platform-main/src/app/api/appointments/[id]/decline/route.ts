import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { declinePatientAppointment } from '@/lib/appointments/manage';
import { canAccessClientAppointments } from '@/lib/clients/orgScope';

export const runtime = 'nodejs';

const declineSchema = z.object({
  reason: z.string().max(1000).optional().nullable(),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  if (!canAccessClientAppointments(gate.role)) {
    return NextResponse.json(
      { success: false, error: 'Not allowed to decline appointments' },
      { status: 403 }
    );
  }

  try {
    const { id } = await ctx.params;
    let reason = 'Declined by clinician';
    try {
      const body = await req.json();
      const parsed = declineSchema.parse(body);
      if (parsed.reason?.trim()) {
        reason = parsed.reason.trim();
      }
    } catch {
      // Empty body is permissible, fallback to default reason
    }

    const result = await declinePatientAppointment(id, reason, {
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
    const message = err instanceof Error ? err.message : 'Could not decline appointment';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
