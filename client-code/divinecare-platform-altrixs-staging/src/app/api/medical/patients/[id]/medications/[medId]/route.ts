import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import {
  errorMessage,
  isMedicalProvider,
  noLinkedClientResponse,
  providerOnlyResponse,
  requireMedicalPatient,
} from '../../../../_lib/patientContext';
import { auditPhiAccess } from '@/lib/audit/requestMeta';

export const runtime = 'nodejs';

const patchSchema = z.object({
  action: z.literal('discontinue'),
  reason: z.string().trim().max(500).optional().nullable(),
});

/** Discontinue a locally-entered medication. DrFirst-managed meds must be stopped in Rcopia. */
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string; medId: string }> }
) {
  const { id, medId } = await ctx.params;
  const scope = await requireMedicalPatient(id, { req, action: 'WRITE', resourceType: 'medication' });
  if (!scope.ok) return scope.response;
  if (!isMedicalProvider(scope.gate.role)) {
    await auditPhiAccess({
      gate: scope.gate,
      req,
      action: 'WRITE',
      outcome: 'DENIED',
      resourceType: 'medication',
      resourceId: medId,
      patientId: scope.clientId,
      metadata: { medicalPatientId: scope.medicalPatientId, reason: 'not_medical_provider' },
    });
    return providerOnlyResponse();
  }
  if (!scope.clientId) return noLinkedClientResponse();

  try {
    const body = patchSchema.parse(await req.json());

    const existing = await prisma.clientMedication.findFirst({
      where: { id: medId, clientId: scope.clientId },
    });
    if (!existing) {
      return NextResponse.json({ success: false, error: 'Medication not found' }, { status: 404 });
    }
    if (existing.rcopiaMedId || existing.externalMedId) {
      return NextResponse.json(
        {
          success: false,
          error:
            'This medication is managed in DrFirst Rcopia. Discontinue it there so the e-prescribing record stays in sync.',
        },
        { status: 409 }
      );
    }

    const now = new Date();
    const updated = await prisma.clientMedication.update({
      where: { id: existing.id },
      data: {
        active: false,
        status: 'discontinued',
        action: body.action,
        endDate: now,
        stopDate: now,
        stopReason: body.reason || null,
      },
    });
    await auditPhiAccess({
      gate: scope.gate,
      req,
      action: 'WRITE',
      resourceType: 'medication',
      resourceId: updated.id,
      patientId: scope.clientId,
      metadata: {
        medicalPatientId: scope.medicalPatientId,
        operation: 'discontinue',
        fields: ['active', 'status', 'action', 'endDate', 'stopDate', 'stopReason'],
      },
    });
    return NextResponse.json({ success: true, medication: updated });
  } catch (err: unknown) {
    const status = err instanceof z.ZodError ? 400 : 500;
    console.error('[medical/medications PATCH]', medId, err instanceof Error ? err.name : 'error');
    return NextResponse.json(
      { success: false, error: errorMessage(err, 'Could not discontinue medication') },
      { status }
    );
  }
}
