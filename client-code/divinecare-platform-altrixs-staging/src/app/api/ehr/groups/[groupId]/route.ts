import { getGroupDetail, updateGroup } from '@/lib/groups/store';
import { GROUP_TYPES, isGroupKind } from '@/lib/groups/types';
import { auditPhiAccessGroup, failJson, gateGroup, groupInputSchema, json, readJson } from '../_shared';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ groupId: string }> };

/** GET: group settings, roster (caseload / facilitator scope, protected records masked) and sessions. */
export async function GET(req: Request, ctx: Ctx) {
  const { groupId } = await ctx.params;
  const g = await gateGroup(groupId);
  if (g.ok === false) return g.res;
  const r = await getGroupDetail(g.actor, groupId, g.kind);
  if (r.ok === false) return failJson(r);
  await auditPhiAccessGroup(g, req, { action: 'READ', resourceType: 'clinicalGroup', resourceId: groupId, patientIds: r.patientIds });
  const { patientIds: _ids, ...body } = r;
  void _ids;
  return json(200, { success: true, ...body });
}

const patchSchema = groupInputSchema.partial().extend({ kind: groupInputSchema.shape.groupType.optional() });

/** PATCH: settings (leadership or the group's facilitators). Kind is permanent once notes exist. */
export async function PATCH(req: Request, ctx: Ctx) {
  const { groupId } = await ctx.params;
  const g = await gateGroup(groupId);
  if (g.ok === false) return g.res;
  const body = await readJson(req, patchSchema);
  if (body.ok === false) return body.res;
  const { kind: kindRaw, ...rest } = body.data;
  if (kindRaw !== undefined && !isGroupKind(kindRaw)) return json(400, { success: false, error: 'kind must be psychotherapy or sud' });
  const nextKind = kindRaw && isGroupKind(kindRaw) ? kindRaw : g.kind;
  if (rest.groupType && !GROUP_TYPES[nextKind].some((t) => t.value === rest.groupType)) {
    return json(400, { success: false, error: 'Group type does not belong to this area' });
  }
  const r = await updateGroup(g.actor, groupId, { ...rest, ...(kindRaw && isGroupKind(kindRaw) ? { kind: kindRaw } : {}) });
  if (r.ok === false) {
    await auditPhiAccessGroup(g, req, { action: 'UPDATE', resourceType: 'clinicalGroup', resourceId: groupId, outcome: r.status === 403 ? 'DENIED' : 'FAILURE' });
    return failJson(r);
  }
  await auditPhiAccessGroup(g, req, { action: 'UPDATE', resourceType: 'clinicalGroup', resourceId: groupId, metadata: { fields: Object.keys(body.data) } });
  return json(200, { success: true, group: r.group });
}
