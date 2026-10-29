import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { updateReferral } from '@/lib/sdoh/manage';
import { errorResponse, ok, sdohGate, updateReferralSchema } from '@/lib/sdoh/http';

export const runtime = 'nodejs';

/** PATCH /api/sdoh/referrals/[id] — status (open / connected / closed), owner, resource, notes. */
export async function PATCH(req: Request, route: { params: Promise<{ id: string }> }) {
  const g = await sdohGate();
  if (!g.ok) return g.res;
  const { id } = await route.params;
  try {
    const body = updateReferralSchema.parse(await req.json());
    const referral = await updateReferral(g.actor, id, body);
    await auditPhiAccess({
      gate: g.gate,
      req,
      action: 'UPDATE',
      resourceType: 'SdohReferral',
      resourceId: id,
      patientId: referral.clientId,
      metadata: { status: body.status ?? null, closeReason: body.closeReason ?? null, fields: Object.keys(body) },
    });
    return ok({ referral });
  } catch (error) {
    return errorResponse(error, 'Referral could not be updated');
  }
}
