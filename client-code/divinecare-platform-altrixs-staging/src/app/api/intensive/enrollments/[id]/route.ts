import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { enrollmentActionSchema, errorResponse, intensiveGate, ok } from '@/lib/intensive/http';
import { admit, decline, discharge, enrollmentDetail, saveWeeklyReview, updateAdmission } from '@/lib/intensive/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/intensive/enrollments/[id]: episode detail (readiness, weeks, auth, plan, reviews, outreach, discharge). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await intensiveGate();
  if (!g.ok) return g.res;
  try {
    const { id } = await params;
    const data = await enrollmentDetail(g.actor, id);
    await auditPhiAccess({ gate: g.gate, req, action: 'READ', resourceType: 'intensiveEnrollment',
      resourceId: id,
      patientId: data.enrollment.clientId,
      metadata: { part2: data.enrollment.part2, status: data.enrollment.status },
    });
    return ok({ data });
  } catch (e) {
    return errorResponse(e, 'Could not load the enrollment');
  }
}

/**
 * PATCH /api/intensive/enrollments/[id] { action }:
 *   update (screening, authorization, psych eval, admission date, team, plan) | admit | decline |
 *   discharge (reason, step-down level, aftercare, follow-up) | review (weekly team / prescriber review)
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await intensiveGate({ write: true });
  if (!g.ok) return g.res;
  try {
    const { id } = await params;
    const body = enrollmentActionSchema.parse(await req.json());
    let clientId: string;
    let status: string | null = null;
    switch (body.action) {
      case 'update': {
        const { action: _a, ...patch } = body;
        void _a;
        const e = await updateAdmission(g.actor, id, patch);
        clientId = e.clientId;
        status = e.status;
        break;
      }
      case 'admit': {
        const e = await admit(g.actor, id);
        clientId = e.clientId;
        status = e.status;
        break;
      }
      case 'decline': {
        const e = await decline(g.actor, id, body.reason);
        clientId = e.clientId;
        status = e.status;
        break;
      }
      case 'discharge': {
        const { action: _a, ...input } = body;
        void _a;
        const e = await discharge(g.actor, id, input);
        clientId = e.clientId;
        status = e.status;
        break;
      }
      case 'review': {
        const r = await saveWeeklyReview(g.actor, id, body);
        clientId = r.clientId;
        break;
      }
    }
    await auditPhiAccess({ gate: g.gate, req, action: 'UPDATE', resourceType: body.action === 'review' ? 'intensiveWeeklyReview' : 'intensiveEnrollment',
      resourceId: id,
      patientId: clientId,
      metadata: { action: body.action, status, fields: Object.keys(body).filter((k) => k !== 'action') },
    });
    return ok({ id, status });
  } catch (e) {
    return errorResponse(e, 'Could not update the enrollment');
  }
}
