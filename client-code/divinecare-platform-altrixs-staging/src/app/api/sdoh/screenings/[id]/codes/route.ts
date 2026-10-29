import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { confirmZCodes } from '@/lib/sdoh/manage';
import { confirmCodesSchema, errorResponse, ok, sdohGate } from '@/lib/sdoh/http';

export const runtime = 'nodejs';

/** POST /api/sdoh/screenings/[id]/codes — clinician confirms suggested Z codes into the client's diagnoses. */
export async function POST(req: Request, route: { params: Promise<{ id: string }> }) {
  const g = await sdohGate();
  if (!g.ok) return g.res;
  const { id } = await route.params;
  try {
    const { codes } = confirmCodesSchema.parse(await req.json());
    const result = await confirmZCodes(g.actor, id, codes);
    await auditPhiAccess({
      gate: g.gate,
      req,
      action: 'UPDATE',
      resourceType: 'ClientDiagnosis',
      resourceId: id,
      patientId: result.screening.clientId,
      metadata: { source: 'sdoh_screening', codes, added: result.addedToDiagnoses },
    });
    return ok(result);
  } catch (error) {
    await auditPhiAccess({ gate: g.gate, req, action: 'UPDATE', resourceType: 'ClientDiagnosis', resourceId: id, outcome: 'FAILURE' });
    return errorResponse(error, 'Codes could not be saved');
  }
}
