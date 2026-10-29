import { z } from 'zod';
import { getSessionDetail, updateSessionStatus } from '@/lib/groups/store';
import { PART2_REDISCLOSURE_NOTICE } from '@/lib/groups/types';
import { auditPhiAccessGroup, failJson, gateSession, json, readJson } from '../../_shared';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ sessionId: string }> };

/** GET: one session with its roster, attendance, shared + individual note sections and billing preview. */
export async function GET(req: Request, ctx: Ctx) {
  const { sessionId } = await ctx.params;
  const g = await gateSession(sessionId);
  if (g.ok === false) return g.res;
  const r = await getSessionDetail(g.actor, sessionId, g.kind);
  if (r.ok === false) return failJson(r);
  await auditPhiAccessGroup(g, req, { action: 'READ', resourceType: 'clinicalGroupSession', resourceId: sessionId, patientIds: r.patientIds });
  const { patientIds: _ids, ...body } = r;
  void _ids;
  return json(200, { success: true, ...body, part2Notice: body.session.part2 ? PART2_REDISCLOSURE_NOTICE : null });
}

const schema = z.object({
  status: z.enum(['scheduled', 'in_progress', 'completed', 'cancelled']),
  cancelReason: z.string().max(300).nullable().optional(),
});

/** PATCH: session status (cancel cancels the members' group visits; a session with notes cannot be cancelled). */
export async function PATCH(req: Request, ctx: Ctx) {
  const { sessionId } = await ctx.params;
  const g = await gateSession(sessionId);
  if (g.ok === false) return g.res;
  const body = await readJson(req, schema);
  if (body.ok === false) return body.res;
  const r = await updateSessionStatus(g.actor, sessionId, body.data);
  if (r.ok === false) return failJson(r);
  await auditPhiAccessGroup(g, req, { action: 'UPDATE', resourceType: 'clinicalGroupSession', resourceId: sessionId, metadata: { status: body.data.status } });
  return json(200, { success: true });
}
