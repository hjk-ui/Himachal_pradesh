import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { LABS_PATH, canAccessLabs } from '@/lib/labs/manage';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessLabs(gate.role) || !canAccessPath(gate.role, LABS_PATH)) {
    await auditPhiAccess({
      gate, req, action: 'LIST', resourceType: 'labOrder',
      outcome: 'DENIED', metadata: { reason: 'role_not_permitted' },
    });
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const orders = await prisma.labOrder.findMany({
      where: {
        organizationId: gate.organizationId,
        // Caseload roles only see their assigned clients' orders.
        client: clientAccessWhere({
          organizationId: gate.organizationId,
          actorUserId: gate.userId,
          actorRole: gate.role,
        }),
      },
      include: {
        client: { select: { id: true, name: true, mrn: true, dateOfBirth: true, gender: true } },
        results: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    await auditPhiAccess({
      gate, req, action: 'LIST', resourceType: 'labOrder',
      metadata: { count: orders.length, resultCount: orders.reduce((s, o) => s + o.results.length, 0) },
    });

    return NextResponse.json({
      success: true,
      orders: orders.map((o) => ({
        id: o.id,
        clientId: o.clientId,
        clientName: o.client.name,
        clientMrn: o.client.mrn,
        lab: o.lab,
        priority: o.priority,
        specimen: o.specimen,
        icd10Codes: o.icd10Codes,
        panels: o.panels,
        otherPanel: o.otherPanel,
        clinicalNotes: o.clinicalNotes,
        status: o.status,
        orderedByName: o.orderedByName,
        orderedAt: o.createdAt.toISOString(),
        collectedAt: o.collectedAt?.toISOString() || null,
        resultedAt: o.resultedAt?.toISOString() || null,
        results: o.results,
      })),
    });
  } catch (err: unknown) {
    console.error('[ehr/labs GET] error:', err);
    return NextResponse.json(
      { success: false, error: 'Could not fetch lab orders' },
      { status: 500 }
    );
  }
}
