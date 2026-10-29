import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { errorResponse, morsSchema, ok, prpGate } from '@/lib/prp/http';
import { PRP_WRITE_ROLES, rateMors } from '@/lib/prp/program';

export const runtime = 'nodejs';

/** POST /api/prp/mors: record (or correct) one participant's MORS rating for a month. */
export async function POST(req: Request) {
  const g = await prpGate(PRP_WRITE_ROLES);
  if (!g.ok) return g.res;
  try {
    const body = morsSchema.parse(await req.json());
    const r = await rateMors(g.actor, body);
    await auditPhiAccess({
      gate: g.gate,
      req,
      action: 'WRITE',
      resourceType: 'prpMorsRating',
      resourceId: r.id,
      patientId: r.clientId,
      metadata: { month: r.month },
    });
    return ok({ rating: { id: r.id, enrollmentId: r.enrollmentId, month: r.month, rating: r.rating } });
  } catch (e) {
    return errorResponse(e, 'Could not save the MORS rating');
  }
}
