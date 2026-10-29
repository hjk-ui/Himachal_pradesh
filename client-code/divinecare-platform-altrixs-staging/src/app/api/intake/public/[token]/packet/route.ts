import { NextResponse } from 'next/server';
import { z } from 'zod';
import { intakeInviteContext } from '@/lib/intake/manage';
import { intakePacketPreview } from '@/lib/consents/library/store';
import { SERVICES_INTERESTED } from '@/lib/consents/library/composer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const paramsSchema = z.object({ token: z.string().min(8).max(128) });
const SERVICE_VALUES = SERVICES_INTERESTED.map((s) => s.value) as [string, ...string[]];

const bodySchema = z.object({
  dateOfBirth: z.string().trim().max(32).optional().nullable(),
  servicesInterested: z.array(z.enum(SERVICE_VALUES)).max(10).default([]),
  wantsTelehealth: z.boolean().optional().nullable(),
  insurancePayer: z.string().trim().max(120).optional().nullable(),
  emergencyContact: z.object({ name: z.string().trim().max(120), relationship: z.string().trim().max(80).optional().nullable(), phone: z.string().trim().max(40).optional().nullable() }).optional().nullable(),
});

/**
 * POST /api/intake/public/[token]/packet — the consent packet sections that apply to this new
 * client (the practice's Active templates + the composer rules), rendered with the practice name.
 * Template text only (no PHI is returned); the completion route re-composes on the server.
 */
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const p = paramsSchema.safeParse(await ctx.params);
  if (!p.success) return NextResponse.json({ success: false, error: 'Intake link not found' }, { status: 404 });
  const invite = await intakeInviteContext(p.data.token);
  if (!invite) return NextResponse.json({ success: false, error: 'This intake link is not open' }, { status: 404 });
  const body = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
  const b = body.data;
  try {
    const preview = await intakePacketPreview(invite.organizationId, {
      dateOfBirth: b.dateOfBirth ?? null,
      servicesInterested: b.servicesInterested,
      telehealth: invite.appointmentType === 'Telehealth' || Boolean(b.wantsTelehealth),
      insurancePayer: b.insurancePayer ?? null,
      emergencyContact: b.emergencyContact?.name ? { name: b.emergencyContact.name, relationship: b.emergencyContact.relationship ?? null, phone: b.emergencyContact.phone ?? null } : null,
    });
    return NextResponse.json({ success: true, ...preview }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    console.error('[intake/public packet]', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ success: false, error: 'Could not load the consent packet' }, { status: 500 });
  }
}
