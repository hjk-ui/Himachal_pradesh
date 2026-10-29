import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { ANTIPSYCHOTIC_DRUGS, isAntipsychotic } from '../safety-check/route';
import { resolveDrugCode } from '@/lib/prescribing/drugCodes';
import { recordPhiAudit } from '@/lib/audit/phiAudit';

export const runtime = 'nodejs';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const { id: clientId } = await ctx.params;

    // Fetch active medications
    const medications = await prisma.clientMedication.findMany({
      where: { clientId, active: true },
      orderBy: { createdAt: 'desc' },
    });

    const activeAntipsychotics = medications.filter(
      (m) => m.isAntipsychotic || isAntipsychotic(m.medicationName)
    );
    const count = activeAntipsychotics.length;
    const hasQtcFlag = count >= 2;

    return NextResponse.json({
      success: true,
      clientId,
      medications,
      hasQtcFlag,
      needsEkg: hasQtcFlag,
      activeAntipsychoticsCount: count,
      antipsychotics: activeAntipsychotics.map((m) => ({
        id: m.id,
        name: m.medicationName,
        dosage: m.dosage,
      })),
      protocol: 'Antipsychotic QTc Prolongation Safety Protocol (Baseline EKG Required for >= 2 Antipsychotics)',
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not fetch medications' },
      { status: 500 }
    );
  }
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const { id: clientId } = await ctx.params;
    const body = await req.json();

    const medicationName = body.medicationName || body.name;
    const drugCode = resolveDrugCode(medicationName, body.rxnormId || body.ndcCode);
    if (!medicationName || !drugCode) {
      return NextResponse.json(
        { success: false, error: 'A medication name and a standard drug code are required' },
        { status: 400 }
      );
    }

    const isAnti = isAntipsychotic(medicationName) || Boolean(body.isAntipsychotic);

    const medication = await prisma.clientMedication.create({
      data: {
        clientId,
        medicationName,
        dosage: body.dosage || 'Standard dose',
        route: body.route || 'Oral',
        frequency: body.frequency || 'Daily',
        instructions: body.instructions || null,
        indication: body.indication || null,
        rxnormId: drugCode,
        ndcCode: body.ndcCode || null,
        active: true,
        isAntipsychotic: isAnti,
        prescribedById: gate.userId || null,
      },
    });

    // Check if new count triggers QTc flag
    const allActive = await prisma.clientMedication.findMany({
      where: { clientId, active: true },
    });
    const antiCount = allActive.filter((m) => m.isAntipsychotic || isAntipsychotic(m.medicationName)).length;
    const hasQtcFlag = antiCount >= 2;

    await recordPhiAudit({
      organizationId: gate.organizationId,
      actorUserId: gate.userId,
      actorRole: gate.role || '',
      action: 'medication.write',
      resourceType: 'ClientMedication',
      resourceId: medication.id,
      patientId: clientId,
      outcome: 'SUCCESS',
    });

    return NextResponse.json({
      success: true,
      medication,
      hasQtcFlag,
      activeAntipsychoticsCount: antiCount,
    }, { status: 201 });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not save medication' },
      { status: 500 }
    );
  }
}
