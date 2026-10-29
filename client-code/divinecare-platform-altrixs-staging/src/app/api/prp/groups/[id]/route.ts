import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { errorResponse, groupPatchSchema, ok, prpGate } from '@/lib/prp/http';
import { PRP_WRITE_ROLES, updateGroup } from '@/lib/prp/program';

export const runtime = 'nodejs';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await prpGate(PRP_WRITE_ROLES);
  if (!g.ok) return g.res;
  try {
    const { id } = await params;
    const body = groupPatchSchema.parse(await req.json());
    const group = await updateGroup(g.actor, id, body);
    await auditPhiAccess({ gate: g.gate, req, action: 'WRITE', resourceType: 'prpGroup', resourceId: group.id, metadata: { fields: Object.keys(body) } });
    return ok({ group });
  } catch (e) {
    return errorResponse(e, 'Could not update the group');
  }
}
