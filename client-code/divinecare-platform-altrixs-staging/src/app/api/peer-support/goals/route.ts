import { createGoal, listGoals } from '@/lib/peerSupport/manage';
import { createGoalSchema, errorResponse, ok, peerGate } from '@/lib/peerSupport/http';
import { auditPhiAccess } from '@/lib/audit/requestMeta';

export const runtime = 'nodejs';

/** GET /api/peer-support/goals?clientId=&includeClosed=1 — recovery goals in scope. */
export async function GET(req: Request) {
  const g = await peerGate(req, 'PeerGoal', 'LIST');
  if (!g.ok) return g.res;
  const params = new URL(req.url).searchParams;
  const clientId = params.get('clientId');
  try {
    const goals = await listGoals(g.actor, { clientId, includeClosed: params.get('includeClosed') === '1' });
    await auditPhiAccess({
      gate: g.gate,
      req,
      action: 'LIST',
      resourceType: 'PeerGoal',
      patientId: clientId,
      metadata: { count: goals.length, clientIds: [...new Set(goals.map((x) => x.clientId))].slice(0, 100) },
    });
    return ok({ goals });
  } catch (error) {
    return errorResponse(error, 'Could not load goals', { gate: g.gate, req, action: 'LIST', resourceType: 'PeerGoal', patientId: clientId });
  }
}

/** POST /api/peer-support/goals — add a goal in the client's words. */
export async function POST(req: Request) {
  const g = await peerGate(req, 'PeerGoal', 'CREATE');
  if (!g.ok) return g.res;
  let clientId: string | null = null;
  try {
    const body = createGoalSchema.parse(await req.json());
    clientId = body.clientId;
    const goal = await createGoal(g.actor, body);
    await auditPhiAccess({
      gate: g.gate,
      req,
      action: 'CREATE',
      resourceType: 'PeerGoal',
      resourceId: goal.id,
      patientId: goal.clientId,
      metadata: { domain: goal.domain, status: goal.status },
    });
    return ok({ goal }, 201);
  } catch (error) {
    return errorResponse(error, 'Goal could not be saved', { gate: g.gate, req, action: 'CREATE', resourceType: 'PeerGoal', patientId: clientId });
  }
}
