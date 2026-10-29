import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { sendTelehealthLink } from '@/lib/telehealth/manage';
import { canAccessClientAppointments } from '@/lib/clients/orgScope';

export const runtime = 'nodejs';

const bodySchema = z.object({
  extraNotes: z.string().max(2000).optional().nullable(),
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
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await ctx.params;
  const body = bodySchema.parse(await req.json().catch(() => ({})));
  const result = await sendTelehealthLink({
    id,
    organizationId: gate.organizationId,
    actorRole: gate.role,
    extraNotes: body.extraNotes,
  });
  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json({
    success: true,
    session: result.session,
    link: result.link,
    sentTo: result.sentTo,
    emailMode: result.emailMode,
  });
}
