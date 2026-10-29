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
} from '../../../../_lib/patientContext';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { normalizeIcd10 } from '@/lib/drfirst/chartMapping';
import { checkIcd10Code } from '@/lib/icd10/validate';
import { icd10Key } from '@/lib/icd10/normalize';

export const runtime = 'nodejs';

/** Status change and/or the ICD-10-CM code for an uncoded ("needs coding") problem */
const patchSchema = z
  .object({
    status: z.enum(['Active', 'Chronic', 'Acute', 'Resolved', 'Monitoring']).optional(),
    icd10: z.string().trim().min(1, 'ICD-10 code is required').max(16).optional(),
  })
  .refine((b) => b.status !== undefined || b.icd10 !== undefined, { message: 'Nothing to update' });

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string; problemId: string }> }
) {
  const { id, problemId } = await ctx.params;
  const scope = await requireMedicalPatient(id, { req, action: 'WRITE', resourceType: 'medicalProblem', rule: MEDICAL_RULE.problems });
  if (!scope.ok) return scope.response;
  if (!isMedicalProvider(scope.gate.role)) {
    await auditPhiAccess({
      gate: scope.gate,
      req,
      action: 'WRITE',
      outcome: 'DENIED',
      resourceType: 'medicalProblem',
      resourceId: problemId,
      patientId: scope.clientId,
      metadata: { medicalPatientId: scope.medicalPatientId, reason: 'not_medical_provider' },
    });
    return providerOnlyResponse();
  }
  if (!scope.clientId) return noLinkedClientResponse();

  try {
    const body = patchSchema.parse(await req.json());

    // Problem must belong to this patient's client (which is already org-scoped).
    const existing = await prisma.medicalProblem.findFirst({
      where: { id: problemId, clientId: scope.clientId },
    });
    if (!existing) {
      return NextResponse.json({ success: false, error: 'Problem not found' }, { status: 404 });
    }

    // The provider's code is validated, never guessed or crosswalked
    let icd10Code: string | undefined;
    if (body.icd10 !== undefined) {
      const code = normalizeIcd10(body.icd10);
      if (!code) {
        return NextResponse.json({ success: false, error: `'${body.icd10}' is not a valid ICD-10-CM code.` }, { status: 400 });
      }
      // Must exist in the current (FY2027) code set; an unchanged stored code is not re-judged
      const check = existing.icd10Code && icd10Key(existing.icd10Code) === icd10Key(code) ? null : checkIcd10Code(code);
      if (check && check.status !== 'ok') {
        return NextResponse.json({ success: false, error: check.message, code: check.status }, { status: 400 });
      }
      icd10Code = code;
    }

    const updated = await prisma.medicalProblem.update({
      where: { id: existing.id },
      data: {
        ...(icd10Code ? { icd10Code } : {}),
        ...(body.status
          ? {
              status: body.status,
              // Re-activating keeps the chronic flag; explicitly choosing Chronic sets it.
              isChronic: body.status === 'Chronic' ? true : existing.isChronic,
              resolvedDate: body.status === 'Resolved' ? new Date() : null,
            }
          : {}),
      },
    });

    await auditPhiAccess({
      gate: scope.gate,
      req,
      action: 'WRITE',
      resourceType: 'medicalProblem',
      resourceId: updated.id,
      patientId: scope.clientId,
      metadata: {
        medicalPatientId: scope.medicalPatientId,
        status: body.status ?? null,
        coded: Boolean(icd10Code),
        fields: [...(icd10Code ? ['icd10Code'] : []), ...(body.status ? ['status', 'isChronic', 'resolvedDate'] : [])],
      },
    });

    return NextResponse.json({ success: true, problem: updated });
  } catch (err: unknown) {
    const status = err instanceof z.ZodError ? 400 : 500;
    console.error('[medical/problems PATCH]', problemId, err instanceof Error ? err.name : 'error');
    return NextResponse.json(
      { success: false, error: errorMessage(err, 'Could not update problem') },
      { status }
    );
  }
}
