import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { generateRequisitionHTML } from '@/services/labOrderService';

export const runtime = 'nodejs';

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const { id } = await ctx.params;
    const order = await prisma.labOrder.findFirst({
      where: {
        id,
        ...(gate.organizationId ? { organizationId: gate.organizationId } : {}),
      },
      include: {
        client: true,
      },
    });

    if (!order) {
      return NextResponse.json({ success: false, error: 'Lab order not found' }, { status: 404 });
    }

    const html = generateRequisitionHTML({
      id: order.id,
      clientName: order.clientName,
      clientId: order.clientId,
      clientDob: order.client?.dateOfBirth ? order.client.dateOfBirth.toISOString().split('T')[0] : '03/15/1984',
      clientGender: order.client?.gender || 'Female',
      lab: order.lab,
      priority: order.priority,
      specimen: order.specimen,
      panels: order.panels,
      otherPanel: order.otherPanel,
      icd10Codes: order.icd10Codes,
      clinicalNotes: order.clinicalNotes,
      orderedByName: order.orderedByName,
      orderedAt: order.orderedAt,
      signerNpi: order.signerNpi,
      facilityName: order.facilityName,
      facilityClia: order.facilityClia,
      signatureHash: order.signatureHash,
    });

    const url = new URL(req.url);
    if (url.searchParams.get('format') === 'raw') {
      return new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    return NextResponse.json({ success: true, html, order });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Error generating requisition' },
      { status: 500 }
    );
  }
}
