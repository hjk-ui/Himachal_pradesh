import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { lockedSensitiveClientIds } from '@/lib/privacy/sensitiveAccess';
import { canViewPrescriptions, isRefillStatus } from '@/lib/prescriptions/access';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canViewPrescriptions(gate.role)) {
    await auditPhiAccess({
      gate, req, action: 'LIST', resourceType: 'refillRequest',
      outcome: 'DENIED', metadata: { reason: 'role_not_permitted' },
    });
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const status = req.nextUrl.searchParams.get('status');
  if (status && status !== 'All' && !isRefillStatus(status)) {
    return NextResponse.json({ success: false, error: 'Invalid status' }, { status: 400 });
  }

  try {
    const allRefills = await prisma.ehrRefillRequest.findMany({
      where: {
        ...(status && status !== 'All' ? { status } : {}),
        // Org scope (and assigned-client scope for caseload roles) through the linked Client.
        client: clientAccessWhere({
          organizationId: gate.organizationId,
          actorUserId: gate.userId,
          actorRole: gate.role,
        }),
      },
      select: {
        id: true,
        prescriptionId: true,
        clientId: true,
        clientName: true,
        medicationName: true,
        pharmacyName: true,
        requestedRefills: true,
        requestDate: true,
        lastFilledDate: true,
        status: true,
        decisionReason: true,
        decidedByName: true,
        decidedAt: true,
      },
      orderBy: { requestDate: 'desc' },
    });
    // 42 CFR Part 2 / sensitive clients the caller may not open are dropped (same as the consents lists)
    const locked = await lockedSensitiveClientIds({
      organizationId: gate.organizationId,
      userId: gate.userId,
      role: gate.role,
      clientIds: allRefills.map((r) => r.clientId).filter(Boolean),
    });
    const refills = allRefills.filter((r) => !r.clientId || !locked.has(r.clientId));

    await auditPhiAccess({
      gate, req, action: 'LIST', resourceType: 'refillRequest',
      metadata: {
        count: refills.length,
        sensitiveHidden: allRefills.length - refills.length,
        status: status || null,
        clientIds: [...new Set(refills.map((r) => r.clientId).filter(Boolean))].slice(0, 50),
      },
    });

    return NextResponse.json({ success: true, data: refills });
  } catch (err: unknown) {
    console.error('[API /api/prescriptions/refills GET] error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch refill requests' },
      { status: 500 }
    );
  }
}
