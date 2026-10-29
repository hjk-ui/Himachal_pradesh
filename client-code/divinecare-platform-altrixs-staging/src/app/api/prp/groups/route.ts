import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { errorResponse, groupSchema, ok, prpGate } from '@/lib/prp/http';
import { createGroup, loadGroups, PRP_WRITE_ROLES } from '@/lib/prp/program';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** PRP groups are program schedule data (no PHI). */
export async function GET() {
  const g = await prpGate();
  if (!g.ok) return g.res;
  try {
    return ok({ groups: await loadGroups(g.actor) });
  } catch (e) {
    return errorResponse(e, 'Could not load PRP groups');
  }
}

export async function POST(req: Request) {
  const g = await prpGate(PRP_WRITE_ROLES);
  if (!g.ok) return g.res;
  try {
    const group = await createGroup(g.actor, groupSchema.parse(await req.json()));
    await auditPhiAccess({ gate: g.gate, req, action: 'CREATE', resourceType: 'prpGroup', resourceId: group.id });
    return ok({ group }, 201);
  } catch (e) {
    return errorResponse(e, 'Could not create the group');
  }
}
