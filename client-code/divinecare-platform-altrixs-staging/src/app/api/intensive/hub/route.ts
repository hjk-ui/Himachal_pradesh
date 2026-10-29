import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { errorResponse, intensiveGate, ok } from '@/lib/intensive/http';
import { hub } from '@/lib/intensive/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/intensive/hub: programs, today's program days, the viewer's program clients (team /
 * caseload scoped), open missed-day outreach and, for leadership / Medical Director only, the
 * program-director rollups (census, attendance %, under-minimum, auths, follow-up, outcomes with
 * small-cell suppression).
 */
export async function GET(req: Request) {
  const g = await intensiveGate();
  if (!g.ok) return g.res;
  try {
    const data = await hub(g.actor);
    await auditPhiAccess({ gate: g.gate, req, action: 'LIST', resourceType: 'intensiveEnrollment',
      metadata: {
        count: data.enrollments.length,
        rollups: Boolean(data.rollups),
        patientIds: data.enrollments.map((e) => e.clientId).slice(0, 50),
      },
    });
    return ok({ data });
  } catch (e) {
    return errorResponse(e, 'Could not load intensive programs');
  }
}
