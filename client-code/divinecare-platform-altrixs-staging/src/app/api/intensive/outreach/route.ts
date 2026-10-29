import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { errorResponse, intensiveGate, ok, outreachSchema } from '@/lib/intensive/http';
import { logOutreach } from '@/lib/intensive/store';

export const runtime = 'nodejs';

/** POST /api/intensive/outreach: log a missed-day outreach attempt (optionally resolving the task). */
export async function POST(req: Request) {
  const g = await intensiveGate({ write: true });
  if (!g.ok) return g.res;
  try {
    const body = outreachSchema.parse(await req.json());
    const f = await logOutreach(g.actor, body.followUpId, body);
    await auditPhiAccess({ gate: g.gate, req, action: 'UPDATE', resourceType: 'intensiveFollowUp',
      resourceId: f.id,
      patientId: f.clientId,
      metadata: { method: body.method, resolved: Boolean(body.resolve) },
    });
    return ok({ id: f.id, status: f.status });
  } catch (e) {
    return errorResponse(e, 'Could not log the outreach');
  }
}
