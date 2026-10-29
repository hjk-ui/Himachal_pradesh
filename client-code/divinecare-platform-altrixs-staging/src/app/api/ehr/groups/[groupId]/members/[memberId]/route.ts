import { z } from 'zod';
import { endMembership } from '@/lib/groups/store';
import { auditPhiAccessGroup, failJson, gateGroup, json, readJson } from '../../../_shared';

export const runtime = 'nodejs';

const schema = z.object({
  status: z.enum(['completed', 'discharged', 'withdrawn', 'inactive']),
  leftOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  reason: z.string().max(500).nullable().optional(),
});

/** PATCH: end a membership (history kept; future group visits cancelled). */
export async function PATCH(req: Request, ctx: { params: Promise<{ groupId: string; memberId: string }> }) {
  const { groupId, memberId } = await ctx.params;
  const g = await gateGroup(groupId);
  if (g.ok === false) return g.res;
  const body = await readJson(req, schema);
  if (body.ok === false) return body.res;
  const r = await endMembership(g.actor, groupId, memberId, body.data);
  if (r.ok === false) return failJson(r);
  await auditPhiAccessGroup(g, req, { action: 'GROUP_MEMBER_END', resourceType: 'clinicalGroup', resourceId: groupId, patientIds: r.patientIds, metadata: { status: body.data.status } });
  return json(200, { success: true });
}
