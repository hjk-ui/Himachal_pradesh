import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { medicationSourceSchema } from '@/lib/clinical/medicationSource';
import { isAntipsychotic } from '@/app/api/clients/[id]/safety-check/route';
import { canWritePrimaryCareMedications } from '@/features/medical/roles';
import {
  errorMessage,
  isMedicalProvider,
  noLinkedClientResponse,
  requireMedicalPatient,
} from '../../../_lib/patientContext';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { optionalDrugCode, rxcuiSchema } from '@/lib/drugs/resolve';
import { medicationCodeFields } from '@/lib/drugs/types';

export const runtime = 'nodejs';

const createSchema = z.object({
  medicationName: z.string().trim().min(1, 'Medication name is required').max(200),
  dosage: z.string().trim().min(1, 'Dose is required').max(120),
  frequency: z.string().trim().max(120).optional().nullable(),
  route: z.string().trim().max(60).optional().nullable(),
  indication: z.string().trim().max(200).optional().nullable(),
  instructions: z.string().trim().max(500).optional().nullable(),
  source: medicationSourceSchema,
  /** RxCUI (specific strength + form) chosen in the drug typeahead; resolved server-side (MUM2-MUM4) */
  rxcui: rxcuiSchema.optional().nullable(),
});

/**
 * Add a medication to the medication list (med-history reconciliation). This records
 * outside / self-reported / OTC / locally prescribed meds — it does not e-prescribe;
 * new prescriptions go through DrFirst Rcopia.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const scope = await requireMedicalPatient(id, { req, action: 'CREATE', resourceType: 'medication' });
  if (!scope.ok) return scope.response;
  if (!scope.clientId) return noLinkedClientResponse();
  // Primary care med list: medical providers + MA only (canWritePrimaryCareMedications / canWriteClientMedications)
  if (!canWritePrimaryCareMedications(scope.gate.role)) {
    await auditPhiAccess({
      gate: scope.gate, req, action: 'CREATE', resourceType: 'medication', patientId: scope.clientId,
      outcome: 'DENIED', metadata: { reason: 'role_not_permitted' },
    });
    return NextResponse.json({ success: false, error: 'Your role cannot add medications' }, { status: 403 });
  }

  try {
    const body = createSchema.parse(await req.json());
    const drug = await optionalDrugCode(body.rxcui, 'medication');
    if (drug.invalid) return NextResponse.json({ success: false, error: drug.invalid }, { status: 400 });
    // "Prescribed here" is attributed to the entering provider; other sources have no local prescriber.
    const prescribedHere = body.source === 'prescribed' && isMedicalProvider(scope.gate.role);
    const created = await prisma.clientMedication.create({
      data: {
        clientId: scope.clientId,
        medicationName: body.medicationName,
        dosage: body.dosage,
        frequency: body.frequency || null,
        route: body.route || null,
        indication: body.indication || null,
        instructions: body.instructions || null,
        source: body.source,
        active: true,
        status: 'active',
        isAntipsychotic: isAntipsychotic(body.medicationName),
        prescribedById: prescribedHere ? scope.gate.userId : null,
        ...(drug.code ? medicationCodeFields(drug.code) : {}),
      },
    });
    await auditPhiAccess({
      gate: scope.gate,
      req,
      action: 'CREATE',
      resourceType: 'medication',
      resourceId: created.id,
      patientId: scope.clientId,
      metadata: { medicalPatientId: scope.medicalPatientId, source: body.source, fields: Object.keys(body), coded: Boolean(drug.code) },
    });
    return NextResponse.json({ success: true, medication: created, ...(drug.warning ? { warning: drug.warning } : {}) }, { status: 201 });
  } catch (err: unknown) {
    const status = err instanceof z.ZodError ? 400 : 500;
    console.error('[medical/medications POST]', scope.medicalPatientId, err instanceof Error ? err.name : 'error');
    return NextResponse.json(
      { success: false, error: errorMessage(err, 'Could not save medication') },
      { status }
    );
  }
}
