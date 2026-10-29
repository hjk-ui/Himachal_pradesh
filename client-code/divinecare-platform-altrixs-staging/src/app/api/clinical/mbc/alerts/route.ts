import { isMbcAlert } from '@/features/ehr/assessments/thresholds';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireClinicalContext } from '@/lib/clinical/access';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { listMbcAlerts } from '@/lib/clinical/mbcAlerts';
import { invalidateInboxForOrg } from '@/lib/inbox/cacheStore';

export async function GET(request: Request) {
  try {
    const gate = await requireClinicalContext('/dashboard/mbc');
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: gate.status });
    }

    const { alerts, scanned } = await listMbcAlerts({
      organizationId: gate.organizationId,
      clientWhere: gate.clientWhere,
    });

    await auditPhiAccess({
      gate, req: request, action: 'LIST', resourceType: 'mbcAlert',
      metadata: { count: alerts.length, scanned },
    });
    return NextResponse.json({ success: true, data: alerts });
  } catch (error: any) {
    console.error('[api/clinical/mbc/alerts GET] error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
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
      await auditPhiAccess({
        gate, req: request, action: 'CREATE', resourceType: 'mbcAlertAck', resourceId: assessmentRecordId,
        outcome: 'DENIED', metadata: { reason: 'assessment_not_found' },
      });
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

    await auditPhiAccess({
      gate, req: request, action: 'CREATE', resourceType: 'mbcAlertAck', resourceId: ack.id,
      patientId: assessment.clientId, metadata: { assessmentId: assessmentRecordId, fields: ['alertReason'] },
    });
    invalidateInboxForOrg(gate.organizationId);
    return NextResponse.json({ success: true, data: ack });
  } catch (error: any) {
    console.error('[api/clinical/mbc/alerts POST] error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
