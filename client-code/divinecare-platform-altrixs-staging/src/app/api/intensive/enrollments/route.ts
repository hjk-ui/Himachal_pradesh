import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { errorResponse, intensiveGate, ok, referralSchema } from '@/lib/intensive/http';
import { createReferral, listEnrollments } from '@/lib/intensive/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/intensive/enrollments?programId=&status=open|referred|screening|admitted|discharged|declined */
export async function GET(req: Request) {
  const g = await intensiveGate();
  if (!g.ok) return g.res;
  try {
    const url = new URL(req.url);
    const programId = url.searchParams.get('programId');
    const status = url.searchParams.get('status');
    const { today, rows } = await listEnrollments(g.actor, { programId, status });
    await auditPhiAccess({ gate: g.gate, req, action: 'LIST', resourceType: 'intensiveEnrollment',
      metadata: { count: rows.length, filters: { programId, status }, patientIds: rows.map((r) => r.clientId).slice(0, 50) },
    });
    return ok({ today, enrollments: rows });
  } catch (e) {
    return errorResponse(e, 'Could not load enrollments');
  }
}

/** POST /api/intensive/enrollments: new referral to a program (client in the viewer's caseload). */
export async function POST(req: Request) {
  const g = await intensiveGate({ write: true });
  if (!g.ok) return g.res;
  try {
    const body = referralSchema.parse(await req.json());
    const e = await createReferral(g.actor, body);
    await auditPhiAccess({ gate: g.gate, req, action: 'CREATE', resourceType: 'intensiveEnrollment', resourceId: e.id, patientId: e.clientId, metadata: { programId: e.programId, part2: e.part2 } });
    return ok({ enrollment: { id: e.id, status: e.status } }, 201);
  } catch (e) {
    return errorResponse(e, 'Could not add the referral');
  }
}
