import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { createReferral, worklist } from '@/lib/sdoh/manage';
import { createReferralSchema, errorResponse, ok, sdohGate } from '@/lib/sdoh/http';
import type { AhcDomain } from '@/lib/sdoh/ahcHrsn';

export const runtime = 'nodejs';

/** GET /api/sdoh/referrals[?includeClosed=1] — needs & referrals worklist plus rescreens due (caseload-scoped). */
export async function GET(req: Request) {
  const g = await sdohGate();
  if (!g.ok) return g.res;
  try {
    const includeClosed = new URL(req.url).searchParams.get('includeClosed') === '1';
    const data = await worklist(g.actor, { includeClosed });
    await auditPhiAccess({
      gate: g.gate,
      req,
      action: 'LIST',
      resourceType: 'SdohReferral',
      metadata: {
        referrals: data.referrals.length,
        rescreen: data.rescreen.length,
        clientIds: [...new Set(data.referrals.map((r) => r.clientId))].slice(0, 50),
      },
    });
    return ok(data);
  } catch (error) {
    return errorResponse(error, 'Could not load the worklist');
  }
}

/** POST /api/sdoh/referrals — open a referral for a client's need. */
export async function POST(req: Request) {
  const g = await sdohGate();
  if (!g.ok) return g.res;
  try {
    const body = createReferralSchema.parse(await req.json());
    const referral = await createReferral(g.actor, { ...body, domain: body.domain as AhcDomain });
    await auditPhiAccess({
      gate: g.gate,
      req,
      action: 'CREATE',
      resourceType: 'SdohReferral',
      resourceId: referral.id,
      patientId: body.clientId,
      metadata: { domain: body.domain },
    });
    return ok({ referral }, 201);
  } catch (error) {
    return errorResponse(error, 'Referral could not be saved');
  }
}
