import { z } from 'zod';
import { EVALUATION_TEMPLATES } from '@/features/ehr/evaluations/templates';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireClinicalContext } from '@/lib/clinical/access';


const bodySchema = z.object({
 id: z.string().min(1).optional(), clientId: z.string().min(1), templateId: z.string().min(1), templateName: z.string().optional(),
 status: z.enum(['DRAFT', 'PENDING_SUPERVISOR', 'FINALIZED']).default('DRAFT'),
 content: z.record(z.string(), z.unknown()).default({}), mseData: z.record(z.string(), z.unknown()).default({}),
 riskData: z.record(z.string(), z.unknown()).default({}), diagnoses: z.array(z.object({ code: z.string(), description: z.string(), isPrimary: z.boolean(), specifier: z.string().optional() })).default([]),
 clinicianSignature: z.string().max(200).optional(), supervisorSignature: z.string().max(200).optional(),
 amendmentRationale: z.string().trim().max(5000).optional(), amendmentContent: z.record(z.string(), z.string()).optional(),
});

export async function GET(request: Request) {
  try {
    const gate = await requireClinicalContext('/dashboard/ehr/evaluations');
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: gate.status });
    }

    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get('clientId');
    const status = searchParams.get('status');

    const whereClause: import('@prisma/client').Prisma.ClinicalEvaluationRecordWhereInput = {
      client: gate.clientWhere,
      organizationId: gate.organizationId,
    };

    if (clientId) {
      whereClause.clientId = clientId;
    }

    if (status) {
      whereClause.status = status;
    }

    const rawRecords = await prisma.clinicalEvaluationRecord.findMany({
      where: whereClause,
      include: {
        amendments: {
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const records = rawRecords.map((r) => {
      const latest = r.amendments[0] ? JSON.parse(r.amendments[0].changesJson) : null;
      const snapshot = latest?.version === 1 ? latest : null;
      return ({
      id: r.id,
      clientId: r.clientId,
      templateId: r.templateType,
      templateName: EVALUATION_TEMPLATES.find(t => t.id === r.templateType)?.name ?? r.templateType,
      status: r.status,
      content: snapshot?.content ?? latest ?? JSON.parse(r.formDataJson),
      mseData: snapshot?.mseData ?? (r.mseDataJson ? JSON.parse(r.mseDataJson) : {}),
      riskData: snapshot?.riskData ?? (r.riskDataJson ? JSON.parse(r.riskDataJson) : {}),
      diagnoses: snapshot?.diagnoses ?? (r.diagnosesJson ? JSON.parse(r.diagnosesJson) : []),
      clinicianSignature: r.clinicianSignedAt ? 'Signed' : undefined,
      clinicianSignedAt: r.clinicianSignedAt,
      supervisorSignature: r.supervisorSignedAt ? 'Co-Signed' : undefined,
      supervisorSignedAt: r.supervisorSignedAt,
      finalizedAt: r.finalizedAt,
      version: r.amendments.length + 1,
      amendments: r.amendments.map((a, i) => ({
        id: a.id,
        version: r.amendments.length - i + 1,
        amendedBy: a.amendedByName,
        rationale: a.reason,
        contentChanges: a.changesJson ? JSON.parse(a.changesJson) : {},
        createdAt: a.createdAt,
      })),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }); });

    return NextResponse.json({ success: true, data: records });
  } catch (error: unknown) {
    console.error('Error fetching clinical evaluations:', error);
    return NextResponse.json({ error: error instanceof z.ZodError ? 'Invalid evaluation input' : 'Could not process evaluation' }, { status: error instanceof z.ZodError ? 400 : 500 });
  }
}

export async function POST(request: Request) {
  try {
    const gate = await requireClinicalContext('/dashboard/ehr/evaluations');
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: gate.status });
    }

    const body = bodySchema.parse(await request.json());
    const {
      id,
      clientId,
      templateId,
      templateName,
      status = 'DRAFT',
      content = {},
      mseData = {},
      riskData = {},
      diagnoses = [],
      clinicianSignature,
      supervisorSignature,
      amendmentRationale,
      amendmentContent,
    } = body;

    if (!['DRAFT', 'PENDING_SUPERVISOR', 'FINALIZED'].includes(status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    if (status !== 'DRAFT' && !clinicianSignature?.trim()) return NextResponse.json({ error: 'Clinician signature is required' }, { status: 400 });
    const template = EVALUATION_TEMPLATES.find(t => t.id === templateId);
    if (!template) return NextResponse.json({ error: 'Unknown evaluation template' }, { status: 400 });
    if (status === 'FINALIZED' && template.requiresSupervisorCoSign && !supervisorSignature?.trim()) return NextResponse.json({ error: 'Supervisor co-signature is required' }, { status: 400 });
    if (supervisorSignature && !['ADMIN', 'DIRECTOR', 'CLINICIAN', 'PSYCHIATRIST', 'NP'].includes(gate.role)) return NextResponse.json({ error: 'Supervisor role required to co-sign' }, { status: 403 });
    if (status !== 'DRAFT' && template.sections.some(section => section.required && !String(content[section.id] ?? '').trim())) return NextResponse.json({ error: 'Complete the required evaluation fields before signing' }, { status: 400 });
    // Check if updating existing evaluation or creating amendment
    if (id) {
      const existing = await prisma.clinicalEvaluationRecord.findFirst({
        where: { id, organizationId: gate.organizationId, client: gate.clientWhere },
        include: { amendments: true },
      });

      if (!existing) {
        return NextResponse.json({ error: 'Evaluation record not found' }, { status: 404 });
      }

      if (existing.clientId !== clientId || existing.templateType !== templateId) return NextResponse.json({ error: 'Evaluation patient and template cannot be changed' }, { status: 409 });
      // If existing evaluation is FINALIZED and user provides amendment content, create a versioned amendment
      if (['FINALIZED', 'AMENDED'].includes(existing.status) && amendmentRationale?.trim()) {
        const updatedRecord = await prisma.clinicalEvaluationRecord.update({
          where: { id: existing.id, organizationId: gate.organizationId },
          data: { status: 'AMENDED', amendments: { create: {
            amendedById: gate.userId, amendedByName: gate.session.user.name || 'Clinician',
            reason: amendmentRationale,
            changesJson: JSON.stringify({ version: 1, content: amendmentContent || content, mseData, riskData, diagnoses }),
          } } }, include: { amendments: { orderBy: { createdAt: 'desc' } } },
        });
        return NextResponse.json({ success: true, data: updatedRecord });
      }

      if (['FINALIZED', 'AMENDED'].includes(existing.status)) {
        return NextResponse.json({ error: 'Finalized evaluations require an amendment rationale' }, { status: 409 });
      }
      // Standard update of DRAFT or PENDING_SUPERVISOR record
      const isFinalizing = status === 'FINALIZED';
      const updatedRecord = await prisma.clinicalEvaluationRecord.update({
        where: { id: existing.id },
        data: {
          status: status,
          riskLevel: riskData.overallRiskLevel === 'SEVERE' || riskData.overallRiskLevel === 'HIGH' ? 'HIGH' : riskData.overallRiskLevel === 'MEDIUM' ? 'MEDIUM' : 'LOW',
          formDataJson: JSON.stringify(content),
          mseDataJson: JSON.stringify(mseData),
          riskDataJson: JSON.stringify(riskData),
          diagnosesJson: JSON.stringify(diagnoses),
          clinicianSignedAt: clinicianSignature ? new Date() : existing.clinicianSignedAt,
          supervisorSignedAt: supervisorSignature ? new Date() : existing.supervisorSignedAt,
          finalizedAt: isFinalizing ? new Date() : existing.finalizedAt,
        },
        include: { amendments: { orderBy: { createdAt: 'desc' } } },
      });

      return NextResponse.json({ success: true, data: updatedRecord });
    }

    const patient = await prisma.client.findFirst({ where: { id: clientId, AND: [gate.clientWhere] }, select: { id: true } });
    if (!patient) return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
    // Create new Evaluation Record
    if (!clientId || (!templateId && !templateName)) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const newRecord = await prisma.clinicalEvaluationRecord.create({
      data: {
        organizationId: gate.organizationId,
        clientId,
        templateType: templateId || templateName || 'Biopsychosocial',
        status: status,
          riskLevel: riskData.overallRiskLevel === 'SEVERE' || riskData.overallRiskLevel === 'HIGH' ? 'HIGH' : riskData.overallRiskLevel === 'MEDIUM' ? 'MEDIUM' : 'LOW',
        sessionDate: new Date(),
        clinicianId: gate.userId,
        formDataJson: JSON.stringify(content),
        mseDataJson: JSON.stringify(mseData),
        riskDataJson: JSON.stringify(riskData),
        diagnosesJson: JSON.stringify(diagnoses),
        clinicianSignedAt: clinicianSignature ? new Date() : null,
        supervisorSignedAt: supervisorSignature ? new Date() : null,
        finalizedAt: status === 'FINALIZED' ? new Date() : null,
      },
      include: { amendments: true },
    });

    return NextResponse.json({ success: true, data: newRecord });
  } catch (error: unknown) {
    console.error('Error creating/updating clinical evaluation:', error);
    return NextResponse.json({ error: error instanceof z.ZodError ? 'Invalid evaluation input' : 'Could not process evaluation' }, { status: error instanceof z.ZodError ? 400 : 500 });
  }
}
