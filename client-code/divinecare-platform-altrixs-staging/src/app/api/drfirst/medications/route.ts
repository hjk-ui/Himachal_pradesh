import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canViewClientMedications, clientOrgFilter } from '@/lib/clients/orgScope';
import { gateClientRoute } from '@/lib/clients/clientRouteGate';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { auditRequestMeta } from '@/lib/audit/requestMeta';
import { sendMedication, type RcopiaSendMedication } from '@/lib/services/drfirstCommands';
import { requireDrFirstCaller } from '../_lib/access';

export const dynamic = 'force-dynamic';

/**
 * GET /api/drfirst/medications?clientId= — the chart medication list plus Rcopia
 * prescriptions for one client of the caller's organization (clinical staff).
 */
export async function GET(req: NextRequest) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const clientId = req.nextUrl.searchParams.get('clientId');
  if (!clientId) return NextResponse.json({ error: 'clientId query parameter required' }, { status: 400 });

  // Medication-list readers only (not peer / case manager / front desk / billing), on their
  // caseload or care team; org + Part 2 through the chart rule
  const access = await gateClientRoute({
    organizationId: gate.organizationId,
    userId: gate.userId,
    role: String(gate.role),
    clientId,
    path: '/api/drfirst/medications',
    roleAllowed: canViewClientMedications(String(gate.role)),
  });
  if (access.ok === false) {
    await writeAuditLog({
      action: 'READ',
      actorUserId: gate.userId,
      actorRole: String(gate.role),
      organizationId: gate.organizationId,
      resourceType: 'medication_list',
      resourceId: clientId,
      patientId: clientId,
      outcome: 'DENIED',
      ...auditRequestMeta(req),
      metadata: { reason: access.reason },
    });
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  const client = { id: clientId };

  try {
    const [medications, rcopiaPrescriptions] = await Promise.all([
      prisma.clientMedication.findMany({ where: { clientId: client.id }, orderBy: { createdAt: 'desc' } }),
      prisma.rcopiaPrescription.findMany({
        where: { clientId: client.id },
        orderBy: { createdDate: 'desc' },
        select: {
          id: true, rcopiaId: true, drugName: true, schedule: true, sig: true, quantity: true, refills: true,
          pharmacyName: true, lifecycleStatus: true, createdDate: true, signedDate: true,
        },
      }),
    ]);

    await writeAuditLog({
      action: 'READ',
      actorUserId: gate.userId,
      actorRole: String(gate.role),
      organizationId: gate.organizationId,
      resourceType: 'medication_list',
      resourceId: client.id,
      patientId: client.id,
      ...auditRequestMeta(req),
      metadata: { medications: medications.length, rcopiaPrescriptions: rcopiaPrescriptions.length },
    });

    return NextResponse.json({
      success: true,
      data: medications,
      rcopiaPrescriptions,
      count: medications.length + rcopiaPrescriptions.length,
    });
  } catch (err: unknown) {
    console.error('[drfirst-meds] error:', err instanceof Error ? err.name : 'unknown');
    return NextResponse.json({ error: 'Failed to fetch medications' }, { status: 500 });
  }
}

const medicationSchema = z.object({
  clientId: z.string().min(1),
  medication: z.object({
    externalId: z.string().optional(),
    brandName: z.string().optional(),
    genericName: z.string().optional(),
    ndcId: z.string().optional(),
    rxnormId: z.string().optional(),
    form: z.string().optional(),
    strength: z.string().optional(),
    schedule: z.enum(['2', '3', '4', '5', 'scheduled', 'nonscheduled', 'unknown']).optional(),
    action: z.string().optional(),
    dose: z.string().optional(),
    doseUnit: z.string().optional(),
    route: z.string().optional(),
    doseTiming: z.string().optional(),
    asNeeded: z.boolean().optional(),
    doseOther: z.string().optional(),
    patientNotes: z.string().optional(),
    quantity: z.string().optional(),
    quantityUnit: z.string().optional(),
    refills: z.string().optional(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    stopDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    stopReason: z.string().optional(),
    historySource: z.string().optional(),
  }).refine(m => Boolean(m.brandName || m.genericName), { message: 'brandName or genericName is required' }),
});

/**
 * POST /api/drfirst/medications — send_medication for one client of the
 * caller's org, signed as the caller's own Rcopia username (prescribers only).
 * Only the fields the prescriber entered are sent; nothing is defaulted.
 * The medication lands in the chart when /api/drfirst/sync downloads it back
 * with its Rcopia id.
 */
export async function POST(req: NextRequest) {
  const g = await requireDrFirstCaller(req, { requireRcopiaUser: true });
  if (g.response) return g.response;
  const c = g.caller;

  const parsed = medicationSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 });
  }
  const { clientId, medication } = parsed.data;

  const client = await prisma.client.findFirst({
    where: { id: clientId, ...clientOrgFilter(c.organizationId) },
    select: { id: true, rcopiaPatientId: true },
  });
  if (!client) return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
  if (!client.rcopiaPatientId) {
    return NextResponse.json({ error: 'This patient is not registered in DrFirst yet.' }, { status: 409 });
  }

  const patient = client.rcopiaPatientId !== client.id ? { rcopiaId: client.rcopiaPatientId } : { externalId: client.id };
  const med: RcopiaSendMedication = { ...medication, providerUsername: c.rcopiaUsername! };

  try {
    const result = await sendMedication(patient, med, c.rcopiaUsername!);
    await writeAuditLog({
      action: 'DRFIRST_SEND_MEDICATION',
      actorUserId: c.userId,
      actorRole: c.role,
      organizationId: c.organizationId,
      resourceType: 'medication',
      resourceId: client.id,
      patientId: client.id,
      outcome: result.ok ? 'SUCCESS' : 'FAILURE',
      ipAddress: c.ipAddress,
      userAgent: c.userAgent,
      metadata: { demo: result.demo, errorCode: result.error?.code ?? null, coded: Boolean(medication.ndcId || medication.rxnormId) },
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error?.text || 'DrFirst did not accept the medication', code: result.error?.code }, { status: 502 });
    }
    return NextResponse.json({ success: true, demo: result.demo }, { status: 201 });
  } catch (err: unknown) {
    console.error('[drfirst-meds POST] error:', err instanceof Error ? err.name : 'unknown');
    return NextResponse.json({ error: 'Failed to send medication' }, { status: 500 });
  }
}
