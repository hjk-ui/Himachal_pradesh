import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canEditClientProfile } from '@/lib/clients/orgScope';
import { inviteGuardianForClient } from '@/lib/clients/guardianPortal';
import { recordPhiAudit } from '@/lib/audit/phiAudit';

const bodySchema = z.object({
  email: z.string().trim().email(),
  name: z.string().trim().min(1).max(200),
  relationship: z
    .enum(['parent', 'legal_guardian', 'authorized_representative'])
    .optional()
    .nullable(),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canEditClientProfile(gate.role) || gate.role === 'PEER_SUPPORT') {
    await recordPhiAudit({
      organizationId: gate.organizationId,
      actorUserId: gate.userId,
      actorRole: gate.role,
      action: 'guardian.grant',
      resourceType: 'patient',
      outcome: 'DENIED',
    });
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const { id } = await ctx.params;
  try {
    const body = bodySchema.parse(await req.json());
    const result = await inviteGuardianForClient({
      clientId: id,
      organizationId: gate.organizationId,
      email: body.email,
      name: body.name,
      relationship: body.relationship,
    });
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }
    await recordPhiAudit({
      organizationId: gate.organizationId,
      actorUserId: gate.userId,
      actorRole: gate.role,
      action: 'guardian.grant',
      resourceType: 'patient',
      resourceId: result.accountId,
      patientId: id,
      outcome: 'SUCCESS',
    });
    return NextResponse.json({
      success: true,
      message: 'Guardian portal invite sent for this client only.',
      accessTier: result.accessTier,
      relationship: result.relationship,
      part2HiddenFromProxy: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not grant guardian access';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
