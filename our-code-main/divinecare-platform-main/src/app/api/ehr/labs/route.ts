import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';

export const runtime = 'nodejs';

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const orders = await prisma.labOrder.findMany({
      where: { organizationId: gate.organizationId },
      include: {
        client: { select: { id: true, name: true, mrn: true, dateOfBirth: true, gender: true } },
        results: true,
      },
      orderBy: { createdAt: 'desc' },
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
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not fetch lab orders' },
      { status: 500 }
    );
  }
}
