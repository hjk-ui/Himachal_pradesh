import { createGroup, listGroups } from '@/lib/groups/store';
import { defaultBilling, GROUP_TYPES } from '@/lib/groups/types';
import { auditPhiAccessGroup, failJson, gateKind, groupInputSchema, json } from './_shared';

export const runtime = 'nodejs';

/** GET /api/ehr/groups?kind=psychotherapy|sud — groups of one kind (no member PHI). */
export async function GET(req: Request) {
  const g = await gateKind(new URL(req.url).searchParams.get('kind'));
  if (g.ok === false) return g.res;
  const groups = await listGroups(g.actor, g.kind);
  await auditPhiAccessGroup(g, req, { action: 'LIST', resourceType: 'clinicalGroup', metadata: { groups: groups.length } });
  return json(200, { success: true, groups });
}

/** POST /api/ehr/groups { kind, ...group } — create a group with the kind's defaults. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const g = await gateKind(body?.kind);
  if (g.ok === false) return g.res;
  const parsed = groupInputSchema.safeParse(body);
  if (!parsed.success) return json(400, { success: false, error: parsed.error.issues[0]?.message || 'Invalid request' });
  if (!GROUP_TYPES[g.kind].some((t) => t.value === parsed.data.groupType)) return json(400, { success: false, error: 'Group type does not belong to this area' });
  const r = await createGroup(g.actor, g.kind, parsed.data);
  if (r.ok === false) return failJson(r);
  await auditPhiAccessGroup(g, req, { action: 'CREATE', resourceType: 'clinicalGroup', resourceId: r.group.id, metadata: { groupType: r.group.groupType, billingCode: r.group.billingCode } });
  return json(201, { success: true, group: r.group, billingNote: defaultBilling(g.kind, r.group.groupType).note });
}
