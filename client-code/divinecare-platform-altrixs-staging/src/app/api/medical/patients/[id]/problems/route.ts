import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import {
  errorMessage,
  isMedicalProvider,
  MEDICAL_RULE,
  noLinkedClientResponse,
  providerOnlyResponse,
  requireMedicalPatient,
} from '../../../_lib/patientContext';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { checkIcd10Code } from '@/lib/icd10/validate';

export const runtime = 'nodejs';

const createSchema = z.object({
  icd10: z.string().trim().min(1, 'ICD-10 code is required').max(16),
  description: z.string().trim().min(1, 'Description is required').max(300),
  status: z.enum(['Active', 'Chronic', 'Acute', 'Resolved', 'Monitoring']).default('Active'),
  category: z.string().trim().max(60).optional(),
  onsetDate: z.string().trim().max(32).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const scope = await requireMedicalPatient(id, { req, action: 'CREATE', resourceType: 'medicalProblem', rule: MEDICAL_RULE.problems });
  if (!scope.ok) return scope.response;
  if (!isMedicalProvider(scope.gate.role)) {
    await auditPhiAccess({
      gate: scope.gate,
      req,
      action: 'CREATE',
      outcome: 'DENIED',
      resourceType: 'medicalProblem',
      resourceId: null,
      patientId: scope.clientId,
      metadata: { medicalPatientId: scope.medicalPatientId, reason: 'not_medical_provider' },
    });
    return providerOnlyResponse();
  }
  if (!scope.clientId) return noLinkedClientResponse();

  try {
    const body = createSchema.parse(await req.json());
    // The code must exist in the current (FY2027) ICD-10-CM code set
    const check = checkIcd10Code(body.icd10);
    if (check.status !== 'ok') {
      return NextResponse.json({ success: false, error: check.message, code: check.status }, { status: 400 });
    }
    const onset = body.onsetDate ? new Date(body.onsetDate) : null;

    const created = await prisma.medicalProblem.create({
      data: {
        clientId: scope.clientId,
        patientId: scope.medicalPatientId,
        icd10Code: check.code,
        name: body.description,
        description: body.description,
        category: body.category || null,
        status: body.status,
        isChronic: body.status === 'Chronic',
        onsetDate: onset && !Number.isNaN(onset.getTime()) ? onset : null,
        resolvedDate: body.status === 'Resolved' ? new Date() : null,
        notes: body.notes || null,
      },
    });

    await auditPhiAccess({
      gate: scope.gate,
      req,
      action: 'CREATE',
      resourceType: 'medicalProblem',
      resourceId: created.id,
      patientId: scope.clientId,
      metadata: { medicalPatientId: scope.medicalPatientId, status: body.status, fields: Object.keys(body) },
    });

    return NextResponse.json({ success: true, problem: created }, { status: 201 });
  } catch (err: unknown) {
    const status = err instanceof z.ZodError ? 400 : 500;
    console.error('[medical/problems POST]', scope.medicalPatientId, err instanceof Error ? err.name : 'error');
    return NextResponse.json(
      { success: false, error: errorMessage(err, 'Could not save problem') },
      { status }
    );
  }
}
