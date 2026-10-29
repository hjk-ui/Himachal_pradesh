import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessConsents, signConsent } from '@/lib/consents/manage';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { prisma } from '@/lib/db/prisma';
import { chartGate } from '../../library/_gate';

export const runtime = 'nodejs';

const paramsSchema = z.object({ id: z.string().min(1).max(128) });
const bodySchema = z.object({
  signedByName: z.string().trim().max(120).optional().nullable(),
});

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
    const { id } = paramsSchema.parse(await ctx.params);
    const body = bodySchema.parse(await req.json().catch(() => ({})));
    // Look up the consent's client first, then the chart gate (org, caseload, Part 2 / sensitive lock):
    // a signed consent is returned only to someone who may open that client's chart
    const owner = await prisma.consentForm.findFirst({ where: { id, organizationId: gate.organizationId }, select: { clientId: true } });
    if (!owner) return NextResponse.json({ success: false, error: 'Consent not found' }, { status: 404 });
    const denied = await chartGate(gate, req, owner.clientId, `/api/consents/${id}/sign`, 'consent');
    if (denied) return denied;
    const result = await signConsent(gate.organizationId, id, body);
    await auditPhiAccess({
      gate,
      req,
      action: 'SIGN',
      resourceType: 'consent',
      resourceId: id,
      patientId: result.ok ? result.consent.clientId : 'clientId' in result ? result.clientId ?? null : null,
      outcome: result.ok ? undefined : 'DENIED',
      metadata: { legacy: true, ...(result.ok ? {} : { status: result.status }) },
    });
    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }
    return NextResponse.json({ success: true, consent: result.consent });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Could not sign consent' },
      { status: 400 }
    );
  }
}
