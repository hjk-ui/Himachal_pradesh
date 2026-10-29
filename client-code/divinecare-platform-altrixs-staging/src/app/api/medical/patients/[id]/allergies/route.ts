import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { errorMessage, MEDICAL_RULE, requireMedicalPatient } from '../../../_lib/patientContext';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { allergenTypeSchema, optionalDrugCode, rxcuiSchema } from '@/lib/drugs/resolve';
import { allergyCodeFields } from '@/lib/drugs/types';

export const runtime = 'nodejs';

const createSchema = z.object({
  substance: z.string().trim().min(1, 'Substance is required').max(200),
  reaction: z.string().trim().max(500).optional().nullable(),
  severity: z.enum(['Severe/Anaphylaxis', 'Moderate', 'Mild']).default('Moderate'),
  /** drug / food / environmental; only drug allergies carry an RxNorm code (AUM2) */
  allergenType: allergenTypeSchema.optional().nullable(),
  /** RxCUI chosen in the drug typeahead; resolved server-side from RxNav */
  rxcui: rxcuiSchema.optional().nullable(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const scope = await requireMedicalPatient(id, { req, action: 'CREATE', resourceType: 'medicalAllergy', rule: MEDICAL_RULE.history });
  if (!scope.ok) return scope.response;

  try {
    const body = createSchema.parse(await req.json());
    const isDrug = !body.allergenType || body.allergenType === 'drug';
    const drug = isDrug ? await optionalDrugCode(body.rxcui, 'allergy') : { code: null };
    if ('invalid' in drug && drug.invalid) return NextResponse.json({ success: false, error: drug.invalid }, { status: 400 });
    // MedicalAllergy keys on the medical patient; the client link is optional.
    const created = await prisma.medicalAllergy.create({
      data: {
        patientId: scope.medicalPatientId,
        clientId: scope.clientId,
        allergen: body.substance,
        reaction: body.reaction || null,
        severity: body.severity,
        status: 'Active',
        allergenType: body.allergenType || (drug.code ? 'drug' : null),
        ...(drug.code ? allergyCodeFields(drug.code) : {}),
      },
    });
    await auditPhiAccess({
      gate: scope.gate,
      req,
      action: 'CREATE',
      resourceType: 'medicalAllergy',
      resourceId: created.id,
      patientId: scope.clientId,
      metadata: { medicalPatientId: scope.medicalPatientId, fields: Object.keys(body), allergenType: created.allergenType, coded: Boolean(created.rxnormId) },
    });
    return NextResponse.json({ success: true, allergy: created, ...('warning' in drug && drug.warning ? { warning: drug.warning } : {}) }, { status: 201 });
  } catch (err: unknown) {
    const status = err instanceof z.ZodError ? 400 : 500;
    console.error('[medical/allergies POST]', scope.medicalPatientId, err instanceof Error ? err.name : 'error');
    return NextResponse.json(
      { success: false, error: errorMessage(err, 'Could not save allergy') },
      { status }
    );
  }
}
