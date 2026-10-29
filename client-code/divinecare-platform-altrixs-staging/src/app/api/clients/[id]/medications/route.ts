import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canViewClientMedications, canWriteClientMedications } from '@/lib/clients/orgScope';
import { gateClientRoute } from '@/lib/clients/clientRouteGate';
import { ANTIPSYCHOTIC_DRUGS, isAntipsychotic } from '../safety-check/route';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { optionalDrugCode, rxcuiSchema } from '@/lib/drugs/resolve';
import { medicationCodeFields } from '@/lib/drugs/types';

export const runtime = 'nodejs';

/** Role rule + chart rule (org, Part 2, caseload / care team); 404 when not in the org so ids can't be probed */
function clientGate(gate: { organizationId: string; userId: string; role: string }, clientId: string, write: boolean) {
  return gateClientRoute({
    organizationId: gate.organizationId,
    userId: gate.userId,
    role: gate.role,
    clientId,
    path: `/api/clients/${clientId}/medications`,
    roleAllowed: write ? canWriteClientMedications(gate.role) : canViewClientMedications(gate.role),
  });
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const { id: clientId } = await ctx.params;
    const access = await clientGate(gate, clientId, false);
    if (access.ok === false) {
      await auditPhiAccess({ gate, req, action: 'LIST', resourceType: 'clientMedication', resourceId: clientId, patientId: clientId, outcome: 'DENIED', metadata: { reason: access.reason } });
      return NextResponse.json({ success: false, error: access.error }, { status: access.status });
    }

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

    await auditPhiAccess({ gate, req, action: 'LIST', resourceType: 'clientMedication', resourceId: clientId, patientId: clientId, metadata: { count: medications.length, activeOnly: true } });

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
      { success: false, error: 'Could not fetch medications' },
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
    // Leadership, licensed BH clinicians and the primary care team only (not peer / front desk / billing)
    const access = await clientGate(gate, clientId, true);
    if (access.ok === false) {
      await auditPhiAccess({ gate, req, action: 'CREATE', resourceType: 'clientMedication', resourceId: clientId, patientId: clientId, outcome: 'DENIED', metadata: { reason: access.reason } });
      return NextResponse.json({ success: false, error: access.status === 403 ? 'Your role cannot add medications for this client' : access.error }, { status: access.status });
    }
    const body = await req.json();

    const medicationName = body.medicationName || body.name;
    if (!medicationName) {
      return NextResponse.json(
        { success: false, error: 'Medication name is required' },
        { status: 400 }
      );
    }
    if (!String(body.dosage || '').trim()) {
      return NextResponse.json({ success: false, error: 'Dosage is required' }, { status: 400 });
    }

    const isAnti = isAntipsychotic(medicationName) || Boolean(body.isAntipsychotic);
    // Optional RxCUI from the drug typeahead (MUM2-MUM4); resolved here, never trusted from the browser
    const rxcui = body.rxcui == null || body.rxcui === '' ? null : rxcuiSchema.safeParse(String(body.rxcui));
    if (rxcui && !rxcui.success) return NextResponse.json({ success: false, error: 'Invalid RxNorm code' }, { status: 400 });
    const drug = await optionalDrugCode(rxcui ? rxcui.data : null, 'medication');
    if (drug.invalid) return NextResponse.json({ success: false, error: drug.invalid }, { status: 400 });

    const medication = await prisma.clientMedication.create({
      data: {
        clientId,
        medicationName,
        // Record only what was entered; never default a dose, route or frequency
        dosage: String(body.dosage).trim(),
        route: body.route || null,
        frequency: body.frequency || null,
        instructions: body.instructions || null,
        indication: body.indication || null,
        active: true,
        isAntipsychotic: isAnti,
        prescribedById: gate.userId || null,
        ...(drug.code ? medicationCodeFields(drug.code) : {}),
      },
    });

    // Check if new count triggers QTc flag
    const allActive = await prisma.clientMedication.findMany({
      where: { clientId, active: true },
    });
    const antiCount = allActive.filter((m) => m.isAntipsychotic || isAntipsychotic(m.medicationName)).length;
    const hasQtcFlag = antiCount >= 2;

    await auditPhiAccess({
      gate,
      req,
      action: 'CREATE',
      resourceType: 'clientMedication',
      resourceId: medication.id,
      patientId: clientId,
      metadata: {
        fields: ['medicationName', 'dosage', 'route', 'frequency', 'instructions', 'indication'].filter((k) => k === 'medicationName' || k === 'dosage' || body[k]),
        isAntipsychotic: isAnti,
        qtcFlag: hasQtcFlag,
        coded: Boolean(drug.code),
      },
    });

    return NextResponse.json({
      success: true,
      medication,
      hasQtcFlag,
      activeAntipsychoticsCount: antiCount,
      ...(drug.warning ? { warning: drug.warning } : {}),
    }, { status: 201 });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: 'Could not save medication' },
      { status: 500 }
    );
  }
}
