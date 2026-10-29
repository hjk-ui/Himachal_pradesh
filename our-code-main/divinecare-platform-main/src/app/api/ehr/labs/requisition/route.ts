import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import crypto from 'crypto';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const body = await req.json();

    if (!body.clientId) {
      return NextResponse.json({ success: false, error: 'clientId is required' }, { status: 400 });
    }

    const providerName = body.orderedByName || 'Dr. James Park, MD';
    const signDate = new Date();
    const signatureHash = crypto
      .createHash('sha256')
      .update(`${body.clientId}-${providerName}-${signDate.toISOString()}`)
      .digest('hex')
      .slice(0, 16);

    const order = await prisma.labOrder.create({
      data: {
        organizationId: gate.organizationId,
        clientId: body.clientId,
        lab: body.lab === 'LABCORP' ? 'LABCORP' : 'QUEST',
        priority: body.priority || 'Routine',
        specimen: body.specimen || 'Blood (Venipuncture)',
        icd10Codes: Array.isArray(body.icd10Codes) ? body.icd10Codes : ['Z00.00'],
        panels: Array.isArray(body.panels) && body.panels.length > 0 ? body.panels : ['80053'],
        otherPanel: body.otherPanel || null,
        clientName: body.clientName || 'Patient',
        clinicalNotes: body.clinicalNotes || (body.isEkg ? 'Antipsychotic QTc Prolongation Safety Protocol — Baseline EKG' : null),
        orderedByName: providerName,
        status: 'ordered',
        // e-signature representation (Commit 819d6b2)
        isElectronicallySigned: true,
        signedAt: signDate,
        signerName: providerName,
        signatureHash: `ESIG-${signatureHash}`,
      },
      include: {
        client: { select: { id: true, name: true, mrn: true, dateOfBirth: true } },
      },
    });

    return NextResponse.json({
      success: true,
      order,
      esignature: {
        signedByName: providerName,
        signedAt: signDate.toISOString(),
        hash: signatureHash,
        verifiedBadge: '✓ E-Signed / No wet signature required',
      },
    }, { status: 201 });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not create lab requisition' },
      { status: 500 }
    );
  }
}
