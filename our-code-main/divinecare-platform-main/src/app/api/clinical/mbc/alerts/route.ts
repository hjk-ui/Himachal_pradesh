import { isMbcAlert } from '@/features/ehr/assessments/thresholds';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireClinicalContext } from '@/lib/clinical/access';

export async function GET(request: Request) {
  try {
    const gate = await requireClinicalContext('/dashboard/mbc');
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: gate.status });
    }

    // Fetch clinical assessment records that are safety flagged or severe
    const flaggedRecords = await prisma.clinicalAssessmentRecord.findMany({
      where: {
        organizationId: gate.organizationId,
        client: gate.clientWhere,
      },
      include: {
        client: {
          select: { id: true, name: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Fetch existing alert acknowledgments
    const acknowledgments = await prisma.mbcAlertAck.findMany({
      where: {
        organizationId: gate.organizationId,
      },
    });

    const ackMap = new Set(acknowledgments.map((a) => a.assessmentId));

    const alerts = flaggedRecords.filter(isMbcAlert).map((r) => ({
      id: r.id,
      assessmentRecordId: r.id,
      clientId: r.clientId,
      clientName: r.client?.name || 'Patient',
      instrumentName: r.instrumentName,
      totalScore: r.totalScore || 0,
      severity: r.severity || 'Normal',
      safetyFlagged: r.safetyFlagged,
      safetyNotes: r.safetyNotes,
      completedAt: r.createdAt.toISOString(),
      isAcknowledged: ackMap.has(r.id),
    }));

    return NextResponse.json({ success: true, data: alerts });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const gate = await requireClinicalContext('/dashboard/mbc');
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: gate.status });
    }

    const body = await request.json();
    const { assessmentRecordId, notes } = body;

    if (typeof assessmentRecordId !== 'string' || typeof notes !== 'string' || !notes.trim() || notes.length > 5000) {
      return NextResponse.json({ error: 'Assessment and clinician response notes are required' }, { status: 400 });
    }

    // Get assessment to retrieve clientId
    const assessment = await prisma.clinicalAssessmentRecord.findFirst({
      where: { id: assessmentRecordId, organizationId: gate.organizationId, client: gate.clientWhere },
    });

    if (!assessment) {
      return NextResponse.json({ error: 'Assessment record not found' }, { status: 404 });
    }

    if (!isMbcAlert(assessment)) return NextResponse.json({ error: 'Assessment does not have an active alert' }, { status: 400 });
    const ack = await prisma.mbcAlertAck.upsert({
      where: { organizationId_assessmentId: { organizationId: gate.organizationId, assessmentId: assessmentRecordId } },
      update: {},
      create: {
        organizationId: gate.organizationId,
        clientId: assessment.clientId,
        assessmentId: assessmentRecordId,
        alertReason: notes || 'Reviewed MBC alert and updated care plan.',
        acknowledgedById: gate.userId,
        acknowledgedByName: 'Clinician',
      },
    });

    return NextResponse.json({ success: true, data: ack });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
