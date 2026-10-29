import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireClinicalContext } from '@/lib/clinical/access';
import { LOCUS_DIMENSIONS, calculateLocusLevelOfCare } from '@/features/ehr/locus/locusCatalog';

export async function GET(request: Request) {
  try {
    const gate = await requireClinicalContext('/dashboard/ehr/locus');
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: gate.status });
    }

    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get('clientId');

    const rawRecords = await prisma.locusAssessmentRecord.findMany({
      where: {
        organizationId: gate.organizationId,
        client: gate.clientWhere,
        ...(clientId ? { clientId } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });

    const records = rawRecords.map((r) => ({
      id: r.id,
      clientId: r.clientId,
      assessmentType: r.instrumentType,
      dimensionScores: r.formDataJson ? JSON.parse(r.formDataJson) : {},
      compositeScore: r.compositeScore,
      recommendedLevel: r.recommendedLevel,
      recommendedLevelName: calculateLocusLevelOfCare(r.compositeScore).name,
      overrideLevel: r.overrideLevel,
      overrideRationale: r.overrideRationale,
      assessedBy: 'Clinician',
      createdAt: r.createdAt,
    }));

    return NextResponse.json({ success: true, data: records });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const gate = await requireClinicalContext('/dashboard/ehr/locus');
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: gate.status });
    }

    const body = await request.json();
    const {
      clientId,
      assessmentType = 'LOCUS',
      scores = {},
      overrideLevel,
      overrideRationale,
    } = body;

    if (!clientId) {
      return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
    }

    if (!['LOCUS', 'CALOCUS'].includes(assessmentType) || Object.keys(scores).length !== LOCUS_DIMENSIONS.length || !LOCUS_DIMENSIONS.every(d => Number.isInteger(scores[d.id]) && scores[d.id] >= 1 && scores[d.id] <= 5)) return NextResponse.json({ error: 'Provide all seven dimension ratings between 1 and 5' }, { status: 400 });
    if (overrideLevel && (!/^Level [1-6]$/.test(overrideLevel) || !overrideRationale?.trim())) return NextResponse.json({ error: 'A valid override and rationale are required' }, { status: 400 });
    const patient = await prisma.client.findFirst({ where: { id: clientId, AND: [gate.clientWhere] }, select: { id: true } });
    if (!patient) return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
    // Calculate composite score
    const dimensionScores = Object.values(scores) as number[];
    const compositeScore = dimensionScores.reduce((sum, val) => sum + (Number(val) || 1), 0);
    const calculated = calculateLocusLevelOfCare(compositeScore);

    const record = await prisma.locusAssessmentRecord.create({
      data: {
        organizationId: gate.organizationId,
        clientId,
        instrumentType: assessmentType,
        assessmentDate: new Date(),
        clinicianId: gate.userId,
        compositeScore,
        recommendedLevel: calculated.level,
        overrideLevel: overrideLevel || null,
        overrideRationale: overrideRationale || null,
        formDataJson: JSON.stringify(scores),
      },
    });

    return NextResponse.json({ success: true, data: record });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
