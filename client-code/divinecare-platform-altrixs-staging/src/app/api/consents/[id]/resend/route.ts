import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessConsents, resendConsent } from '@/lib/consents/manage';
import { auditPhiAccess } from '@/lib/audit/requestMeta';

export const runtime = 'nodejs';

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessConsents(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { id } = await ctx.params;
    const result = await resendConsent(gate.organizationId, id);
    await auditPhiAccess({ gate, req, action: 'NOTIFY', resourceType: 'consent', resourceId: id, patientId: 'clientId' in result ? result.clientId ?? null : null, outcome: 'DENIED', metadata: { legacy: true, status: result.status } });
    return NextResponse.json({ success: false, error: result.error }, { status: result.status });
  } catch (err) {
    console.error('[consents resend]', err);
    return NextResponse.json(
      { success: false, error: 'Could not resend consent' },
      { status: 500 }
    );
  }
}
