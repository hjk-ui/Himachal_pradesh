import { updateResource } from '@/lib/sdoh/manage';
import { errorResponse, ok, sdohGate, updateResourceSchema } from '@/lib/sdoh/http';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';

export const runtime = 'nodejs';

/** PATCH /api/sdoh/resources/[id] — edit, mark verified, or deactivate a resource. */
export async function PATCH(req: Request, route: { params: Promise<{ id: string }> }) {
  const g = await sdohGate();
  if (!g.ok) return g.res;
  const { id } = await route.params;
  try {
    const body = updateResourceSchema.parse(await req.json());
    const resource = await updateResource(g.actor, id, body);
    await writeAuditLog({
      action: 'UPDATE',
      actorUserId: g.gate.userId,
      actorRole: g.gate.role,
      organizationId: g.gate.organizationId,
      resourceType: 'SdohResource',
      resourceId: id,
      metadata: { fields: Object.keys(body) },
    });
    return ok({ resource });
  } catch (error) {
    return errorResponse(error, 'Resource could not be updated');
  }
}
