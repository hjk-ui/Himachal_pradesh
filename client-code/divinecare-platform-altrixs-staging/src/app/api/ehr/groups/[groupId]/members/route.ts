import { z } from 'zod';
import { addMember } from '@/lib/groups/store';
import { auditPhiAccessGroup, failJson, gateGroup, json, readJson } from '../../_shared';

export const runtime = 'nodejs';

const schema = z.object({
  clientId: z.string().min(1).max(64),
  joinedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

/** POST: add a client to the roster (capacity enforced; upcoming sessions get the member's visit). */
export async function POST(req: Request, ctx: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await ctx.params;
  const g = await gateGroup(groupId);
  if (g.ok === false) return g.res;
  const body = await readJson(req, schema);
  if (body.ok === false) return body.res;
  const r = await addMember(g.actor, groupId, body.data);
  if (r.ok === false) {
    await auditPhiAccessGroup(g, req, { action: 'GROUP_MEMBER_ADD', resourceType: 'clinicalGroup', resourceId: groupId, outcome: r.status === 403 ? 'DENIED' : 'FAILURE' });
    return failJson(r);
  }
  await auditPhiAccessGroup(g, req, { action: 'GROUP_MEMBER_ADD', resourceType: 'clinicalGroup', resourceId: groupId, patientIds: r.patientIds });
  return json(201, { success: true, memberId: r.member.id });
}
