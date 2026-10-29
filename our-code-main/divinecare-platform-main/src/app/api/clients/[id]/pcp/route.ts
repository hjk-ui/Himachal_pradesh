import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canEditClientProfile } from '@/lib/clients/orgScope';
import { setClientPcp } from '@/lib/clients/pcp';
import { recordPhiAudit } from '@/lib/audit/phiAudit';

export const runtime = 'nodejs';

const paramsSchema = z.object({ id: z.string().min(1).max(128) });

/** `via` records where the PCP was confirmed from — the chart's care-team card. */
const bodySchema = z.object({
  providerId: z.string().trim().min(1).max(128),
  via: z.literal('chart'),
});

/** PUT — "Set as PCP": make a provider the client's primary care provider (replaces any current PCP). */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  const params = paramsSchema.safeParse(await ctx.params);
  if (!params.success) {
    return NextResponse.json({ success: false, error: 'Invalid client id' }, { status: 400 });
  }
  const clientId = params.data.id;

  if (!canEditClientProfile(gate.role)) {
    await recordPhiAudit({
      organizationId: gate.organizationId,
      actorUserId: gate.userId,
      actorRole: gate.role,
      action: 'careTeam.pcp.set',
      resourceType: 'patient',
      patientId: clientId,
      outcome: 'DENIED',
    });
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json(
      { success: false, error: "Expected { providerId, via: 'chart' }" },
      { status: 400 }
    );
  }

  try {
    const result = await setClientPcp({
      clientId,
      providerId: body.providerId,
      actor: { id: gate.userId, role: gate.role, organizationId: gate.organizationId },
    });
    if (result.ok === false) {
      await recordPhiAudit({
        organizationId: gate.organizationId,
        actorUserId: gate.userId,
        actorRole: gate.role,
        action: 'careTeam.pcp.set',
        resourceType: 'patient',
        resourceId: body.providerId,
        patientId: clientId,
        outcome: 'FAILURE',
      });
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }

    await recordPhiAudit({
      organizationId: gate.organizationId,
      actorUserId: gate.userId,
      actorRole: gate.role,
      action: 'careTeam.pcp.set',
      resourceType: 'patient',
      resourceId: body.providerId,
      patientId: clientId,
      outcome: 'SUCCESS',
    });
    return NextResponse.json({ success: true, member: result.member, replaced: result.replaced });
  } catch (err) {
    console.error('[pcp PUT]', err);
    return NextResponse.json({ success: false, error: 'Could not set PCP' }, { status: 500 });
  }
}
