import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { listClientSdoh, submitScreening } from '@/lib/sdoh/manage';
import { errorResponse, fail, ok, screeningSchema, sdohGate } from '@/lib/sdoh/http';
import { watchSdohNotes } from '@/lib/ai/riskWatch/hooks';

export const runtime = 'nodejs';

/** GET /api/sdoh/screenings?clientId= — a client's screenings, Z-code suggestions and referrals. */
export async function GET(req: Request) {
  const g = await sdohGate();
  if (!g.ok) return g.res;
  const clientId = new URL(req.url).searchParams.get('clientId')?.trim();
  if (!clientId) return fail('clientId is required', 400);
  try {
    const data = await listClientSdoh(g.actor, clientId);
    await auditPhiAccess({ gate: g.gate, req, action: 'READ', resourceType: 'SdohScreening', patientId: clientId, metadata: { count: data.screenings.length } });
    return ok(data);
  } catch (error) {
    await auditPhiAccess({ gate: g.gate, req, action: 'READ', resourceType: 'SdohScreening', patientId: clientId, outcome: 'DENIED' });
    return errorResponse(error, 'Could not load screenings');
  }
}

/** POST /api/sdoh/screenings — save a completed AHC HRSN screening (staff-administered). */
export async function POST(req: Request) {
  const g = await sdohGate();
  if (!g.ok) return g.res;
  try {
    const body = screeningSchema.parse(await req.json());
    const result = await submitScreening(g.actor, body);
    await auditPhiAccess({
      gate: g.gate,
      req,
      action: 'CREATE',
      resourceType: 'SdohScreening',
      resourceId: result.screening.id,
      patientId: body.clientId,
      metadata: { positiveDomains: result.screening.positiveDomains, riskAlert: result.riskAlertCreated, duplicate: result.duplicate },
    });
    return ok(
      {
        screening: result.screening,
        riskAlertCreated: result.riskAlertCreated,
        safetyItemEndorsed: result.score.safetyItemEndorsed,
        duplicate: result.duplicate,
        riskWatch: result.duplicate ? null : await watchSdohNotes({ organizationId: g.actor.organizationId, clientId: body.clientId, screeningId: result.screening.id, notes: body.notes, actorUserId: g.actor.actorUserId, actorRole: g.actor.actorRole }),
      },
      result.duplicate ? 200 : 201
    );
  } catch (error) {
    return errorResponse(error, 'Screening could not be saved. Please retry.');
  }
}
