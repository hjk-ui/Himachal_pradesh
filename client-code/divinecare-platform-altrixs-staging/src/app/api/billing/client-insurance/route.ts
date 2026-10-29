import type { Role } from '@prisma/client';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canMutateClaims } from '@/lib/billing/claims';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { auditPhiAccess } from '@/lib/audit/requestMeta';

export const runtime = 'nodejs';

const querySchema = z.object({ clientId: z.string().min(1).max(128) });

/** Insurance on file for one client — used to pre-fill the New Claim form. */
export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canMutateClaims(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const parsed = querySchema.safeParse({ clientId: new URL(req.url).searchParams.get('clientId') });
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'clientId is required' }, { status: 400 });
  }

  try {
    const client = await prisma.client.findFirst({
      where: {
        AND: [
          { id: parsed.data.clientId },
          clientAccessWhere({
            organizationId: gate.organizationId,
            actorUserId: gate.userId,
            actorRole: gate.role as Role,
          }),
        ],
      },
      select: {
        insurancePayer: true,
        insuranceMemberId: true,
        insuranceGroupNumber: true,
        insuranceType: true,
        insuranceEffectiveFrom: true,
        insuranceEffectiveTo: true,
      },
    });
    if (!client) {
      await auditPhiAccess({
        gate, req, action: 'READ', resourceType: 'clientInsurance', resourceId: parsed.data.clientId,
        patientId: parsed.data.clientId, outcome: 'DENIED', metadata: { reason: 'client_not_found' },
      });
      return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });
    }
    await auditPhiAccess({
      gate, req, action: 'READ', resourceType: 'clientInsurance', resourceId: parsed.data.clientId,
      patientId: parsed.data.clientId,
    });
    return NextResponse.json({
      success: true,
      insurance: {
        payer: client.insurancePayer,
        memberId: client.insuranceMemberId,
        groupNumber: client.insuranceGroupNumber,
        insuranceType: client.insuranceType,
        effectiveFrom: client.insuranceEffectiveFrom?.toISOString().slice(0, 10) ?? null,
        effectiveTo: client.insuranceEffectiveTo?.toISOString().slice(0, 10) ?? null,
      },
    });
  } catch (err: unknown) {
    console.error('[billing client-insurance GET]', err instanceof Error ? err.message : 'unknown error');
    return NextResponse.json({ success: false, error: 'Could not load insurance' }, { status: 500 });
  }
}
