import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { resolveChartAccess } from '@/lib/clients/chartAccess';
import { canSeeBhDiagnoses } from '@/lib/clients/chartSectionAccess';
import { diagnosisProblems } from '@/lib/drfirst/chartMapping';
import { suggestedOrderSets } from '@/lib/labs/orderSets';
import { labError, labGate } from '@/lib/labs/routeGate';

export const runtime = 'nodejs';

/**
 * GET /api/labs/order-context?clientId= — what the order form needs about one client: active
 * diagnoses to suggest (BH chart codes only for roles that may see them; problem list for all),
 * primary insurance (Medicare → ABN reminder), order sets that fit active medications, and lab
 * reports already filed to the chart (for result attachment). Same chart gate as the client chart
 * (org, caseload / care team, Part 2).
 */
export async function GET(req: Request) {
  const g = await labGate(req, 'view');
  if (g.denied) return g.denied;
  const { gate } = g;
  try {
    const clientId = new URL(req.url).searchParams.get('clientId')?.trim();
    if (!clientId) return NextResponse.json({ success: false, error: 'clientId is required' }, { status: 400 });
    const access = await resolveChartAccess({ organizationId: gate.organizationId, userId: gate.userId, role: gate.role }, clientId, `/api/labs/order-context`);
    if (access.ok === false) {
      await auditPhiAccess({ gate, req, action: 'READ', resourceType: 'labOrderContext', patientId: clientId, outcome: 'DENIED', metadata: { reason: access.reason } });
      return NextResponse.json({ success: false, error: access.reason === 'client_not_found' ? 'Client not found' : 'Not allowed to open this chart' }, { status: access.status });
    }
    const client = access.client;
    const bh = canSeeBhDiagnoses(gate.role);
    const [extra, problems, meds, docs] = await Promise.all([
      prisma.client.findUnique({ where: { id: client.id }, select: { insurancePayer: true, insuranceType: true } }),
      prisma.medicalProblem.findMany({
        where: { clientId: client.id, status: { in: ['active', 'Active', 'ACTIVE', 'chronic', 'Chronic'] } },
        select: { icd10Code: true, name: true },
        take: 50,
      }),
      prisma.clientMedication.findMany({
        where: { clientId: client.id, active: true },
        select: { medicationName: true, drugName: true, genericName: true, isAntipsychotic: true },
        take: 100,
      }),
      prisma.documentIntake.findMany({
        where: { suggestedClientId: client.id, status: 'filed' },
        select: { id: true, documentType: true, fileName: true, filedAt: true },
        orderBy: { filedAt: 'desc' },
        take: 50,
      }),
    ]);

    const dx = new Map<string, { code: string; description: string; source: string }>();
    if (bh) {
      for (const p of diagnosisProblems(client).problems) dx.set(p.code, { code: p.code, description: p.description, source: 'Chart diagnosis' });
    }
    for (const p of problems) {
      const code = p.icd10Code?.trim().toUpperCase();
      if (code && !dx.has(code)) dx.set(code, { code, description: p.name, source: 'Problem list' });
    }
    const payer = `${extra?.insuranceType ?? ''} ${extra?.insurancePayer ?? ''}`;
    const medNames = meds.map((m) => ({ name: [m.medicationName, m.drugName, m.genericName].filter(Boolean).join(' '), isAntipsychotic: m.isAntipsychotic }));

    await auditPhiAccess({
      gate, req, action: 'READ', resourceType: 'labOrderContext', resourceId: client.id, patientId: client.id,
      metadata: { diagnoses: dx.size, medications: meds.length, documents: docs.length },
    });
    return NextResponse.json(
      {
        success: true,
        client: { id: client.id, name: client.name, dateOfBirth: client.dateOfBirth ? client.dateOfBirth.toISOString().slice(0, 10) : null },
        diagnoses: [...dx.values()],
        insurance: { payer: extra?.insurancePayer ?? null, type: extra?.insuranceType ?? null, medicare: /medicare/i.test(payer) },
        suggestedOrderSets: suggestedOrderSets(medNames),
        documents: docs.map((d) => ({ id: d.id, type: d.documentType, name: d.fileName || d.documentType, filedAt: d.filedAt ? d.filedAt.toISOString() : null })),
      },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (err) {
    return labError(err, 'labs/order-context GET', 'Could not load the client for the lab order');
  }
}
