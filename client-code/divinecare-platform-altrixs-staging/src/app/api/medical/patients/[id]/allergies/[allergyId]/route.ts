import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { errorMessage, MEDICAL_RULE, requireMedicalPatient } from '../../../../_lib/patientContext';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { allergenTypeSchema, resolveDrugCode, rxcuiSchema } from '@/lib/drugs/resolve';
import { allergyCodeFields } from '@/lib/drugs/types';

export const runtime = 'nodejs';

const patchSchema = z.union([
  // Code a drug allergy (AUM2): RxNorm ingredient resolved here from RxNav
  z.object({ action: z.literal('code'), rxcui: rxcuiSchema }),
  // Classify as food / environmental: no drug code needed (DrFirst requires codes for drug allergies only)
  z.object({ action: z.literal('classify'), allergenType: allergenTypeSchema.exclude(['drug']) }),
]);

const NO_CODE = {
  rxnormId: null, rxnormTty: null, rxnormName: null, genericName: null, brandName: null,
  doseForm: null, strength: null, ndcCodes: [] as string[], drugCodedAt: null, drugCodeVersion: null,
};

/**
 * PATCH /api/medical/patients/[id]/allergies/[allergyId]
 * "Not coded — code it" for an existing allergy: { action: 'code', rxcui } or
 * { action: 'classify', allergenType: 'food' | 'environmental' }. The next DrFirst sync resends it.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string; allergyId: string }> }) {
  const { id, allergyId } = await ctx.params;
  const scope = await requireMedicalPatient(id, { req, action: 'WRITE', resourceType: 'medicalAllergy', rule: MEDICAL_RULE.history });
  if (!scope.ok) return scope.response;

  try {
    const body = patchSchema.parse(await req.json());
    const owner = scope.clientId
      ? { OR: [{ clientId: scope.clientId }, ...(scope.medicalPatientId ? [{ patientId: scope.medicalPatientId }] : [])] }
      : { patientId: scope.medicalPatientId ?? '__none__' };
    const existing = await prisma.medicalAllergy.findFirst({ where: { id: allergyId, ...owner }, select: { id: true, source: true } });
    if (!existing) return NextResponse.json({ success: false, error: 'Allergy not found' }, { status: 404 });
    if (existing.source === 'drfirst') {
      return NextResponse.json({ success: false, error: 'This allergy comes from DrFirst Rcopia and is coded there.' }, { status: 409 });
    }

    let data: Record<string, unknown>;
    if (body.action === 'code') {
      const resolved = await resolveDrugCode(body.rxcui, 'allergy');
      if (resolved.ok === false) {
        return NextResponse.json({ success: false, unavailable: resolved.unavailable, error: resolved.error }, { status: resolved.unavailable ? 503 : 400 });
      }
      data = allergyCodeFields(resolved.code);
    } else {
      data = { ...NO_CODE, allergenType: body.allergenType };
    }

    const updated = await prisma.medicalAllergy.update({ where: { id: existing.id }, data });
    await auditPhiAccess({
      gate: scope.gate, req, action: 'WRITE', resourceType: 'medicalAllergy', resourceId: updated.id, patientId: scope.clientId,
      metadata: { medicalPatientId: scope.medicalPatientId, operation: body.action, allergenType: updated.allergenType, rxnormTty: updated.rxnormTty },
    });
    return NextResponse.json({ success: true, allergy: updated });
  } catch (err: unknown) {
    const status = err instanceof z.ZodError ? 400 : 500;
    console.error('[medical/allergies PATCH]', allergyId, err instanceof Error ? err.name : 'error');
    return NextResponse.json({ success: false, error: errorMessage(err, 'Could not update allergy') }, { status });
  }
}
