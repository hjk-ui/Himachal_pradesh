import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireClinicalContext } from '@/lib/clinical/access';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { measureDisplay, recordableAsMeasure, validateMeasureValue } from '@/lib/clinical/measures';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ASSESSMENTS_PATH = '/dashboard/ehr/assessments';

const postSchema = z.object({
  clientId: z.string().min(1),
  measurementTypeId: z.string().min(1),
  value: z.string().trim().min(1).max(100),
  /** ISO date or date-time; defaults to now. Not in the future. */
  measuredAt: z.string().max(40).optional(),
  notes: z.string().trim().max(2000).optional(),
  clinicianVerified: z.literal(true),
});

/**
 * GET /api/clinical/measures?clientId= — the measure picker (active catalog types that are not the
 * total of a built-in Altrixs instrument) and this client's recorded measures, newest first.
 * POST — record one value (validated by the type's data type). Same access as Assessments.
 */
export async function GET(req: Request) {
  const clientId = new URL(req.url).searchParams.get('clientId');
  // One-client read: Part 2 / VIP lock (403 + break-glass) via requireClinicalContext
  const gate = await requireClinicalContext(ASSESSMENTS_PATH, { clientId });
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!clientId) return NextResponse.json({ success: false, error: 'clientId is required' }, { status: 400 });
  try {
    const client = await prisma.client.findFirst({ where: { id: clientId, AND: [gate.clientWhere] }, select: { id: true } });
    if (!client) return NextResponse.json({ success: false, error: 'Patient not found' }, { status: 404 });
    const [types, results] = await Promise.all([
      prisma.measurementType.findMany({
        where: { organizationId: gate.organizationId, active: true },
        orderBy: [{ parentInstrument: 'asc' }, { isSubscore: 'asc' }, { name: 'asc' }],
      }),
      prisma.measurementResult.findMany({
        where: { organizationId: gate.organizationId, clientId: client.id },
        include: { measurementType: { select: { name: true, dataType: true, parentInstrument: true } } },
        orderBy: { measuredAt: 'desc' },
        take: 200,
      }),
    ]);
    await auditPhiAccess({
      gate, req, action: 'LIST', resourceType: 'measurementResult', patientId: client.id,
      metadata: { count: results.length, clientId: client.id },
    });
    return NextResponse.json({
      success: true,
      types: types.filter(recordableAsMeasure).map((t) => ({
        id: t.id,
        name: t.name,
        dataType: t.dataType,
        defaultUnits: t.defaultUnits || null,
        parentInstrument: t.parentInstrument,
        isSubscore: t.isSubscore,
        vitalField: t.vitalField,
        documentationCode: t.documentationCode || null,
        category: t.category,
      })),
      results: results.map((r) => ({
        id: r.id,
        measurementTypeId: r.measurementTypeId,
        name: r.measurementType.name,
        parentInstrument: r.measurementType.parentInstrument,
        dataType: r.measurementType.dataType,
        value: measureDisplay(r, r.measurementType.dataType),
        units: r.units,
        measuredAt: r.measuredAt.toISOString(),
        source: r.source,
        notes: r.notes,
      })),
    });
  } catch (err) {
    console.error('[clinical/measures GET]', err);
    return NextResponse.json({ success: false, error: 'Could not load measures' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const gate = await requireClinicalContext(ASSESSMENTS_PATH);
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  try {
    const body = postSchema.parse(await req.json());
    const client = await prisma.client.findFirst({ where: { id: body.clientId, AND: [gate.clientWhere] }, select: { id: true } });
    if (!client) {
      await auditPhiAccess({
        gate, req, action: 'CREATE', resourceType: 'measurementResult', patientId: body.clientId,
        outcome: 'DENIED', metadata: { reason: 'patient_not_found' },
      });
      return NextResponse.json({ success: false, error: 'Patient not found' }, { status: 404 });
    }
    const type = await prisma.measurementType.findFirst({ where: { id: body.measurementTypeId, organizationId: gate.organizationId } });
    if (!type || !recordableAsMeasure(type)) {
      return NextResponse.json({ success: false, error: 'Choose an active measurement type from the list' }, { status: 400 });
    }
    const v = validateMeasureValue(type, body.value);
    if ('error' in v) return NextResponse.json({ success: false, error: v.error }, { status: 400 });

    const measuredAt = body.measuredAt ? new Date(body.measuredAt) : new Date();
    if (Number.isNaN(measuredAt.getTime())) return NextResponse.json({ success: false, error: 'Invalid date' }, { status: 400 });
    if (measuredAt.getTime() > Date.now() + 5 * 60 * 1000) return NextResponse.json({ success: false, error: 'The date cannot be in the future' }, { status: 400 });

    const row = await prisma.measurementResult.create({
      data: {
        organizationId: gate.organizationId,
        clientId: client.id,
        measurementTypeId: type.id,
        valueNumeric: v.valueNumeric,
        valueSecondary: v.valueSecondary,
        valueText: v.valueText,
        units: type.defaultUnits || null,
        measuredAt,
        source: 'manual',
        notes: body.notes || null,
        recordedById: gate.userId,
      },
    });
    await auditPhiAccess({
      gate, req, action: 'CREATE', resourceType: 'measurementResult', resourceId: row.id, patientId: client.id,
      metadata: { measurementTypeId: type.id, dataType: type.dataType },
    });
    return NextResponse.json({ success: true, data: { id: row.id, value: v.display } }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: 'Clinician verification and a value are required' }, { status: 400 });
    }
    console.error('[clinical/measures POST]', err);
    return NextResponse.json({ success: false, error: 'Could not save the measure' }, { status: 500 });
  }
}
