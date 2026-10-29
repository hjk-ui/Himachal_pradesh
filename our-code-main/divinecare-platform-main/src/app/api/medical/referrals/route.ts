import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { listReferrals, createReferral, warmHandoffIndicated } from '@/lib/medical/referrals';

export const runtime = 'nodejs';

const ROLES = new Set([
  'PHYSICIAN',
  'MEDICAL_NP',
  'MEDICAL_ASSISTANT',
  'ADMIN',
  'DIRECTOR',
  'PRACTICE_DIRECTOR',
]);

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/medical') || !ROLES.has(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const clientId = new URL(req.url).searchParams.get('clientId') || undefined;
  const referrals = await listReferrals(gate.organizationId, clientId);
  return NextResponse.json({
    success: true,
    referrals,
    defaults: { expectedReportDays: 30 },
    warmHandoffRule: 'PHQ-9 or GAD-7 ≥10',
  });
}

const postSchema = z.object({
  clientId: z.string().min(1),
  clientName: z.string().min(1).max(200),
  specialty: z.string().min(1).max(200),
  reason: z.string().min(1).max(2000),
  internalBhWarmHandoff: z.boolean().optional(),
  phq9: z.number().nullable().optional(),
  gad7: z.number().nullable().optional(),
});

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/medical') || !ROLES.has(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Invalid referral' }, { status: 400 });
  }

  const autoWarm =
    parsed.data.internalBhWarmHandoff === true ||
    warmHandoffIndicated(parsed.data.phq9 ?? null, parsed.data.gad7 ?? null);

  const referral = await createReferral(gate.organizationId, {
    clientId: parsed.data.clientId,
    clientName: parsed.data.clientName,
    specialty: autoWarm ? parsed.data.specialty || 'Behavioral health (warm handoff)' : parsed.data.specialty,
    reason: parsed.data.reason,
    internalBhWarmHandoff: autoWarm,
    actorUserId: gate.userId,
  });

  return NextResponse.json({ success: true, referral }, { status: 201 });
}
