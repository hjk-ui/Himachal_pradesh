import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { errorMessage, MEDICAL_RULE, noLinkedClientResponse, requireMedicalPatient } from '../../../_lib/patientContext';
import { vitalColumns, vitalsSchema } from '../../../_lib/vitals';
import { auditPhiAccess } from '@/lib/audit/requestMeta';

export const runtime = 'nodejs';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const scope = await requireMedicalPatient(id, { req, action: 'CREATE', resourceType: 'vitals', rule: MEDICAL_RULE.vitals });
  if (!scope.ok) return scope.response;
  if (!scope.clientId) return noLinkedClientResponse();

  try {
    const body = vitalsSchema.parse(await req.json());
    const created = await prisma.medicalVital.create({
      data: {
        clientId: scope.clientId,
        patientId: scope.medicalPatientId,
        recordedById: scope.gate.userId,
        ...vitalColumns(body),
      },
    });
    await auditPhiAccess({
      gate: scope.gate,
      req,
      action: 'CREATE',
      resourceType: 'vitals',
      resourceId: created.id,
      patientId: scope.clientId,
      metadata: { medicalPatientId: scope.medicalPatientId, fields: Object.keys(body) },
    });
    return NextResponse.json({ success: true, vital: created }, { status: 201 });
  } catch (err: unknown) {
    const status = err instanceof z.ZodError ? 400 : 500;
    console.error('[medical/vitals POST]', scope.medicalPatientId, err instanceof Error ? err.name : 'error');
    return NextResponse.json(
      { success: false, error: errorMessage(err, 'Could not save vitals') },
      { status }
    );
  }
}
